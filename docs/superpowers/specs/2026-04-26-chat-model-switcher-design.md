# Chat Model Switcher Design

## Overview

在 BChatSidebar 中添加模型切换功能，允许用户快速切换聊天使用的模型。

## Components

### 新增组件：InputToolbar

**位置**：`src/components/BChatSidebar/components/InputToolbar.vue`

**职责**：管理聊天输入区域的工具栏，包含模型选择器和操作按钮。

**Props**：
```typescript
interface Props {
  /** 是否正在加载 */
  loading: boolean;
  /** 输入框内容 */
  inputValue: string;
  /** 当前选中的模型 (providerId:modelId) */
  selectedModel?: string;
}
```

**Emits**：
```typescript
interface Emits {
  /** 发送消息 */
  (e: 'submit'): void;
  /** 停止生成 */
  (e: 'abort'): void;
  /** 模型改变 */
  (e: 'model-change', value: string): void;
}
```

### 新增组件：ModelSelector

**位置**：`src/components/BChatSidebar/components/InputToolbar/ModelSelector.vue`

**职责**：加载可用模型列表，显示当前选中的模型，处理模型选择和保存。

**Props**：
```typescript
interface Props {
  /** 当前选中的模型 (providerId:modelId) */
  model: string | undefined;
}
```

**Emits**：
```typescript
interface Emits {
  (e: 'update:model', value: string): void;
}
```

**内部逻辑**：
- `onMounted` 时加载 providers 和当前配置
- 使用 `BSelect` 组件，配置为按钮模式
- 选择模型后立即调用 `serviceModelsStorage.saveConfig()`

## Component Structure

```
BChatSidebar
├── SidebarHeader
│   ├── SessionTitle
│   └── SessionHistory
├── ConversationView
└── ChatPanel
    ├── BPromptEditor
    └── InputToolbar (新增)
        ├── ModelSelector
        └── ActionButtons
```

## Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                    BChatSidebar                         │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │              InputToolbar                        │   │
│  │                                                 │   │
│  │  ┌─────────────┐     ┌──────────────────────┐  │   │
│  │  │ModelSelector│     │   ActionButtons     │  │   │
│  │  │             │     │                      │  │   │
│  │  │ - 加载模型  │     │ - 提交/停止         │  │   │
│  │  │ - 选择保存  │     │                      │  │   │
│  │  └─────────────┘     └──────────────────────┘  │   │
│  └─────────────────────────────────────────────────┘   │
│         ▲                   △                         │
│         │                   │                         │
│  ┌─────┴───────────────────┴─────┐                   │
│  │    handleModelChange()           │                   │
│  │    handleChatSubmit()            │                   │
│  └─────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────┘

存储层：
providerStorage.listProviders() → 获取模型列表
serviceModelsStorage.getConfig('chat') → 获取当前配置
serviceModelsStorage.saveConfig('chat', config) → 保存配置
```

## Styling

**InputToolbar 容器**：
- `display: flex`
- `align-items: center`
- `gap: 8px`
- `padding: 0 12px`
- 放置在输入框右侧

**模型选择按钮**：
- 圆形图标按钮风格
- 显示当前模型的图标（使用 `BModelIcon`）
- 悬停时显示下拉列表

## Behavior

1. 组件挂载时，`ModelSelector` 自动加载可用模型列表
2. 用户点击模型按钮，下拉列表显示可用模型
3. 用户选择模型后，立即保存到 `serviceModelsStorage`
4. 后续发送消息使用新模型
5. 模型切换不影响当前会话的消息历史

## Storage APIs

| API | 用途 |
|-----|------|
| `providerStorage.listProviders()` | 获取所有提供商和模型列表 |
| `serviceModelsStorage.getConfig('chat')` | 获取当前聊天模型配置 |
| `serviceModelsStorage.saveConfig('chat', config)` | 保存模型配置 |

## Model Value Format

模型值格式：`providerId:modelId`

例如：`openai:gpt-4`、`anthropic:claude-3-opus`
