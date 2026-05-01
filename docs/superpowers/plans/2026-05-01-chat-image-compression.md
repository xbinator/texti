# 聊天图片压缩 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用 sharp 在 Electron 主进程侧压缩上传的聊天图片（限制输出 2048px、JPEG Q80、PNG level 6），通过 IPC 桥接渲染进程，降低 AI Vision API 的 Base64 体积和 Token 消耗。

**Architecture:** 渲染进程 `createChatImageFile()` → `file.arrayBuffer()` → IPC `image:compress` → 主进程 `sharp` 压缩 → 返回压缩后 Buffer → Blob + FileReader 转 Base64。≤500KB 跳过压缩，GIF/HEIC 直接透传，所有异常降级返回原始数据。

**Tech Stack:** sharp (libvips)、Electron ipcMain.handle / ipcRenderer.invoke、Vue 3 + TypeScript、Vitest

**关键约定：**
- Electron 目录使用 `.mts` 扩展名，前端 `src/` 使用 `.ts`
- B 系列组件全局自动注册，无需手动 import
- 所有代码必须有注释，禁止 `any` 类型
- 类型声明集中在 `types/electron-api.d.ts`

---

### Task 1: 安装 sharp 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 sharp**

```bash
pnpm add sharp
```

Run: `pnpm add sharp`
Expected: `sharp` 添加到 `dependencies`，`pnpm-lock.yaml` 自动更新

- [ ] **Step 2: 验证 sharp 可正常加载**

```bash
node -e "const sharp = require('sharp'); console.log('sharp version:', sharp.versions.sharp, 'libvips:', sharp.versions.vips)"
```

Expected: 输出版本号，无报错

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add sharp dependency for image compression"
```

---

### Task 2: 新建主进程图片压缩 IPC 模块

**Files:**
- Create: `electron/main/modules/image/ipc.mts`

- [ ] **Step 1: 创建 ipc.mts**

```typescript
/**
 * @file ipc.mts
 * @description 图片压缩 IPC handler，使用 sharp 在主进程执行图片压缩
 */
import sharp from 'sharp';
import { ipcMain } from 'electron';

/** 压缩参数 */
interface ImageCompressRequest {
  /** 原始图片二进制数据（IPC 传输后为普通对象，需 Buffer.from 转换） */
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

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
npx tsc --noEmit electron/main/modules/image/ipc.mts
```

Expected: 编译通过，无类型错误

- [ ] **Step 3: Commit**

```bash
git add electron/main/modules/image/ipc.mts
git commit -m "feat: add image compression IPC handler with sharp"
```

---

### Task 3: 注册 image 模块到 IPC 总入口

**Files:**
- Modify: `electron/main/modules/index.mts`

- [ ] **Step 1: 在 index.mts 中新增 import 和注册调用**

```typescript
import { registerImageHandlers } from './image/ipc.mjs';

export function registerAllIpcHandlers() {
  registerDialogHandlers();
  registerFileHandlers();
  registerWindowHandlers();
  registerDatabaseHandlers();
  registerStoreHandlers();
  registerShellHandlers();
  registerAIHandlers();
  registerLoggerHandlers();
  registerLogFileHandlers();
  registerMenuHandlers();
  registerPlatformShortcutHandlers();
  registerWebviewHandlers();
  registerImageHandlers();
}
```

并在 export 列表末尾追加：

```typescript
export { registerImageHandlers } from './image/ipc.mjs';
```

完整修改位置：
- 第 10 行之后新增 `import { registerImageHandlers } from './image/ipc.mjs';`
- 第 25 行 `registerWebviewHandlers();` 之后新增 `registerImageHandlers();`
- 第 40 行 `registerLogFileHandlers` 之后新增 `registerImageHandlers`

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit electron/main/modules/index.mts
```

Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add electron/main/modules/index.mts
git commit -m "feat: register image compression IPC handler in main process"
```

---

### Task 4: Preload 暴露 compressImage API

**Files:**
- Modify: `electron/preload/index.mts`

- [ ] **Step 1: 在 electronAPI 对象末尾新增 compressImage 方法**

在 `electron/preload/index.mts` 第 313 行（`webview: webviewAPI` 之后，`};` 之前）插入：

```typescript
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
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit electron/preload/index.mts
```

Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add electron/preload/index.mts
git commit -m "feat: expose compressImage API via preload"
```

---

### Task 5: 更新类型声明

**Files:**
- Modify: `types/electron-api.d.ts`

- [ ] **Step 1: 新增压缩相关类型接口**

在 `types/electron-api.d.ts` 中 `ElectronAPI` 接口定义之前（约第 142 行之前）插入：

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

- [ ] **Step 2: 在 ElectronAPI 接口中新增 compressImage 方法**

在 `ElectronAPI` 接口末尾（`webview: WebViewAPI;` 之后，`}` 闭合之前）插入：

```typescript
  // ==================== 图片压缩 ====================

  /**
   * 压缩图片，使用 sharp 在后台进行压缩。
   * @param buffer - 原始图片二进制数据
   * @param mimeType - 图片 MIME 类型
   * @returns 压缩结果（压缩后 ArrayBuffer + 是否实际压缩）
   */
  compressImage: (buffer: ArrayBuffer, mimeType: string) => Promise<ElectronImageCompressResult>;
```

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 全项目类型检查通过

- [ ] **Step 4: Commit**

```bash
git add types/electron-api.d.ts
git commit -m "feat: add compressImage type declarations to ElectronAPI"
```

---

### Task 6: 渲染进程 integrate 压缩调用

**Files:**
- Modify: `src/components/BChatSidebar/utils/imageUtils.ts`

- [ ] **Step 1: 修改 imageUtils.ts**

完整替换文件内容为：

```typescript
/**
 * @file imageUtils.ts
 * @description 聊天侧边栏图片附件处理工具，含 sharp 压缩集成
 */
import type { ChatMessageFile } from 'types/chat';
import { nanoid } from 'nanoid';
import { logger } from '@/shared/logger';

/** 图片压缩体积阈值（字节），小于此阈值的图片跳过压缩 */
const COMPRESS_SIZE_THRESHOLD = 500 * 1024;

/**
 * 将 File 对象转为 Base64 Data URL（未经压缩，保留供其他模块使用）。
 * @param file - 浏览器 File 对象
 * @returns Base64 Data URL
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

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
 * 检查文件是否为图片。
 * @param file - 浏览器 File 对象
 * @returns 是否为图片
 */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/**
 * 获取文件扩展名。
 * @param filename - 文件名
 * @returns 小写扩展名，无扩展名时返回空字符串
 */
export function getFileExtension(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index >= 0 ? filename.slice(index + 1).toLowerCase() : '';
}

/**
 * 计算文本内容的 SHA-256 哈希。
 * @param value - 待计算哈希的文本
 * @returns 十六进制哈希字符串
 */
export async function sha256(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 从 File 创建聊天图片附件（含 sharp 压缩）。
 * 文件读取失败直接向上抛；仅压缩失败时 fallback 到原始数据。
 * @param file - 浏览器 File 对象
 * @returns 聊天图片附件
 */
export async function createChatImageFile(file: File): Promise<ChatMessageFile> {
  // 文件读取失败直接向上抛，不做 fallback
  const originalBuffer = await file.arrayBuffer();
  let imageBuffer: ArrayBuffer = originalBuffer;
  let compressed = false;

  if (originalBuffer.byteLength > COMPRESS_SIZE_THRESHOLD && window.electronAPI?.compressImage) {
    try {
      const result = await window.electronAPI.compressImage(originalBuffer, file.type);
      imageBuffer = result.buffer;
      compressed = result.compressed;
    } catch {
      // 仅压缩失败时 fallback 到原始 buffer
      imageBuffer = originalBuffer;
    }
  }

  const base64 = await arrayBufferToBase64(imageBuffer, file.type);

  // 压缩结果接入日志系统，便于运行时排查
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

- [ ] **Step 2: 编译检查**

```bash
npx tsc --noEmit
```

Expected: 全项目编译通过

- [ ] **Step 3: Commit**

```bash
git add src/components/BChatSidebar/utils/imageUtils.ts
git commit -m "feat: integrate sharp image compression into createChatImageFile"
```

---

### Task 7: 编写 createChatImageFile 单元测试

**Files:**
- Create: `test/components/BChatSidebar/utils/imageUtils.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
/**
 * @file imageUtils.test.ts
 * @description createChatImageFile 图片压缩行为测试
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { isImageFile, getFileExtension, sha256 } from '@/components/BChatSidebar/utils/imageUtils';

describe('imageUtils', () => {
  describe('isImageFile', () => {
    it('returns true for image MIME types', () => {
      expect(isImageFile(new File([], 'test.png', { type: 'image/png' }))).toBe(true);
      expect(isImageFile(new File([], 'test.jpg', { type: 'image/jpeg' }))).toBe(true);
      expect(isImageFile(new File([], 'test.webp', { type: 'image/webp' }))).toBe(true);
    });

    it('returns false for non-image MIME types', () => {
      expect(isImageFile(new File([], 'test.txt', { type: 'text/plain' }))).toBe(false);
      expect(isImageFile(new File([], 'test.pdf', { type: 'application/pdf' }))).toBe(false);
    });
  });

  describe('getFileExtension', () => {
    it('extracts lowercase extension from filename', () => {
      expect(getFileExtension('photo.PNG')).toBe('png');
      expect(getFileExtension('image.jpeg')).toBe('jpeg');
      expect(getFileExtension('noext')).toBe('');
    });
  });

  describe('sha256', () => {
    it('produces consistent hashes', async () => {
      const hash1 = await sha256('hello');
      const hash2 = await sha256('hello');
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different input', async () => {
      const hash1 = await sha256('hello');
      const hash2 = await sha256('world');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('createChatImageFile', () => {
    beforeEach(() => {
      vi.resetModules();
      delete (window as unknown as Record<string, unknown>).electronAPI;
    });

    /** 创建一个指定大小的测试图片 blob（1x1 像素 JPEG） */
    function createTestImageFile(sizeKB: number, type = 'image/jpeg'): File {
      const bytes = sizeKB * 1024;
      const buffer = new Uint8Array(bytes);
      // 写入最小 JPEG header 使其可识别
      buffer[0] = 0xff;
      buffer[1] = 0xd8;
      buffer[2] = 0xff;
      return new File([buffer], 'test.jpg', { type });
    }

    it('returns ChatMessageFile with correct structure', async () => {
      const { createChatImageFile } = await import('@/components/BChatSidebar/utils/imageUtils');
      const file = createTestImageFile(1); // 1KB，低于阈值
      const result = await createChatImageFile(file);

      expect(result.type).toBe('image');
      expect(result.name).toBe('test.jpg');
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.url).toMatch(/^data:image\/jpeg;base64,/);
      expect(result.contentHash).toBeTruthy();
    });

    it('skips compression for files below threshold (500KB)', async () => {
      const { createChatImageFile } = await import('@/components/BChatSidebar/utils/imageUtils');
      const mockCompress = vi.fn();
      (window as unknown as Record<string, unknown>).electronAPI = { compressImage: mockCompress };

      const file = createTestImageFile(100); // 100KB
      await createChatImageFile(file);

      expect(mockCompress).not.toHaveBeenCalled();
    });

    it('skips compression when electronAPI is unavailable', async () => {
      const { createChatImageFile } = await import('@/components/BChatSidebar/utils/imageUtils');
      // electronAPI 不存在（Web 环境）
      const file = createTestImageFile(600); // 600KB，超过阈值
      const result = await createChatImageFile(file);

      expect(result.size).toBe(file.size);
      expect(result.url).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('calls compressImage for files above threshold', async () => {
      const { createChatImageFile } = await import('@/components/BChatSidebar/utils/imageUtils');

      const compressedBuffer = new ArrayBuffer(100); // 压缩后更小
      const mockCompress = vi.fn().mockResolvedValue({
        buffer: compressedBuffer,
        compressed: true
      });
      (window as unknown as Record<string, unknown>).electronAPI = { compressImage: mockCompress };

      const file = createTestImageFile(600); // 600KB
      const result = await createChatImageFile(file);

      expect(mockCompress).toHaveBeenCalledTimes(1);
      expect(mockCompress).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'image/jpeg');
      expect(result.size).toBe(100); // 压缩后大小
    });

    it('falls back to original buffer on compression failure', async () => {
      const { createChatImageFile } = await import('@/components/BChatSidebar/utils/imageUtils');

      const mockCompress = vi.fn().mockRejectedValue(new Error('sharp error'));
      (window as unknown as Record<string, unknown>).electronAPI = { compressImage: mockCompress };

      const file = createTestImageFile(600);
      const result = await createChatImageFile(file);

      expect(result.size).toBe(file.size); // 回退到原始大小
      expect(result.url).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('uses file.size as original for logs when compression succeeds', async () => {
      const { createChatImageFile } = await import('@/components/BChatSidebar/utils/imageUtils');

      const compressedBuffer = new ArrayBuffer(50 * 1024); // 50KB
      const mockCompress = vi.fn().mockResolvedValue({
        buffer: compressedBuffer,
        compressed: true
      });
      (window as unknown as Record<string, unknown>).electronAPI = { compressImage: mockCompress };

      const file = createTestImageFile(600); // 600KB original
      const result = await createChatImageFile(file);

      // 压缩后 size 反映实际输出体积
      expect(result.size).toBe(50 * 1024);
    });

    it('handles HEIC images by sending to IPC (main process skips)', async () => {
      const { createChatImageFile } = await import('@/components/BChatSidebar/utils/imageUtils');

      const mockCompress = vi.fn().mockResolvedValue({
        buffer: new ArrayBuffer(100),
        compressed: false // 主进程跳过 HEIC
      });
      (window as unknown as Record<string, unknown>).electronAPI = { compressImage: mockCompress };

      const file = createTestImageFile(600, 'image/heic');
      await createChatImageFile(file);

      expect(mockCompress).toHaveBeenCalled();
    });

    it('correctly uses file.type not file.mimeType for MIME', async () => {
      const { createChatImageFile } = await import('@/components/BChatSidebar/utils/imageUtils');

      const mockCompress = vi.fn().mockResolvedValue({
        buffer: new ArrayBuffer(100),
        compressed: false
      });
      (window as unknown as Record<string, unknown>).electronAPI = { compressImage: mockCompress };

      const file = createTestImageFile(600, 'image/png');
      await createChatImageFile(file);

      // 验证传给 compressImage 的 mimeType 来自 file.type
      expect(mockCompress).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'image/png');
    });
  });
});
```

- [ ] **Step 2: 运行测试验证**

```bash
npx vitest run test/components/BChatSidebar/utils/imageUtils.test.ts
```

Expected: 全部测试通过

- [ ] **Step 3: Commit**

```bash
git add test/components/BChatSidebar/utils/imageUtils.test.ts
git commit -m "test: add unit tests for createChatImageFile compression behavior"
```

---

### Task 8: 全链路 ESLint 与 TypeScript 检查

**Files:**
- (无新增，验证现有修改)

- [ ] **Step 1: 运行 ESLint**

```bash
pnpm lint
```

Expected: 无错误，仅有 warning 属于预存问题

- [ ] **Step 2: 运行 TypeScript 全项目检查**

```bash
npx tsc --noEmit
```

Expected: 零类型错误

- [ ] **Step 3: 运行全部测试**

```bash
pnpm test
```

Expected: 全部测试通过

- [ ] **Step 4: Commit（如有 lint 自动修复的改动）**

```bash
git add -A
git commit -m "chore: lint and typecheck fixes for image compression"
```
