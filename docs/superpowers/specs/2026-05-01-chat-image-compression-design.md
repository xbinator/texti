# 聊天图片压缩功能设计

## 背景与目标

当前图片上传功能（`2026-05-01-chat-image-upload-design.md`）已实现基本能力：用户选择图片后，通过 `FileReader` 在渲染进程将图片转为 Base64 Data URL，再传入 AI 模型。未做任何压缩，存在以下问题：

- **Volume**：高分辨率照片（如 iPhone 拍摄的 12MP 图片）转 Base64 后体积可达 10-20MB，严重拖慢 IPC 传输、内存占用和 API 请求
- **Cost**：Vercel AI SDK 将完整 Base64 发送到 Vision 模型 API，大量冗余像素增加 Token 消耗
- **Storage**：Base64 存入 SQLite 消息表，大图片会使数据库快速膨胀

本次设计目标：在图片转为 Base64 之前，使用 **sharp**（Node.js 原生 libvips 绑定）在主进程侧压缩图片，将输出尺寸和体积控制在合理范围内。

### 设计原则

1. **透明压缩**：对上层业务逻辑（图片预览、消息构建、模型调用）完全透明，压缩前后接口不变
2. **主进程执行**：`sharp` 是原生 Node.js 模块，只能在 Electron 主进程运行，通过 IPC 桥接
3. **降级兜底**：如果 `sharp` 初始化失败或压缩出错，直接透传原始图片，不阻塞上传流程
4. **体积阈值**：仅对超过阈值的图片进行压缩，小图片（如截图、图标）直接跳过
5. **最小改动**：不改动现有 `ChatMessageFile` 类型、`useImageUpload` 校验逻辑、`messageHelper` 转换逻辑

### 范围说明

**包含：**
- `sharp` 依赖安装与主进程集成
- 主进程 IPC handler 注册（`image:compress`）
- Preload API 暴露与类型声明
- `createChatImageFile()` 中集成压缩调用
- 压缩参数：限制输出宽高 ≤ 2048px、JPEG 质量 80、保持原始格式（PNG→PNG, JPEG→JPEG, WebP→WebP）
- 体积阈值：输入文件 ≤ 500KB 时跳过压缩
- 降级兜底机制

**不包含：**
- 可配置的压缩参数 UI（本次使用硬编码参数）
- 压缩进度显示
- 批量压缩队列管理（`Promise.all` 已满足 MVP 需求）
- **GIF 动图压缩**：sharp resize 多帧 GIF 只保留第一帧，本次直接跳过
- **HEIC/HEIF 压缩**：依赖 libheif 可选库，Electron 打包时不保证包含，本次直接跳过

## 架构概览

```text
┌─────────────────────────────────────────────────────────────┐
│  渲染进程 (Vue 3)                                            │
│                                                              │
│  createChatImageFile(file)                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  1. file.arrayBuffer() → ArrayBuffer                 │   │
│  │  2. byteLength > 500KB?                              │   │
│  │     YES → IPC compressImage(buffer, file.type)       │   │
│  │          → 返回压缩后 ArrayBuffer                      │   │
│  │     NO  → 直接用原始 arrayBuffer                      │   │
│  │  3. ArrayBuffer → Blob → FileReader → Base64         │   │
│  │  4. 构造 ChatMessageFile { ..., url, contentHash }   │   │
│  └──────────────────────────────────────────────────────┘   │
│         │                                                    │
│         │  window.electronAPI.compressImage()                │
│         │  (contextBridge → ipcRenderer.invoke)              │
└─────────┼────────────────────────────────────────────────────┘
          │  IPC 'image:compress'
          │  （ArrayBuffer 经结构化克隆传输，主进程需 Buffer.from() 显式转换）
┌─────────┼────────────────────────────────────────────────────┐
│  主进程 (Electron)                                            │
│  ┌──────┴───────────────────────────────────────────────┐    │
│  │  ipcMain.handle('image:compress')                    │    │
│  │  1. Buffer.from(request.buffer) ← 显式转换           │    │
│  │  2. sharp(buf) → .resize(2048×2048, inside)         │    │
│  │  3. .jpeg({ quality: 80 }) / .png({ compressionLevel: 6 })  │   │
│  │  4. → .toBuffer() → 返回 Buffer                     │    │
│  │  5. 返回 { buffer: Buffer, compressed: boolean }    │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

**降级路径：**
```
Buffer → sharp().resize() → .toFormat() → .toBuffer()
  ↓ 异常抛出
  返回原始 ArrayBuffer（渲染进程继续正常流程）
```

## 详细设计

### 1. 新增依赖

```json
// package.json
{
  "dependencies": {
    "sharp": "^0.34.5"
  }
}
```

`sharp` 需要作为 `dependencies`（非 devDependencies），因为 Electron 打包时需要将 `libvips` 原生二进制包含进应用分发。

### 2. 主进程 IPC 模块

新增 `electron/main/modules/image/ipc.mts`：

```typescript
/**
 * @file ipc.mts
 * @description 图片压缩 IPC handler，使用 sharp 在主进程执行图片压缩
 */
import sharp from 'sharp';
import { ipcMain } from 'electron';

/** 压缩参数 */
interface ImageCompressRequest {
  /** 原始图片二进制数据 */
  buffer: Buffer;
  /** 图片 MIME 类型（如 image/jpeg, image/png, image/webp） */
  mimeType: string;
}

/** 压缩结果 */
interface ImageCompressResult {
  /** 压缩后的二进制数据 */
  buffer: Buffer;
  /** 是否实际执行了压缩（未触发 skip 或 fallback 时为 true） */
  compressed: boolean;
}

/** 输出图片宽高上限 */
const MAX_DIMENSION = 2048;
/** JPEG 输出质量（0-100） */
const JPEG_QUALITY = 80;
/** PNG 压缩级别（0-9，6 为 libvips 默认值，性价比最优） */
const PNG_COMPRESSION_LEVEL = 6;
/** WebP 输出质量（0-100） */
const WEBP_QUALITY = 80;
/** 不支持压缩的 MIME 类型（动图、HEIC 等 sharp resize 会丢帧或依赖可选库） */
const SKIP_FORMATS = new Set(['image/gif', 'image/heic', 'image/heif']);

/**
 * 解析 MIME 类型到 sharp 输出格式。
 * @param mimeType - 图片 MIME 类型
 * @returns sharp 输出格式 key，若格式不支持压缩则返回 undefined
 */
function mimeTypeToFormat(mimeType: string): keyof sharp.FormatEnum | undefined {
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpeg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/avif') return 'avif';
  if (mimeType === 'image/tiff') return 'tiff';
  // GIF、HEIC 等不支持的格式在主流程中跳过
  return undefined;
}

/**
 * 注册图片压缩相关的 IPC handlers。
 */
export function registerImageHandlers(): void {
  ipcMain.handle('image:compress', async (_event, request: ImageCompressRequest): Promise<ImageCompressResult> => {
    // 动图、HEIC 等不支持的格式直接跳过压缩
    if (SKIP_FORMATS.has(request.mimeType)) {
      return { buffer: request.buffer, compressed: false };
    }

    // ⚠️ IPC 传输后 ArrayBuffer 变为普通对象，必须显式转为 Buffer
    // Buffer.from() 本身也可能失败（数据损坏等），失败时降级返回原始数据
    let inputBuffer: Buffer;
    try {
      inputBuffer = Buffer.from(request.buffer);
    } catch {
      return { buffer: request.buffer, compressed: false };
    }

    const format = mimeTypeToFormat(request.mimeType);

    try {
      let pipeline = sharp(inputBuffer)
        .resize({
          width: MAX_DIMENSION,
          height: MAX_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true
        });

      // 根据原始格式选择输出参数
      if (format === 'jpeg') {
        pipeline = pipeline.jpeg({ quality: JPEG_QUALITY });
      } else if (format === 'png') {
        pipeline = pipeline.png({ compressionLevel: PNG_COMPRESSION_LEVEL });
      } else if (format === 'webp') {
        pipeline = pipeline.webp({ quality: WEBP_QUALITY });
      } else if (format === 'avif') {
        pipeline = pipeline.avif({ quality: JPEG_QUALITY });
      } else if (format) {
        // tiff 等其他较少见格式仅 resize，不改变格式
        pipeline = pipeline.toFormat(format);
      } else {
        // 未知格式：不调用 toFormat()，依赖 sharp 从输入自动推断输出格式
        // 若 sharp 无法推断则 toBuffer() 抛异常，外层 catch 降级返回 inputBuffer
      }

      const outputBuffer = await pipeline.toBuffer();

      return { buffer: outputBuffer, compressed: true };
    } catch {
      // sharp 压缩失败时降级返回原始数据
      return { buffer: inputBuffer, compressed: false };
    }
  });
}
```

**关键设计决策：**
- **`Buffer.from()` 显式转换 + try-catch 保护**：Electron IPC 传输后 `ArrayBuffer` 变为普通对象，sharp 调用前必须 `Buffer.from(request.buffer)`，且该操作自身包在 try-catch 中——转换失败时返回原始数据而非崩溃
- **体积阈值仅在渲染进程判断**：主进程不重复检查，阈值由渲染进程的 `COMPRESS_SIZE_THRESHOLD`（500KB）唯一控制，避免两处阈值漂移导致行为不一致
- 保持原始图片格式（JPEG→JPEG, PNG→PNG），不跨格式转换，避免 PNG 截图被意外转为有损 JPEG
- `fit: 'inside'` + `withoutEnlargement: true` 确保只缩小不放大的原则
- **GIF / HEIC / HEIF 直接跳过**：sharp 对多帧 GIF resize 只保留第一帧，会破坏动图；HEIC 依赖 libheif 可选库，打包时不保证包含，因此这些格式原样透传
- PNG 压缩级别为 6（libvips 默认值），在大体积 PNG 场景下提供较好的压缩比/耗时平衡

### 3. 注册到 IPC 总入口

修改 `electron/main/modules/index.mts`，在已有模块注册列表中加入 image 模块：

```typescript
import { registerImageHandlers } from './image/ipc.mjs';

// 在现有 registerAllHandlers() 中追加
registerImageHandlers();
```

### 4. Preload 桥接

修改 `electron/preload/index.mts`，在 `electronAPI` 对象中新增：

```typescript
const electronAPI: ElectronAPI = {
  // ... 现有方法

  // ==================== 图片压缩 ====================

  /**
   * 压缩图片，使用 sharp 在后台进行压缩。
   * @param buffer - 原始图片二进制数据
   * @param mimeType - 图片 MIME 类型
   * @returns 压缩结果（压缩后 ArrayBuffer + 是否实际压缩）
   */
  compressImage: async (buffer, mimeType) => {
    const result = await ipcRenderer.invoke('image:compress', { buffer, mimeType });
    if (result.buffer instanceof ArrayBuffer) {
      return result;
    }
    // 主进程返回的 Buffer 经结构化克隆后变为 Uint8Array
    // 取其底层 .buffer 并 slice 出有效字节范围
    if (result.buffer instanceof Uint8Array) {
      result.buffer = result.buffer.buffer.slice(
        result.buffer.byteOffset,
        result.buffer.byteOffset + result.buffer.byteLength
      );
      return result;
    }
    // 兜底：无法识别的类型，回退到原始 buffer（调用方已有 fallback）
    result.buffer = buffer;
    return result;
  },
};
```

### 5. 类型声明更新

修改 `types/electron-api.d.ts`：

```typescript
/**
 * 图片压缩参数
 */
export interface ElectronImageCompressRequest {
  /** 原始图片二进制数据 */
  buffer: ArrayBuffer;
  /** 图片 MIME 类型 */
  mimeType: string;
}

/**
 * 图片压缩结果
 */
export interface ElectronImageCompressResult {
  /** 压缩后的二进制数据 */
  buffer: ArrayBuffer;
  /** 是否实际执行了压缩 */
  compressed: boolean;
}
```

在 `ElectronAPI` 接口中新增方法：

```typescript
export interface ElectronAPI {
  // ... 现有方法

  // ==================== 图片压缩 ====================

  /**
   * 压缩图片，使用 sharp 在后台进行压缩。
   * @param buffer - 原始图片二进制数据
   * @param mimeType - 图片 MIME 类型
   * @returns 压缩结果（压缩后 Buffer + 是否实际压缩）
   */
  compressImage: (buffer: ArrayBuffer, mimeType: string) => Promise<ElectronImageCompressResult>;
}
```

### 6. 渲染进程集成

修改 `src/components/BChatSidebar/utils/imageUtils.ts` 中的 `createChatImageFile()` 函数：

```typescript
import { logger } from '@/shared/logger';

/** 图片压缩体积阈值（字节），小于此阈值的图片跳过压缩 */
const COMPRESS_SIZE_THRESHOLD = 500 * 1024;

/**
 * 将 ArrayBuffer 转为 Base64 Data URL。
 * @param buffer - 二进制图片数据
 * @param mimeType - MIME 类型（如 image/jpeg）
 * @returns Base64 Data URL
 */
function arrayBufferToBase64(buffer: ArrayBuffer, mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buffer], { type: mimeType });
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * 从 File 创建聊天图片附件（含压缩）。
 * @param file - 浏览器 File 对象
 * @returns 聊天图片附件
 */
export async function createChatImageFile(file: File): Promise<ChatMessageFile> {
  // 文件读取失败直接向上抛，不做 fallback（文件不存在/权限等问题上层统一处理）
  const originalBuffer = await file.arrayBuffer();
  let imageBuffer: ArrayBuffer = originalBuffer;
  let compressed = false;

  if (originalBuffer.byteLength > COMPRESS_SIZE_THRESHOLD && window.electronAPI?.compressImage) {
    try {
      const result = await window.electronAPI.compressImage(originalBuffer, file.type);
      imageBuffer = result.buffer;
      compressed = result.compressed;
    } catch {
      // 仅压缩失败时 fallback 到原始 buffer，文件读取失败在此之外正常向上抛
      imageBuffer = originalBuffer;
    }
  }

  // ⚠️ File 对象使用 file.type（非 .mimeType）读取 MIME 类型
  const base64 = await arrayBufferToBase64(imageBuffer, file.type);

  // 压缩结果接入日志系统，便于后续排查
  if (compressed) {
    const compressedKB = (imageBuffer.byteLength / 1024).toFixed(0);
    const originalKB = (file.size / 1024).toFixed(0);
    const ratio = Math.max(0, (1 - imageBuffer.byteLength / file.size) * 100).toFixed(1);
    logger.info(
      `Image compressed: ${file.name} (${originalKB}KB → ${compressedKB}KB, -${ratio}%)`
    );
  }

  return {
    id: nanoid(),
    name: file.name,
    type: 'image',
    mimeType: file.type,
    size: imageBuffer.byteLength,
    extension: getFileExtension(file.name),
    url: base64,
    contentHash: await sha256(base64)
  };
}
```

**关键变更：**
- `file.size` → `imageBuffer.byteLength`：压缩后使用实际输出体积
- 原函数直接调用 `fileToBase64(file)`，现在拆为三步：读取 ArrayBuffer → 压缩（IPC）→ Blob + FileReader 转 Base64
- `fileToBase64()` 工具函数保留不变（可能被其他模块使用）
- MIME 类型统一从 `file.type` 读取（File API 标准属性），不使用不存在的 `file.mimeType`
- `compressed` 标志接入日志系统（`logger.info`），记录压缩比（负数 clamp 到 0），便于运行时排查
- 文件读取与压缩错误分离：`file.arrayBuffer()` 失败直接向上抛，仅 `compressImage` 失败走 fallback 到 `originalBuffer`
- 体积阈值 **仅** 在渲染进程 `imageUtils.ts` 中定义和控制，主进程 handler 不再重复判断
- 本次直接访问 `window.electronAPI?.compressImage` 而非通过 `native` 封装，与现有 chat 模块代码风格一致；待 platform 层统一封装压缩相关方法后，可迁移为 `native.compressImage`

### 7. platform 适配层

检查 `src/shared/platform/electron-api.ts`，确保 `compressImage` 被链式导出的 `native` 对象包含：

```typescript
// src/shared/platform/electron-api.ts（如不存在该文件则阅读现有 platform 导出链）
export const native = readElectronAPI();

// native 的类型应为 ElectronAPI，其中包含 compressImage
```

如果现有的 `native` 对象是类型安全的 `ElectronAPI` 引用，新增方法会自动可用。

### 8. 配置常量集中管理

建议将压缩参数常量抽取到 `src/ai/tools/policy.ts` 同级的配置文件（或直接在 `imageUtils.ts` 中定义为模块级常量），便于后续需要时迁移到 settings Store：

```typescript
// src/components/BChatSidebar/utils/imageUtils.ts（模块级常量）
/** 输出图片宽高上限（px），与主进程 MAX_DIMENSION 一致 */
const MAX_DIMENSION = 2048;
/** JPEG 质量（0-100） */
const JPEG_QUALITY = 80;
/** 压缩体积阈值（字节），小于此值的图片跳过压缩 */
const COMPRESS_SIZE_THRESHOLD = 500 * 1024;
```

MVP 阶段这些值硬编码在代码中，不暴露到 UI。

## 文件改动清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `package.json` | 修改 | 添加 `sharp` 依赖 |
| `pnpm-lock.yaml` | 自动生成 | 锁文件更新 |
| `electron/main/modules/image/ipc.mts` | **新增** | IPC handler：接收 Buffer + MIME type，调用 sharp 压缩后返回 |
| `electron/main/modules/index.mts` | 修改 | 注册 `registerImageHandlers()` |
| `electron/preload/index.mts` | 修改 | 暴露 `compressImage` 到 `electronAPI` |
| `types/electron-api.d.ts` | 修改 | 添加 `ElectronImageCompressRequest`、`ElectronImageCompressResult` 类型和 `compressImage` 方法签名 |
| `src/components/BChatSidebar/utils/imageUtils.ts` | 修改 | `createChatImageFile()` 中集成压缩调用，新增 `arrayBufferToBase64()` 辅助函数 |
| `src/shared/platform/electron-api.ts` | 检查 | 确认 `native` 对象的类型包含新的 `compressImage` 方法 |

## 错误处理

1. **sharp 初始化失败**：模块加载失败（如 libvips 未正确打包）→ IPC handler 返回原始 Buffer，`compressed: false`
2. **单个图片压缩失败**：`toBuffer()` 抛异常 → catch 返回原始 Buffer，`compressed: false`
3. **IPC 调用失败**：`compressImage` Promise reject → `createChatImageFile()` 中压缩专用的 try-catch 捕获，回退到 `originalBuffer`（文件读取已在 try 之前成功，不依赖 catch 重新读取）
4. **Web 环境（无 electronAPI）**：`window.electronAPI?.compressImage` 为 undefined → 跳过压缩，直接使用原始 Buffer
5. **IPC ArrayBuffer 序列化**：Electron IPC 使用结构化克隆传输数据。主进程侧，传入的 `request.buffer` 是普通对象，必须 `Buffer.from()` 显式转换（且 `Buffer.from()` 自身包在 try-catch 中）；preload 侧，主进程返回的 `Buffer` 变为 `Uint8Array`，使用 `.buffer.slice(byteOffset, byteOffset + byteLength)` 安全提取底层 `ArrayBuffer`，避免 `Object.values()` 的性能陷阱和顺序不确定性
6. **`Buffer.from()` 失败**：如果 IPC 传输过程中数据损坏导致 `Buffer.from()` 抛异常，主进程直接返回原始 `request.buffer` 并设 `compressed: false`（renderer 侧 `compressImage` 不抛错，走正常路径忽略压缩差异）

## 性能考虑

1. **体积阈值跳过**：≤500KB 的图片不经过 IPC 往返，避免无意义开销
2. **并行压缩**：`appendImages()` 中 `Promise.all(imageFiles.map(createChatImageFile))` 并行处理多张图，sharp 在主进程侧支持并发
3. **主进程 UI 响应**：sharp 压缩是 CPU 密集操作，但不阻塞渲染进程的事件循环（异步 IPC）
4. **内存双层占用**：单张图最多同时存在原始 ArrayBuffer（渲染）和压缩后 Buffer（主进程），峰值内存可控
5. **libvips 性能**：libvips 是 C 实现的高性能图像处理库，压缩 12MP 图片通常在几百毫秒内完成

## 升级路径（给 MarkdownContextHandler 预留）

1. **UI 可配置化**：后续可将压缩参数迁移到 `useSettingStore`，在设置页增加图片压缩选项（质量滑块 / 分辨率下拉 / 开关）
2. **格式转换选项**：允许用户选择「保持原格式」或「统一转为 JPEG/WebP」
3. **缩略图生成**：为会话列表生成小尺寸缩略图，减少 `InputToolbar` 预览渲染开销
4. **压缩统计**：记录压缩比率，在 UI 上显示「已压缩 XX%」

## 实现顺序建议

1. **Task 1**：安装 `sharp` 依赖
2. **Task 2**：创建 `electron/main/modules/image/ipc.mts`，注册 IPC handler
3. **Task 3**：修改 `electron/main/modules/index.mts`，注册 image 模块
4. **Task 4**：修改 `electron/preload/index.mts`，暴露 `compressImage` API
5. **Task 5**：修改 `types/electron-api.d.ts`，添加类型声明
6. **Task 6**：修改 `src/components/BChatSidebar/utils/imageUtils.ts`，集成压缩调用
7. **Task 7**：全链路验证（`pnpm dev` 启动，上传大图，观察压缩效果）

**依赖关系**：Task 2-6 均可独立完成（修改不同文件），Task 7 需等所有任务完成后执行。

## 测试建议

至少覆盖以下场景：

1. **小图片（≤500KB）**：上传截图/图标，确认不触发压缩（`compressed: false`），Base64 与原文件一致
2. **大图片（>500KB）**：上传 4000×3000 高清照片，确认输出 ≤ 2048×2048，体积显著减小
3. **PNG 图片**：上传透明背景 PNG，确认压缩后仍是 PNG，透明通道保留
4. **WebP 图片**：上传 WebP 图片，确认输出格式不变
5. **多图并行**：同时选择 5 张大图上传，确认全部压缩成功，UI 不卡顿
6. **压缩失败降级**：模拟 `sharp` 不存在或 `toBuffer()` 抛异常，确认原始图片正常展示
7. **Web 环境**：在无 `electronAPI` 的环境（浏览器开发模式），确认图片仍能正常上传（跳过压缩）
8. **压缩后尺寸准确性**：验证 `ChatMessageFile.size` 反映的是压缩后的实际大小，而非原始文件大小
9. **HEIC/HEIF 图片**（iPhone 拍摄的原始格式）：上传 HEIC 照片，确认不尝试压缩（`SKIP_FORMATS` 拦截），原始数据原样透传且 Data URL MIME 类型正确
10. **压缩后体积反而增大**：上传高度压缩过的低质量 JPEG（如二次截图），sharp 重编码后体积可能更大，确认此时仍使用压缩后数据（设计上不做体积比较回退），`compressed` 标记正确
