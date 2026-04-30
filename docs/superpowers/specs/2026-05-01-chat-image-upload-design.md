# 聊天侧边栏图片上传功能设计

## 背景与目标

为 Tibis 聊天侧边栏增加图片上传能力，使用户能够：
- 通过文件选择器上传本地图片
- 直接粘贴剪贴板中的截图
- 拖拽图片到输入框
- 让支持视觉识别的 AI 模型理解图片内容

本次设计同时约束以下目标：
- 不破坏现有文本聊天、文件引用和历史消息流程
- 与当前 `BPromptEditor`、`useChatStream`、消息缓存和会话持久化机制兼容
- 明确纯图片消息在标题、搜索、自动命名中的行为，避免出现空语义消息

## 设计原则

1. **渐进增强**：不破坏现有文本聊天流程，图片作为可选附件
2. **模型感知**：仅当当前选中的模型支持 `supportsVision` 时才允许新增图片附件
3. **统一门禁**：按钮上传、粘贴、拖拽三种入口使用同一套 `supportsVision` 与校验逻辑
4. **自包含存储**：图片以 Base64 Data URL 形式内嵌到消息中，不依赖外部存储服务
5. **复用现有设施**：充分利用已有的 `ChatMessageFile` 类型、`MessageBubble` 渲染逻辑和消息持久化字段
6. **缓存正确性优先**：任何会影响模型上下文的图片变更，都必须让模型消息缓存失效并重新计算
7. **与现有接口增量兼容**：优先扩展现有 hook、私有工具函数和组件 props，而不是重写既有接口

## 范围说明

本次实现包含：
- 图片上传按钮
- 图片粘贴与拖拽
- 草稿区图片预览与删除
- 纯图片消息发送
- 用户消息转换为 AI SDK 多模态 `ModelMessage`

本次实现不包含：
- 图片压缩
- 图片排序
- 图片放大预览
- 非图片附件的通用上传能力

## 架构概览

```text
┌─────────────────────────────────────────────────────────────┐
│  用户交互层                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  点击上传按钮 │  │  Ctrl+V 粘贴 │  │  拖拽图片到输入框   │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         └─────────────────┼────────────────────┘            │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  appendImagesToDraft(files)                         │   │
│  │  - 统一做能力校验 / 数量校验 / 大小校验               │   │
│  │  - 异步转 Base64 + 计算 contentHash                 │   │
│  │  - 存入 draftImages                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  输入框上方显示缩略图预览，支持删除                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  可提交条件 = !isEmpty() || hasImages()             │   │
│  │  发送时把图片合并到 message.files                    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  消息转换层 (messageHelper.ts)                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  createModelMessageSignature                        │   │
│  │  toModelMessagesForMessage                          │   │
│  │  user 消息: [{type:'text'}, {type:'image'}]         │   │
│  └─────────────────────────────────────────────────────┘   │
│                              │                              │
│                              ▼                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Vercel AI SDK UserContent                           │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 详细设计

### 1. 数据类型

复用现有的 `ChatMessageFile` 类型，图片以 Base64 存储在 `url` 字段。为避免模型缓存签名直接包含大体积 Base64，本次建议为图片附件补充 `contentHash` 字段：

```typescript
export interface ChatMessageFile {
  id: string;
  name: string;
  type: ChatMessageFileType; // 'image'
  mimeType?: string;
  size?: number;
  extension?: string;
  path?: string;
  url?: string; // Base64 Data URL
  width?: number;
  height?: number;
  contentHash?: string;
}
```

新增两个设计约束：
- 图片消息写入 `message.files`，不进入 `message.parts`
- 用户消息的 `content` 始终保留可检索的纯文本摘要，不能因为“纯图片发送”而为空

补充确认：
- `src/components/BChatSidebar/utils/types.ts` 中的 `Message.files` 字段已存在，本次无需修改该接口结构

### 2. 草稿状态管理

扩展现有 `src/components/BChatSidebar/hooks/useDraftInput.ts`，保留当前文本和文件引用能力，仅新增图片草稿相关状态与方法，不重写已有接口。

现有 hook 已包含并应继续保留：
- `setContent()`
- `setReferences()`
- `restoreFromMessage()`
- `getActiveReferences()`
- `isEmpty()`

本次新增：
- `draftImages`
- `addImages()`
- `removeImage()`
- `hasImages()`

示意代码如下：

```typescript
interface DraftInputOptions {
  focusInput: () => void;
}

export function useDraftInput(options: DraftInputOptions) {
  const inputValue = ref('');
  const draftReferences = ref<ChatMessageFileReference[]>([]);
  const draftImages = ref<ChatMessageFile[]>([]);

  function clear(): void {
    inputValue.value = '';
    draftReferences.value = [];
    draftImages.value = [];
    options.focusInput();
  }

  function setContent(content: string, references?: ChatMessageFileReference[]): void {
    inputValue.value = content;
    draftReferences.value = references ? [...references] : [];
  }

  function setReferences(references: ChatMessageFileReference[]): void {
    draftReferences.value = references;
  }

  function addImages(files: ChatMessageFile[]): void {
    draftImages.value.push(...files);
  }

  function removeImage(imageId: string): void {
    draftImages.value = draftImages.value.filter((image) => image.id !== imageId);
  }

  function restoreFromMessage(message: Message): void {
    inputValue.value = message.content;
    draftReferences.value = [...(message.references ?? [])];
    draftImages.value = [...(message.files?.filter((file) => file.type === 'image') ?? [])];
  }

  function getActiveReferences(content: string): ChatMessageFileReference[] | undefined {
    const references = draftReferences.value.filter((reference) => content.includes(reference.token));
    return references.length ? references : undefined;
  }

  function isEmpty(): boolean {
    return inputValue.value.trim().length === 0;
  }

  function hasImages(): boolean {
    return draftImages.value.length > 0;
  }

  return {
    inputValue,
    draftReferences,
    draftImages,
    clear,
    setContent,
    setReferences,
    addImages,
    removeImage,
    restoreFromMessage,
    getActiveReferences,
    isEmpty,
    hasImages
  };
}
```

说明：
- `draftReferences` 的类型保持为 `ChatMessageFileReference[]`
- `isEmpty()` 继续表示“文本输入是否为空”
- 统一提交条件建议在消费方组合计算，例如 `!draftInput.isEmpty() || draftInput.hasImages()`
- 恢复编辑消息时同步恢复图片草稿，避免编辑后丢图

### 3. 模型能力判断

参照 `src/ai/tools/policy.ts` 中现有的 `getModelToolSupport` 模式，在同文件新增视觉能力查询函数：

```typescript
export async function getModelVisionSupport(providerId: string, modelId: string): Promise<boolean> {
  const provider = await providerStorage.getProvider(providerId);
  if (!provider) return false;

  const model = provider.models?.find((item) => item.id === modelId);
  return model?.supportsVision === true;
}
```

`BChatSidebar/index.vue` 中增加 `supportsVision` 响应式状态，由当前 `selectedModel` 派生，并在异步派生时加入版本号防止模型快速切换导致竞态覆盖：

```typescript
let visionCheckVersion = 0;

watch(
  () => selectedModel.value,
  async (value) => {
    const version = ++visionCheckVersion;
    const parsed = parseSelectedModel(value);

    if (!parsed) {
      supportsVision.value = false;
      return;
    }

    const supported = await getModelVisionSupport(parsed.providerId, parsed.modelId);
    if (version === visionCheckVersion) {
      supportsVision.value = supported;
    }
  },
  { immediate: true }
);
```

约束：
- `supportsVision = false` 时不显示上传按钮
- `supportsVision = false` 时不接受新的图片粘贴和拖拽
- 已经在草稿中的图片，如果用户切换到不支持视觉的模型，则保留草稿，但禁止发送并显示提示

推荐交互：
- 提示文案：`当前模型不支持图片，请切换到支持视觉识别的模型后发送`

### 4. 图片工具函数

新增 `src/components/BChatSidebar/utils/imageUtils.ts`：

```typescript
import { nanoid } from 'nanoid';

/**
 * 将 File 对象转为 Base64 Data URL
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
 * 检查文件是否为图片
 * @param file - 浏览器 File 对象
 * @returns 是否为图片
 */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/**
 * 获取文件扩展名
 * @param filename - 文件名
 * @returns 小写扩展名，无扩展名时返回空字符串
 */
export function getFileExtension(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index >= 0 ? filename.slice(index + 1).toLowerCase() : '';
}

/**
 * 计算图片内容哈希
 * @param dataUrl - Base64 Data URL
 * @returns 稳定内容哈希
 */
export async function sha256(dataUrl: string): Promise<string> {
  // 具体实现可基于 Web Crypto
}

/**
 * 从 File 创建聊天图片附件
 * @param file - 浏览器 File 对象
 * @returns 聊天图片附件
 */
export async function createChatImageFile(file: File): Promise<ChatMessageFile> {
  const base64 = await fileToBase64(file);

  return {
    id: nanoid(),
    name: file.name,
    type: 'image',
    mimeType: file.type,
    size: file.size,
    extension: getFileExtension(file.name),
    url: base64,
    contentHash: await sha256(base64)
  };
}
```

实现要求：
- 单张图片限制 5MB
- 最多 6 张图片
- 图片总大小限制 15MB
- 只接受 `image/*`
- 转换失败时抛出异常，由调用方统一提示

### 5. 统一图片接入函数

在 `BChatSidebar/index.vue` 内新增统一入口函数：

```typescript
async function appendImagesToDraft(files: File[]): Promise<void>
```

职责：
1. 过滤非图片文件
2. 校验 `supportsVision`
3. 校验数量、单张大小和总大小上限
4. 并发转换为 `ChatMessageFile`
5. 追加到 `draftImages`
6. 失败时给出统一提示

这样可以保证按钮上传、粘贴、拖拽三种入口的行为一致，避免多处散落校验逻辑。

建议统一常量：

```typescript
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_IMAGE_COUNT = 6;
const MAX_TOTAL_IMAGE_SIZE = 15 * 1024 * 1024;
```

### 6. 粘贴与拖拽处理

这是本次设计的关键修订点。当前 `BPromptEditor` 的 `onPasteFiles` 接口类型为：

```typescript
type OnPasteFiles = (files: File[]) => Promise<string | null> | string | null;
```

虽然运行时对异步返回会 warning 并跳过插入，但文档必须基于现有类型做增量扩展，而不是改写成一个更窄的新类型。

#### 6.1 接口调整方向

将 `pasteHandler.ts` 从“同步构造插入字符串”扩展为“允许区分文件 token 插入与图片异步附件接管”的协议。

建议新增：

```typescript
type OnPasteFiles = (files: File[]) => Promise<string | null> | string | null;

interface PasteImageContext {
  text?: string;
  html?: string;
  imageFiles: File[];
  otherFiles: File[];
}

type OnPasteImages = (context: PasteImageContext) => Promise<void> | void;
type CanAcceptImages = () => boolean;
```

`BPromptEditor` 新增 props：
- `onPasteImages?: (context: PasteImageContext) => Promise<void> | void`
- `canAcceptImages?: () => boolean`

#### 6.2 pasteHandler 处理规则

`pasteHandler.ts` 的行为调整为：

1. 剪贴板或拖拽内容中没有文件时，保持现有行为
2. 只有非图片文件时，继续走现有 `onPasteFiles` token 插入流程
3. 包含图片文件时：
   - 若 `canAcceptImages()` 为 `false`，直接拦截并提示不支持图片
   - 统一 `event.preventDefault()`
   - 读取 `text/plain` / `text/html`
   - 若存在 `onPasteImages`，由其异步接管图片处理
   - 文本部分通过编辑器命令手动插入，而不是依赖浏览器默认粘贴
   - 对于混合文件，`otherFiles` 一并传入 `PasteImageContext`，由上层决定是否继续转 file-ref token
4. 图片接管场景下，不依赖浏览器默认插入，也不会受到当前“异步返回位置失效”的限制

#### 6.3 粘贴优先级

粘贴规则统一为：

1. 只有图片文件：
   - 拦截默认行为
   - 交给 `onPasteImages`
2. 只有文本：
   - 保持原生文本粘贴
3. 同时包含图片和文本：
   - 统一 `preventDefault`
   - 图片交给 `onPasteImages`
   - 文本通过编辑器命令手动补插入
4. 同时包含图片和非图片文件：
   - 统一 `preventDefault`
   - 图片进草稿区
   - 非图片由上层决定是否转 file-ref token

说明：
- 这里的关键是“图片作为附件草稿，不依赖编辑器插入位置”
- 不建议实现成“图片接管，但文本保持默认粘贴”，因为一旦 `preventDefault()`，浏览器默认文本粘贴也会被阻止

#### 6.4 拖拽兜底

拖拽图片到页面时，必须在编辑器区域或其外层输入容器处理 `dragover` / `drop` 的 `preventDefault()`，避免浏览器直接打开本地图片。

### 7. 上传按钮与纯图片发送交互

`InputToolbar.vue` 修改：
- 保持现有 `loading`、`inputValue`、`selectedModel` prop 不变
- 新增 `supportsVision` prop
- 新增 `canSubmit` prop
- 当 `supportsVision = true` 时显示图片上传按钮
- 点击图片按钮触发隐藏的 `<input type="file" accept="image/*" multiple">`
- 发送按钮禁用条件从 `!inputValue` 改为 `!canSubmit`
- 处理完成后重置隐藏 input 的 `value`，确保连续选择同一张图片仍能触发 `change`

推荐接口：

```typescript
interface Props {
  loading: boolean;
  inputValue: string;
  selectedModel?: string;
  supportsVision: boolean;
  canSubmit: boolean;
}
```

说明：
- `canSubmit` 由父组件统一计算，避免工具栏和提交逻辑分叉
- `BPromptEditor` 的 `Enter` 提交也应读取同一条件；`submitOnEnter` 触发后由父组件兜底判断，不允许出现“按回车无效但按钮可点”或反过来的状态

### 8. 消息构建与发送

修改 `BChatSidebar/index.vue` 的 `handleChatSubmit`：

```typescript
async function handleChatSubmit(): Promise<void> {
  const content = draftInput.inputValue.value.trim();
  const images = draftInput.draftImages.value;
  const summaryText = content || createImageOnlySummary(images.length);

  if (draftInput.isEmpty() && !draftInput.hasImages()) return;
  if (images.length > 0 && !supportsVision.value) return;

  const config = await stream.resolveServiceConfig();
  if (!config) return;

  const references = draftInput.getActiveReferences(content);
  const message = create.userMessage(summaryText, references);
  message.content = content || summaryText;
  message.parts = [{ type: 'text', text: message.content }];

  if (images.length) {
    message.files = [...images];
  }

  await handleBeforeSend(message);
  messages.value.push(message);
  draftInput.clear();

  await stream.streamMessages(messages.value, config);
}
```

这里保留了一个重要语义：
- **纯图片消息在持久化层也必须有文本摘要**

原因：
- 会话标题依赖 `message.content`
- 搜索依赖 `message.content`
- 首轮自动命名流程也依赖首条用户消息的文本

建议摘要策略：

```typescript
function createImageOnlySummary(count: number): string {
  return count === 1
    ? '用户上传了一张图片，请结合图片内容回答。'
    : `用户上传了 ${count} 张图片，请结合这些图片内容回答。`;
}
```

补充说明：
- `create.userMessage()` 已经会初始化 `parts`
- 此处显式重设 `message.content` 与 `message.parts`，是为了统一“有文本”和“纯图片摘要文本”两种分支的最终结构，避免双分支重复赋值

### 9. 模型消息转换

修改 `src/components/BChatSidebar/utils/messageHelper.ts` 内部私有函数 `toModelMessagesForMessage()`，并同步修改同文件中的 `createModelMessageSignature()`。对外暴露的 `convert.toModelMessages()` 和 `convert.toCachedModelMessages()` 不变。

```typescript
import type { ModelMessage, UserContent } from 'ai';

function toModelMessagesForMessage(message: Message): ModelMessage[] {
  if (!is.modelMessage(message)) return [];

  if (message.role === 'user') {
    const imageFiles = message.files?.filter((file) => file.type === 'image' && file.url) ?? [];

    if (!imageFiles.length) {
      return [{ role: 'user', content: message.content }];
    }

    const content: UserContent = [
      { type: 'text', text: message.content },
      ...imageFiles.map((file) => ({
        type: 'image' as const,
        image: file.url!,
        mediaType: file.mimeType
      }))
    ];

    return [{ role: 'user', content }];
  }

  return toAssistantModelMessages(message.parts);
}
```

说明：
- 文本片段始终保留，哪怕是纯图片摘要文本
- 图片直接传递 Data URL，AI SDK 会继续解析为可传给模型的数据内容

### 10. 模型消息缓存签名

这是本次设计必须明确补齐的点。

当前缓存签名只包含：
- `role`
- `content`
- `parts`

新增图片后，签名必须同时纳入 `files` 中对模型上下文有影响的字段，但**不要直接放完整 Base64 Data URL**，否则签名字符串会过大。

建议在 `createChatImageFile()` 阶段预计算 `contentHash`，签名中只纳入轻量字段：
- `id`
- `type`
- `mimeType`
- `size`
- `contentHash`

建议实现：

```typescript
function createModelMessageSignature(message: Message): string {
  return JSON.stringify({
    role: message.role,
    content: message.content,
    parts: message.parts,
    files: message.files?.map((file) => ({
      id: file.id,
      type: file.type,
      mimeType: file.mimeType,
      size: file.size,
      contentHash: file.contentHash
    }))
  });
}
```

结果：
- 编辑消息时增删图片会让缓存正确失效
- 重试发送时不会错误复用旧图片上下文
- 不会因为完整 Base64 被纳入签名而带来大体积 `JSON.stringify` 成本

### 11. UI 预览组件

在输入框上方添加图片预览条：

```vue
<div v-if="draftInput.draftImages.value.length" class="image-preview-bar">
  <div v-for="image in draftInput.draftImages.value" :key="image.id" class="image-preview-item">
    <img :src="image.url" :alt="image.name" />
    <BButton type="text" size="small" @click="draftInput.removeImage(image.id)">
      <Icon icon="lucide:x" />
    </BButton>
  </div>
</div>
```

样式要求：
- 横向排列的缩略图
- 每张图最大 60x60px，圆角
- 删除按钮悬浮在右上角
- 超出一行时支持横向滚动

### 12. 消息气泡渲染

`MessageBubble.vue` 已支持 `imageFiles` 渲染，无需改动结构。

现有行为满足本设计：

```vue
<div v-if="imageFiles.length" :class="bem('images')">
  <img v-for="file in imageFiles" :key="file.id" :src="file.url || file.path" :alt="file.name" />
</div>
```

只需确保：
- `url` 存在时优先使用 Base64 Data URL
- 纯图片消息也仍显示 header 和摘要文本，不出现“只有图片没有任何文本语义”的历史项

补充工程约束：
- `message.files[].url` 不参与全文搜索索引
- `message.files[].url` 不参与标题生成索引
- 会话列表缓存若需要摘要，只保存 `hasImages` / `imageCount` 这类轻量元数据

### 13. 编辑消息恢复

`useDraftInput.restoreFromMessage` 需要恢复：
- 文本内容
- 文件引用
- 图片草稿

编辑后再次发送时，缓存签名也会因为 `files` 纳入签名而正确刷新。

## 文件改动清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/components/BChatSidebar/hooks/useDraftInput.ts` | 修改 | 增加 `draftImages` 状态、`addImages()`、`removeImage()`、`hasImages()`，保留现有文本/引用接口 |
| `src/components/BChatSidebar/utils/imageUtils.ts` | 新增 | 图片处理工具函数、扩展名工具和 `contentHash` 计算 |
| `src/components/BChatSidebar/components/InputToolbar.vue` | 修改 | 添加图片上传按钮、`supportsVision` 和 `canSubmit` |
| `src/components/BChatSidebar/index.vue` | 修改 | 集成图片上传、预览、统一图片接入、模型能力派生与发送流程 |
| `src/components/BChatSidebar/utils/messageHelper.ts` | 修改 | 调整内部 `toModelMessagesForMessage()`，并扩展 `createModelMessageSignature()` |
| `src/components/BChatSidebar/utils/types.ts` | 无需修改 | 已确认 `Message.files` 字段已存在 |
| `src/components/BPromptEditor/index.vue` | 修改 | 新增图片接管相关 props 并透传给 `pasteHandler` |
| `src/components/BPromptEditor/extensions/pasteHandler.ts` | 修改 | 支持图片异步接管与混合粘贴/拖拽策略 |
| `src/components/BPromptEditor/types.ts` | 修改 | 为图片接管新增类型声明 |
| `src/ai/tools/policy.ts` | 修改 | 参照 `getModelToolSupport` 新增 `getModelVisionSupport` |

## 错误处理

1. **图片过大**：限制单张图片 5MB，超出时提示用户
2. **图片过多**：最多 6 张，超出时提示用户
3. **图片总大小过大**：总大小超过 15MB 时提示用户
4. **非图片文件**：按钮通过 `accept="image/*"` 过滤，粘贴/拖拽时忽略或走原有文件引用逻辑
5. **Base64 转换失败**：提示用户“图片处理失败”
6. **模型不支持图片**：不显示上传按钮，并拒绝新的图片粘贴/拖拽
7. **模型切换竞态**：通过版本号保证 `supportsVision` 不被旧请求覆盖
8. **模型切换**：已有图片草稿在切换到非视觉模型后保留，但禁止发送并提示用户切换模型
9. **混合内容**：图片与文本同时粘贴时，文本由编辑器命令手动插入，图片进入草稿区
10. **拖拽默认行为**：`dragover` / `drop` 必须 `preventDefault()`，避免浏览器直接打开本地图片

## 性能考虑

1. **Base64 体积**：比原始文件大约增加三分之一，建议限制单张 5MB、最多 6 张、总大小 15MB
2. **数据库大小**：消息记录包含 Base64 字符串，大量图片会导致数据库膨胀，因此 Base64 字段不参与搜索和列表摘要索引
3. **缓存签名大小**：模型消息签名只纳入 `contentHash` 等轻量字段，不直接纳入完整 Base64
4. **渲染性能**：预览区首版直接使用原图，后续可以引入缩略图生成

## 实现顺序建议

建议按以下顺序开发，风险最低：

1. 先改 `ChatMessageFile` / `messageHelper.ts`，打通 `message.files -> ModelMessage` 转换
2. 再改 `createModelMessageSignature()`，但使用 `contentHash`，不要直接纳入完整 Base64
3. 再做 `useDraftInput.draftImages` 和纯图片发送
4. 再做上传按钮
5. 最后做粘贴和拖拽，因为这块最容易影响现有编辑器行为

## 测试建议

至少覆盖以下场景：

1. 支持视觉模型下，按钮上传单图和多图成功
2. 支持视觉模型下，纯图片消息可以发送
3. 不支持视觉模型下，按钮不显示，粘贴/拖拽图片被拦截
4. 图片与文本同时粘贴时，文本仍进入编辑器，图片进入草稿区
5. 编辑一条带图消息并增删图片后，模型缓存不会复用旧上下文
6. 纯图片首消息创建会话后，会话标题不是空字符串
7. 快速切换模型时，`supportsVision` 不会被旧请求结果覆盖
8. 连续选择同一张图片两次时，上传 input 仍能触发 `change`

## 未来扩展

1. 图片压缩
2. 缩略图生成
3. 多图拖拽排序
4. 图片点击放大
5. 更自然的纯图片文本摘要生成
