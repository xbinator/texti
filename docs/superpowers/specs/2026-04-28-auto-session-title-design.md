# 话题自动命名助理 — 设计文档

## 概述

在 BChatSidebar 中，新增「话题自动命名助理」服务。当用户新建会话并完成首轮对话后，异步调用 LLM 根据对话内容自动生成一个简洁的会话标题，替代当前直接将用户首条消息内容作为标题的行为。

---

## 需求汇总

| 维度 | 决策 |
|------|------|
| 触发时机 | 首轮对话完成后异步生成（不阻塞 UI） |
| 生成输入 | 用户首条消息 + AI 第一条回复（完整首轮对话） |
| 失败降级 | 静默降级为当前行为（用户首条消息作为标题） |
| 模型配置 | 独立的服务配置（与 chat/polish 模式一致） |
| 手动入口 | 暂不需要 |
| 重复生成 | 每个会话仅生成一次 |

---

## 架构

```
                             首轮对话完成
                                  │
                                  ▼
BChatSidebar.handleComplete ──→ autoNameSession()
   (第 216 行)                   │
                                  ├── 已命名过？ ──→ Yes ──→ 跳过
                                  │
                                  ├── 有 autoname 配置？ ──→ No ──→ 降级，保持现有标题
                                  │
                                  ▼
                          构建 Prompt（将 {{USER_MESSAGE}} 和 {{AI_RESPONSE}} 替换为实际内容）
                                  │
                                  ▼
                         调用 LLM（agent.invoke，非流式单次调用）
                                  │
                                  ▼
                         更新 session.title 到存储（chatStorage.createSession UPSERT）
                                  │
                                  ▼
                         更新 currentSession.title（响应式，UI 自动刷新）
```

### 设计原则

- **完全异步**：生成过程不阻塞用户输入、不影响对话流、不导致 UI 冻结
- **静默降级**：任何环节失败（模型未配置、API 报错、返回为空）均不影响正常对话流程
- **仅触发一次**：用 ref 标记，确保每个会话只生成一次标题，避免不必要的重复调用
- **遵循现有模式**：复用了现有的服务配置体系（serviceModelsStorage / ServiceConfig / ModelServiceType）

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `types/model.d.ts` | 修改 | `ModelServiceType` 类型增加 `'autoname'` |
| `src/views/settings/service-model/constants.ts` | 修改 | 新增 `AUTONAME_SERVICE_CONFIG_OPTIONS` 和 `AUTONAME_DEFAULT_PROMPT` |
| `src/views/settings/service-model/index.vue` | 修改 | 新增第三个 `ServiceConfig` 卡片 |
| `src/components/BChatSidebar/hooks/useAutoName.ts` | 新增 | 可组合函数，封装命名逻辑 |
| `src/components/BChatSidebar/index.vue` | 修改 | 在 `handleComplete` 中集成调用，管理会话状态 |

---

## 模块设计

### 1. 类型扩展 — `types/model.d.ts`

```typescript
export type ModelServiceType = 'polish' | 'chat' | 'autoname';
```

仅增加一个联合类型成员，其他接口和存储层无需改动（已泛型支持）。

### 2. 常量配置 — `src/views/settings/service-model/constants.ts`

新增以下导出：

```typescript
/** 自动命名服务的变量选项（用于 Prompt 编辑器中的 chip 提示） */
export const AUTONAME_SERVICE_CONFIG_OPTIONS: ServiceConfigOption[] = [
  {
    type: 'variable',
    options: [
      { value: 'USER_MESSAGE', label: '用户首条消息' },
      { value: 'AI_RESPONSE', label: 'AI回复' }
    ]
  }
];

/** 自动命名默认 Prompt 模板 */
export const AUTONAME_DEFAULT_PROMPT = `# Role
你是一个会话标题生成器。

# Task
根据用户与 AI 的对话内容，生成一个简洁准确的会话标题。

# Rules
1. 标题长度不超过 20 个汉字
2. 标题应概括对话的核心主题，而非描述对话格式
3. 只输出标题文本，不要包含引号、标点或任何额外说明
4. 使用用户使用的语言（中文对话输出中文标题，英文对话输出英文标题）

# Conversation
用户: {{USER_MESSAGE}}

AI: {{AI_RESPONSE}}

# Title
`;
```

### 3. 设置页 UI — `src/views/settings/service-model/index.vue`

在现有 `ServiceConfig` 卡片下方新增：

```html
<ServiceConfig
  service-type="autoname"
  title="话题自动命名助理"
  description="指定用于自动生成会话标题的模型"
  :options="AUTONAME_SERVICE_CONFIG_OPTIONS"
  :default-prompt="AUTONAME_DEFAULT_PROMPT"
/>
```

导入新增的常量：
```typescript
import { ..., AUTONAME_SERVICE_CONFIG_OPTIONS, AUTONAME_DEFAULT_PROMPT } from './constants';
```

### 4. 自动命名 Hook — `src/components/BChatSidebar/hooks/useAutoName.ts`

```typescript
import { ref } from 'vue';
import type { ChatSession } from 'types/chat';
import { useChat } from '@/hooks/useChat';
import { useServiceModelStore } from '@/stores/service-model';
import { chatStorage } from '@/shared/storage';
import { AUTONAME_DEFAULT_PROMPT } from '@/views/settings/service-model/constants';

/**
 * 自动命名配置接口
 */
interface AutoNameOptions {
  /** 获取当前激活的会话对象（响应式） */
  getCurrentSession: () => ChatSession | undefined
  /** 获取首轮对话内容（user + assistant 消息） */
  getFirstRoundContent: () => { userMessage: string; aiResponse: string } | null
}

/**
 * 自动会话命名 Hook
 * 在首轮对话完成后异步调用 LLM 生成标题，失败时静默降级。
 */
export function useAutoName(options: AutoNameOptions) {
  /** 标记当前会话是否已触发过自动命名 */
  const named = ref(false);
  /** AI 调用代理 */
  const { agent } = useChat({});
  /** 服务模型存储（用于读取 autoname 配置） */
  const serviceModelStore = useServiceModelStore();

  /**
   * 检查并执行自动命名
   * 仅在首轮对话完成、且未命名过、且服务已配置时触发。
   */
  async function checkAndAutoName(): Promise<void> {
    if (named.value) return;

    const session = options.getCurrentSession();
    if (!session) return;

    // 1. 获取首轮对话内容
    const content = options.getFirstRoundContent();
    if (!content) return;

    // 2. 解析 autoname 服务配置
    const serviceConfig = await serviceModelStore.getAvailableServiceConfig('autoname');
    if (!serviceConfig?.providerId || !serviceConfig?.modelId) {
      // 无可用配置，标记为已命名以跳过后续检查
      named.value = true;
      return;
    }

    // 3. 构建 Prompt（替换变量占位符）
    const customPrompt = serviceConfig.customPrompt || AUTONAME_DEFAULT_PROMPT;
    const prompt = customPrompt
      .replace(/\{\{USER_MESSAGE\}\}/g, content.userMessage)
      .replace(/\{\{AI_RESPONSE\}\}/g, content.aiResponse);

    try {
      // 4. 调用 LLM，使用 invoke（非流式）获取标题文本
      const [error, result] = await agent.invoke({
        providerId: serviceConfig.providerId,
        modelId: serviceConfig.modelId,
        prompt
      });

      if (error || !result?.text) return;

      // 5. 清理标题文本（去除可能的引号、空白、多余换行）
      const title = result.text
        .replace(/^["'\u201c\u201d\u2018\u2019]|["'\u201c\u201d\u2018\u2019]$/g, '')
        .trim();

      if (!title) return;

      // 6. 持久化更新标题
      const updatedSession: ChatSession = { ...session, title };
      await chatStorage.createSession(updatedSession);

      // 7. 更新响应式会话对象，触发 UI 刷新
      session.title = title;
    } catch {
      // 静默失败，不做任何处理
    } finally {
      named.value = true;
    }
  }

  /**
   * 重置命名状态（切换/新建会话时调用）
   */
  function reset(): void {
    named.value = false;
  }

  return { checkAndAutoName, reset };
}
```

**关键设计决策**：
- 使用 `agent.invoke()`（非流式），因为标题生成只需最终文本，无需实时显示过程。
- 通过 `chatStorage.createSession(session)` 做 UPSERT——`createSession` 底层使用 `INSERT OR REPLACE`，传入同 ID 的 session 即可更新标题。
- 直接修改 `session.title` 来触发响应式更新，无需额外的事件机制。
- `customPrompt` 优先级高于 `AUTONAME_DEFAULT_PROMPT`，用户可以在设置页自由定制。

### 5. 集成点 — `src/components/BChatSidebar/index.vue`

#### 5.1 导入 Hook

```typescript
import { useAutoName } from './hooks/useAutoName';
```

#### 5.2 初始化 Hook（在 setup 中，与其他 hook 并列）

```typescript
const { checkAndAutoName, reset: resetAutoName } = useAutoName({
  getCurrentSession: () => currentSession.value,
  getFirstRoundContent: () => {
    // 首轮：恰好有 1 条 user + 1 条 assistant 消息（含 thinking/确认消息不算）
    const userMsgs = messages.value.filter(m => m.role === 'user');
    const assistantMsgs = messages.value.filter(m => m.role === 'assistant');
    if (userMsgs.length === 1 && assistantMsgs.length === 1) {
      return {
        userMessage: userMsgs[0].content,
        aiResponse: assistantMsgs[0].content
      };
    }
    return null;
  }
});
```

#### 5.3 在 `handleComplete` 中触发

第 215-217 行现有代码：
```typescript
async function handleComplete(message: Message): Promise<void> {
  await chatStore.addSessionMessage(settingStore.chatSidebarActiveSessionId, message);
}
```

修改为：
```typescript
async function handleComplete(message: Message): Promise<void> {
  await chatStore.addSessionMessage(settingStore.chatSidebarActiveSessionId, message);
  checkAndAutoName(); // 不在 await，完全异步、非阻塞
}
```

#### 5.4 在切换/新建会话时重置

`handleSwitchSession` 中增加 `resetAutoName()`：
```typescript
async function handleSwitchSession(sessionId: string): Promise<void> {
  // ... 现有逻辑 ...
  resetAutoName();
  // ... 现有逻辑 ...
}
```

`handleNewSession` 中增加 `resetAutoName()`：
```typescript
async function handleNewSession(): Promise<void> {
  // ... 现有逻辑 ...
  resetAutoName();
  // ... 现有逻辑 ...
}
```

---

## 错误处理

| 场景 | 策略 |
|------|------|
| `autoname` 服务未配置（用户从未设置） | 静默降级，保留现有标题（用户首条消息内容） |
| 服务已配置但模型不可用（provider 离线等） | `getAvailableServiceConfig` 返回 null，同上 |
| API 调用出错（网络/超时/Key 失效） | catch 静默处理，标题不变 |
| LLM 返回空文本或纯空格 | 保留现有标题 |
| LLM 返回超长文本 | Prompt 中已约束 20 字以内；即使超长，清理后设置不超过 50 字符可考虑截断（或不处理，交给 UI 层处理 overflow） |
| 用户快速切换会话 | `reset()` 重置 named 标记，新会话正常触发 |

---

## 测试要点

### 单元测试（`useAutoName`）

1. 首次调用（有完整首轮内容 + 有效配置）→ 标题成功生成并更新
2. 无 autoname 配置 → named 标记为 true，不发起 AI 调用
3. 当前非首轮（多条消息）→ `getFirstRoundContent` 返回 null，不触发
4. `named` 标记已为 true → 重复调用直接跳过
5. AI 调用返回 error → catch 静默处理，named 仍标记为 true
6. `reset()` 后 → named 重置，可再次触发

### 集成测试（BChatSidebar）

1. 新建会话 → 发送首条消息 → AI 回复完成 → 标题被替换为自动生成值
2. 切换会话后再切换回来 → 标题不变（不重复生成）
3. 未配置 autoname 服务 → 标题保持为用户首条消息内容
4. 多轮对话 → 不触发自动命名
5. 新建会话后立即发送第二条消息 → 仅首轮触发

### 手动验证

1. 在设置页新增 autoname 配置卡片，可正常选择模型和编辑 Prompt
2. 不与 chat/polish 配置冲突
3. 切换会话时标题正确重置
