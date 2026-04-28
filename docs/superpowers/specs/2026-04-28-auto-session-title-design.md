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
                     handleComplete 每次触发（含工具续轮中间态）
                                  │
                                  ▼
                 captureSnapshot() — 冻结当前 sessionId + 对话内容为纯数据快照
                                  │
                                  ▼
              scheduleAutoName(snap, isLoading) — 按 sessionId 独立排入/刷新任务
              （每会话维护独立的 pendingTasks[sessionId] + 防抖定时器）
                                  │
                                  ▼
             定时器到期 + loading === false → doAutoName(snap)
                                  │
                                  ├── snap.sessionId 已命名？ ──→ Yes ──→ 跳过
                                  │
                                  ├── autoname 未配置？ ──→ Yes ──→ 标记已处理
                                  │
                                  ▼
                      用快照中的 userMessage / aiResponse 构建 Prompt
                                  │
                                  ▼
                         调用 LLM（agent.invoke，非流式单次调用）
                                  │
                                  ▼
                   chatStorage.updateSessionTitle(snap.sessionId, title)
                          （始终持久化，不受当前会话变化影响）
                                  │
                                  ▼
              仅当当前会话仍匹配时 → currentSession.title = title（UI 刷新）
```

### 设计原则

- **完全异步**：生成过程不阻塞用户输入、不影响对话流、不导致 UI 冻结
- **静默降级**：任何环节失败（模型未配置、API 报错、返回为空）均不影响正常对话流程
- **竞态安全**：按 sessionId 维护独立的 `pendingTasks` 与 `namedSessionIds`；不同会话的防抖定时器和命名标记完全隔离，跨会话操作不互相吞掉任务
- **精确触发时机**：handleComplete 触发时用 `captureSnapshot()` 冻结当前上下文；通过 debounce（300ms）+ loading 门禁，确保在首轮流式真正完成后才基于最终快照执行
- **持久化与 UI 解耦**：标题始终写到快照 sessionId（用户切走后旧会话依然被命名）；`currentSession.title` 仅当用户仍在查看该会话时才同步更新
- **最小化持久化**：标题更新使用 `UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?`，不覆盖 `lastMessageAt`/`usage` 等业务元数据
- **遵循现有模式**：复用了现有的服务配置体系（serviceModelsStorage / ServiceConfig / ModelServiceType）

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `types/model.d.ts` | 修改 | `ModelServiceType` 类型增加 `'autoname'` |
| `src/views/settings/service-model/constants.ts` | 修改 | 新增 `AUTONAME_SERVICE_CONFIG_OPTIONS` 和 `AUTONAME_DEFAULT_PROMPT` |
| `src/views/settings/service-model/index.vue` | 修改 | 新增第三个 `ServiceConfig` 卡片 |
| `src/shared/storage/chats/sqlite.ts` | 修改 | 新增 `UPDATE_SESSION_TITLE_SQL` 常量和 `chatStorage.updateSessionTitle` 方法（含 fallback） |
| `src/stores/chat.ts` | 修改 | 新增 `updateSessionTitle` action |
| `src/components/BChatSidebar/hooks/useAutoName.ts` | 新增 | 可组合函数，封装命名逻辑（含 debounce） |
| `src/components/BChatSidebar/index.vue` | 修改 | 集成 `useAutoName` Hook，新增 `sessionHistoryRef` 组件实例引用并在 `handleComplete` 中触发自动命名 |

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

### 4. 存储层 & Store 层 — 新增 `updateSessionTitle`

#### 背景

现有 `chatStorage.createSession(session)` 底层使用 `INSERT OR REPLACE`（见 `sqlite.ts:31-35`），传入同 ID 的完整 session 对象会覆盖所有字段（`title`、`lastMessageAt`、`usage`、`updatedAt` 等）。若用此方法回写标题，会将 `addSessionMessage` 中单独更新的 `lastMessageAt`/`usage` 覆盖为旧值，破坏会话排序和 Token 统计。需要一个**只更新 title** 的专用方法。

#### 实际代码结构

`chatStorage` 是 `sqlite.ts` 中直接导出的**对象字面量**（非 class），每个方法通过模块级 SQL 常量与 `dbExecute`/`dbSelect` 操作 SQLite，并在 `!isDatabaseAvailable()` 时走 `loadFallbackSessions`/`saveFallbackSessions` 的本地存储降级路径。`index.ts` 仅做 re-export。

#### 4.1 SQL 常量 — `src/shared/storage/chats/sqlite.ts`

在现有 SQL 常量声明区（约第 40 行附近）新增：

```typescript
const UPDATE_SESSION_TITLE_SQL = `
  UPDATE chat_sessions
  SET title = ?, updated_at = ?
  WHERE id = ?
`;
```

同时更新 `updated_at`。这会改变 `last_message_at DESC, updated_at DESC, created_at DESC` 排序中的二级排序位置——属于**有意行为**，标题变更被视作会话元数据的实质更新。

#### 4.2 对象方法 — `src/shared/storage/chats/sqlite.ts`

在 `chatStorage` 对象字面量中新增方法（与 `updateSessionLastMessageAt` 并列）：

```typescript
async updateSessionTitle(sessionId: string, title: string): Promise<void> {
  if (!isDatabaseAvailable()) {
    const sessions = loadFallbackSessions();
    const index = sessions.findIndex((item) => item.id === sessionId);
    if (index === -1) return;

    sessions[index] = { ...sessions[index], title, updatedAt: new Date().toISOString() };
    saveFallbackSessions(sortSessions(sessions));
    return;
  }

  await dbExecute(UPDATE_SESSION_TITLE_SQL, [title, new Date().toISOString(), sessionId]);
}
```

#### 4.3 无需改 `index.ts`

`chatStorage` 直接从 `sqlite.ts` 导出，无需经过接口层。

#### 4.4 Store Action — `src/stores/chat.ts`

在 `useChatStore` 的 actions 中新增：

```typescript
async updateSessionTitle(sessionId: string, title: string): Promise<void> {
  await chatStorage.updateSessionTitle(sessionId, title);
}
```

### 5. 自动命名 Hook — `src/components/BChatSidebar/hooks/useAutoName.ts`

```typescript
import { ref } from 'vue';
import { useChat } from '@/hooks/useChat';
import { useServiceModelStore } from '@/stores/service-model';
import { useChatStore } from '@/stores/chat';
import { AUTONAME_DEFAULT_PROMPT } from '@/views/settings/service-model/constants';

const DEBOUNCE_MS = 300;

/**
 * 自动命名快照
 * 在 handleComplete 触发时冻结，确保后续异步操作不受会话切换/消息增删影响。
 */
interface AutoNameSnapshot {
  /** 目标会话 ID（持久化的锚点，不受当前会话变化影响） */
  sessionId: string
  /** 用户首条消息内容 */
  userMessage: string
  /** AI 首条回复内容 */
  aiResponse: string
}

/**
 * 单个会话的待处理命名任务
 * 每个会话独立维护自己的快照和防抖定时器，互不干扰。
 */
interface PendingAutoNameTask {
  snapshot: AutoNameSnapshot
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * 自动命名配置接口
 */
interface AutoNameOptions {
  /**
   * 获取当前激活的会话 ID（持久化锚点，必须来自 store）
   * 不能用 currentSession（UI 镜像），因为新会话首轮快速完成时 currentSession 可能尚未由 SessionHistory 异步回填。
   * 值来源：settingStore.chatSidebarActiveSessionId
   */
  getCurrentSessionId: () => string | undefined
  /**
   * 获取当前激活的会话对象（响应式）
   * 仅用于 UI 同步判断——是否仍在查看该会话、是否更新 currentSession.title。
   */
  getCurrentSession: () => { id: string; title: string } | undefined
  /** 获取首轮对话内容，仅在 handleComplete 触发时调用来构建快照 */
  getFirstRoundContent: () => { userMessage: string; aiResponse: string } | null
  /**
   * 标题持久化成功后回调
   * 用于触发会话历史列表刷新，使侧边栏中后台命名的会话标题立即可见。
   * BChatSidebar 集成时传入 sessionHistoryRef.value?.refreshSessions
   */
  onTitlePersisted?: (sessionId: string, title: string) => Promise<void> | void
}

/**
 * 自动会话命名 Hook
 */
export function useAutoName(options: AutoNameOptions) {
  /** 已命名的会话 ID 集合。写入 sessionId 标记该会话已完成命名 */
  const namedSessionIds = ref(new Set<string>());
  /** 按 sessionId 维护的待处理任务。每会话独立计时，互不覆盖 */
  const pendingTasks = ref(new Map<string, PendingAutoNameTask>());
  /** AI 调用代理 */
  const { agent } = useChat({});
  /** 服务模型存储 */
  const serviceModelStore = useServiceModelStore();
  /** 聊天存储 */
  const chatStore = useChatStore();

  /**
   * 从当前实时上下文构建快照
   * sessionId 来自 store（stable），不依赖 currentSession（UI 镜像）。
   * @returns 快照对象，若非首轮或无活跃会话则返回 null
   */
  function captureSnapshot(): AutoNameSnapshot | null {
    const content = options.getFirstRoundContent();
    if (!content) return null;
    const sessionId = options.getCurrentSessionId();
    if (!sessionId) return null;
    return {
      sessionId,
      userMessage: content.userMessage,
      aiResponse: content.aiResponse
    };
  }

  /**
   * 执行自动命名
   * 基于快照而非实时上下文，确保上下文变化不丢失目标。
   * @param snap - 冻结的快照
   */
  async function doAutoName(snap: AutoNameSnapshot): Promise<void> {
    // 0. 竞态检查：同一会话不重复命名
    if (namedSessionIds.value.has(snap.sessionId)) return;

    // 1. 解析 autoname 服务配置
    const serviceConfig = await serviceModelStore.getAvailableServiceConfig('autoname');
    if (!serviceConfig?.providerId || !serviceConfig?.modelId) {
      namedSessionIds.value.add(snap.sessionId);
      return;
    }

    // 2. 构建 Prompt
    const customPrompt = serviceConfig.customPrompt || AUTONAME_DEFAULT_PROMPT;
    const prompt = customPrompt
      .replace(/\{\{USER_MESSAGE\}\}/g, snap.userMessage)
      .replace(/\{\{AI_RESPONSE\}\}/g, snap.aiResponse);

    try {
      // 3. 调用 LLM
      const [error, result] = await agent.invoke({
        providerId: serviceConfig.providerId,
        modelId: serviceConfig.modelId,
        prompt
      });

      if (error || !result?.text) return;

      // 4. 清理标题文本
      const title = result.text
        .replace(/^["'\u201c\u201d\u2018\u2019]|["'\u201c\u201d\u2018\u2019]$/g, '')
        .trim();

      if (!title) return;

      // 5. 持久化：始终写到快照 sessionId，不受当前会话变化影响
      await chatStore.updateSessionTitle(snap.sessionId, title);

      // 6. UI 同步：仅当用户仍在查看该会话时才更新响应式标题
      if (options.getCurrentSession()?.id === snap.sessionId) {
        const session = options.getCurrentSession();
        if (session) {
          session.title = title;
        }
      }

      // 7. 刷新历史列表：失败不影响已成功的持久化和当前会话 UI 更新
      try {
        await options.onTitlePersisted?.(snap.sessionId, title);
      } catch {
        // 静默失败
      }
    } catch {
      // 静默失败
    } finally {
      namedSessionIds.value.add(snap.sessionId);
    }
  }

  /**
   * 为指定会话排入/刷新防抖命名任务
   * 每个会话独立计时，互不覆盖。工具续轮中的中间态完成会不断刷新定时器。
   * @param snap - 冻结的快照
   * @param isLoading - 判断当前流式是否仍在进行中
   */
  function scheduleAutoName(snap: AutoNameSnapshot, isLoading: () => boolean): void {
    const sessionId = snap.sessionId;

    // 获取或创建该会话的待处理任务
    let task = pendingTasks.value.get(sessionId);
    if (!task) {
      task = { snapshot: snap, timer: null };
      pendingTasks.value.set(sessionId, task);
    } else {
      // 刷新快照（中间态完成时更新为最新内容）并重置定时器
      task.snapshot = snap;
      if (task.timer) clearTimeout(task.timer);
    }

    task.timer = setTimeout(async () => {
      if (isLoading()) {
        // 流式仍在进行中（如工具续轮），重新计时
        scheduleAutoName(pendingTasks.value.get(sessionId)?.snapshot ?? snap, isLoading);
        return;
      }
      // 流式停稳，执行命名
      await doAutoName(snap);
      // 清理该会话的待处理任务
      pendingTasks.value.delete(sessionId);
    }, DEBOUNCE_MS);
  }

  return { captureSnapshot, scheduleAutoName };
}
```

**关键设计决策**：
- **按 sessionId 独立任务**：`pendingTasks` 是 `Map<string, PendingAutoNameTask>`，每个会话独立维护自己的快照和定时器。会话 A 的定时器不会被会话 B 的 `clearTimeout` 影响，跨会话操作不会吞掉任务。
- **快照冻结**：`captureSnapshot()` 在 `handleComplete` 触发时冻结当前上下文，返回纯数据而非写入全局 state。后续 `doAutoName` 只读快照，不受实时上下文影响。
- **持久化锚点与 UI 镜像分离**：`sessionId` 来自 `settingStore.chatSidebarActiveSessionId`（store，稳定）；`currentSession`（UI 镜像）仅用于 UI 同步。避免新会话首轮快速完成时 `currentSession` 尚未由 SessionHistory 异步回填而导致漏触发。
- **后台命名刷新列表**：通过 `onTitlePersisted` 回调在持久化成功后触发 `SessionHistory.refreshSessions()`，使侧边栏列表中后台命名的会话标题立即可见；该回调失败时只静默忽略，不影响已完成的持久化和当前会话 UI 同步。
- **竞态安全**：`namedSessionIds` 是 `Set<string>`，按 sessionId 标记；旧会话请求 resolve 不会影响新会话。
- **最小化持久化**：`chatStore.updateSessionTitle` 执行 `UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?`。同时刷新 `updated_at` 是**有意行为**：表示会话元数据发生过变更，在 `last_message_at` 相同的会话间会影响二级排序。这属于可接受的 trade-off。
- `customPrompt` 优先于默认 Prompt。
- 不需要外部 `reset()`，sessionId 隔离 + `namedSessionIds` Set 天然处理切会话。

### 6. 集成点 — `src/components/BChatSidebar/index.vue`

#### 6.1 导入 Hook 与组件实例引用

```typescript
import { ref } from 'vue';
import { useAutoName } from './hooks/useAutoName';
import SessionHistory from './components/SessionHistory.vue';

const sessionHistoryRef = ref<InstanceType<typeof SessionHistory>>();
```

#### 6.2 初始化 Hook（在 setup 中，与其他 hook 并列）

```typescript
const { captureSnapshot, scheduleAutoName } = useAutoName({
  // 持久化锚点来自 store，不依赖 currentSession（UI 镜像）
  getCurrentSessionId: () => settingStore.chatSidebarActiveSessionId,
  // 仅用于 UI 同步判断——是否仍在查看该会话
  getCurrentSession: () => currentSession.value,
  getFirstRoundContent: () => {
    // 首轮：恰好有 1 条 user + 1 条 assistant 消息（thinking/确认消息不算独立消息）
    const userMsgs = messages.value.filter(m => m.role === 'user');
    const assistantMsgs = messages.value.filter(m => m.role === 'assistant');
    if (userMsgs.length === 1 && assistantMsgs.length === 1) {
      return {
        userMessage: userMsgs[0].content,
        aiResponse: assistantMsgs[0].content
      };
    }
    return null;
  },
  // 后台命名成功后刷新侧边栏会话列表
  onTitlePersisted: async () => {
    await sessionHistoryRef.value?.refreshSessions();
  }
});
```

注意：`sessionHistoryRef.value?.refreshSessions()` 依赖 `SessionHistory` 暴露实例方法；若当前组件尚未 `defineExpose({ refreshSessions })`，需一并补充。

注意：不再需要 `reset`。`useAutoName` 内部用 `namedSessionIds` Set + 按 sessionId 隔离的 `pendingTasks` Map，不需要外部调用重置。

#### 6.3 在 `handleComplete` 中触发

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
  // 1. 以当前实时上下文构建快照（非首轮时返回 null，直接跳过）
  const snap = captureSnapshot();
  if (!snap) return;
  // 2. 按 sessionId 排入独立防抖任务。工具续轮的中间态完成会反复刷新该会话的定时器，
  //    流式真正停稳 300ms 后才执行；不同会话的任务互不覆盖。
  scheduleAutoName(snap, () => chatStream.loading.value);
}
```

#### 6.4 无需在切换/新建会话时重置

`useAutoName` 内部用 `namedSessionIds`（`Set<string>`）管理已命名会话，`pendingTasks`（`Map<string, ...>`）按 sessionId 独立维护待处理任务。切换会话时新会话的 `.id` 不在 `namedSessionIds` 中，自然触发新任务；旧会话的 pending task 因其独立的 key 不被覆盖，定时器到期后仍会正常执行。

因此 `handleSwitchSession` 和 `handleNewSession` **不需要**额外调用任何 reset 函数。

---

## 错误处理

| 场景 | 策略 |
|------|------|
| `autoname` 服务未配置（用户从未设置） | 静默降级，保留现有标题（用户首条消息内容） |
| 服务已配置但模型不可用（provider 离线等） | `getAvailableServiceConfig` 返回 null，同上 |
| API 调用出错（网络/超时/Key 失效） | catch 静默处理，标题不变 |
| LLM 返回空文本或纯空格 | 保留现有标题 |
| LLM 返回超长文本 | Prompt 中已约束 20 字以内；即使超长，清理后设置不超过 50 字符可考虑截断（或不处理，交给 UI 层处理 overflow） |
| 用户快速切换会话 | 各会话独立 `pendingTasks` entry，互不覆盖；旧会话定时器到期后正常落库到其快照 sessionId |
| 会话列表刷新失败（`onTitlePersisted` 抛错） | 静默忽略，不影响标题已落库，也不影响当前会话标题同步 |

---

## 测试要点

### 单元测试（`useAutoName`）

1. 有完整首轮快照 + 有效配置 → `doAutoName` 生成标题并持久化到快照 sessionId
2. 无 autoname 配置 → `namedSessionIds` 加入该 sessionId，不发起 AI 调用
3. 快照为 null（非首轮或 `getCurrentSessionId` 为空）→ `captureSnapshot` 返回 null，集成层直接 return
4. `namedSessionIds` 已含该 sessionId → `doAutoName` 直接跳过
5. AI 调用返回 error → catch 静默，`namedSessionIds` 仍加入该 session
6. 不同 session 的快照分别调用 `doAutoName` → 各自独立标记，互不干扰
7. **活跃会话 ID 存在但 currentSession 未就绪**：新会话创建后 `settingStore.chatSidebarActiveSessionId` 已有值，但 `currentSession` 尚未由 SessionHistory 异步回填 → `captureSnapshot()` 通过 `getCurrentSessionId()` 正常获取 sessionId 并返回有效快照
8. **持久化与 UI 解耦**：LLM 返回后始终写到快照 `sessionId` 并触发 `onTitlePersisted`；`session.title` 仅在当前会话匹配时才同步
9. **工具续轮防抖**：同一会话的工具续轮中间态 → `scheduleAutoName` 反复刷新该会话的快照和定时器 → 最终停稳 300ms 后以最新内容执行
10. **后台命名刷新列表**：用户停留在会话 B 时，会话 A 命名成功 → `onTitlePersisted` 被调用 → 列表刷新，会话 A 标题更新
11. **列表刷新失败不影响主流程**：`chatStore.updateSessionTitle` 成功、`onTitlePersisted` 抛错 → 当前会话标题仍已同步，且不会回滚已持久化的数据

### 集成测试（BChatSidebar）

1. 新建会话 → 首条消息 → 工具续轮结束 → 流式停稳 300ms → 标题替换
2. 切换会话后再切回来 → 标题不变（`namedSessionIds` 隔离）
3. 未配置 autoname → 标题保持用户首条消息内容
4. 多轮对话 → 不触发
5. **跨会话独立性**：会话 A 首轮完成 → 300ms 内切到会话 B 并完成首轮 → 两个会话各自独立定时器到期后都被命名
6. **同一会话的 debounce**：首轮含工具续轮 → 中间态 `handleComplete` 多次触发 → 每次刷新同一 sessionId 的快照和定时器 → 最终停稳后基于最终内容命名
7. **列表刷新异常隔离**：模拟 `SessionHistory.refreshSessions()` 抛错 → 当前会话标题仍更新，数据库标题仍已写入

### 手动验证

1. 在设置页新增 autoname 配置卡片，可正常选择模型和编辑 Prompt
2. 不与 chat/polish 配置冲突
3. 带工具调用的首轮对话：确认标题在全部工具续轮完成后才更新
4. 首轮完成后立即切到其他会话：旧会话标题仍被正确命名（检查数据库）
5. 查看数据库：`lastMessageAt` 和 `usage` 在自动命名后未被覆写；`updated_at` 已刷新
