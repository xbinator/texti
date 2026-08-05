# Chat Tool Context Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 `src/hooks/useChatToolContext` 统一注册 Editor、WebView、Widget 的 ChatRuntime 页面工具能力，使 BChat 只处理通用 binding，并保留后台 Runtime 的资源隔离。

**Architecture:** 页面挂载时向模块级 Registry 注册强类型闭包、工具 schema、隐藏工具名和 Bridge handlers，激活状态只决定下一轮 Runtime 捕获哪个 binding。Runtime 启动时冻结 `{ providerId, resourceId }`，后续工具与 Bridge 请求始终按该 binding 查找原资源，不回退当前页面。

**Tech Stack:** Vue 3 Composition API、TypeScript strict、Vitest、Vue Test Utils、Vercel AI SDK 工具 schema、Electron ChatRuntime Bridge、lodash-es。

## Global Constraints

- 禁止使用 `any`；跨页面公共值使用明确类型或 `unknown`。
- 新增或修改的文件、接口、类型、函数和复杂逻辑必须包含符合项目规范的注释与 JSDoc。
- 所有函数参数与返回值必须显式标注类型，函数名不超过 4 个单词。
- 异步调用使用 `src/utils/asyncTo.ts` 的 `asyncTo` 归一化，不新增手写异步 `try/catch`。
- 页面 Context 保持各自强类型，通用 Registry 不建立 Editor、WebView、Widget 联合类型。
- Runtime 只在启动时捕获当前页面；已启动 Runtime 不随页面切换漂移。
- binding 失效时 fail-closed，不回退同类型或其他类型的当前页面。
- 不新增第三方依赖，不修改样式。
- 保留工作区中与本功能无关的现有改动，不覆盖或格式化无关文件。
- 按用户要求，实施期间不执行 `git add` 或 `git commit`；用户在全部完成后自行提交。

---

## File Map

### 新建

- `src/hooks/useChatToolContext/types.ts`：Renderer 注册项、Registry、生命周期 Hook 和消费 Hook 类型。
- `src/hooks/useChatToolContext/registry.ts`：无 Vue 依赖的模块级 Registry 与测试工厂。
- `src/hooks/useChatToolContext/index.ts`：页面注册生命周期和 BChat 消费入口。
- `src/components/BEditor/hooks/useEditorChatContext.ts`：Editor 工具与 Bridge handlers。
- `src/views/webview/web/hooks/useWebviewChatContext.ts`：WebView 工具、输入校验与 Bridge handlers。
- `test/hooks/use-chat-tool-context-registry.test.ts`：Registry 不变量测试。
- `test/hooks/use-chat-tool-context.test.ts`：Vue 生命周期测试。
- `test/components/BEditor/use-editor-chat-context.test.ts`：Editor provider 测试。
- `test/views/webview/use-webview-chat-context.test.ts`：WebView provider 测试。

### 修改

- `types/chat-runtime.d.ts`：新增共享 `ChatToolBinding`，descriptor 收敛为 `toolContext`。
- `src/ai/chat/runtimeCapabilities.ts`：删除 Editor 专用 capability 字段并冻结通用 binding。
- `src/hooks/useChat/useRuntimeRecovery.ts`：恢复时仅保留通用 descriptor binding。
- `src/ai/tools/builtin/index.ts`：核心工厂不再无条件创建页面工具。
- `src/ai/tools/shared/types.ts`：删除旧页面 getter 选项。
- `src/ai/tools/context/webview.ts`：保留领域类型，删除专用 Registry。
- `src/ai/tools/context/widget.ts`：保留领域类型，删除专用 Registry。
- `src/components/BEditor/index.vue`：通过 Editor provider 注册页面能力。
- `src/views/webview/web/index.vue`：通过 WebView provider 注册页面能力。
- `src/views/widget/hooks/useWidgetToolContext.ts`：改为通用 Registry 的 Widget provider。
- `src/components/BChat/hooks/useRuntimeTools.ts`：合并通用页面工具和隐藏策略。
- `src/components/BChat/hooks/useChatRuntimeLauncher.ts`：冻结通用 binding。
- `src/components/BChat/hooks/useRuntimeBridgeHandler.ts`：按通用 binding 分发页面 Bridge。
- `src/components/BChat/utils/runtimeBridge.ts`：保留应用 Bridge，页面 kind 交给 dispatcher。
- `test/ai/chat/runtime-capabilities.test.ts`
- `test/ai/tools/builtin-index.test.ts`
- `test/components/BChat/use-runtime-tools.test.ts`
- `test/components/BChat/use-chat-runtime-launcher.test.ts`
- `test/components/BChat/use-runtime-request-config.test.ts`
- `test/components/BChat/runtime-bridge.test.ts`
- `test/components/BChat/session-id-runtime.test.ts`
- `test/hooks/use-runtime-recovery.test.ts`
- `test/ai/chat/actor-system.test.ts`
- `test/electron/main/modules/chat/runtime/service.test.ts`
- `test/electron/main/modules/chat/runtime/shared-types.test.ts`
- `test/components/BEditor/editor-scroll-controller.test.ts`
- `test/views/webview/web-agent-activity.test.ts`
- `test/views/webview/web-capture-mask.test.ts`
- `test/views/webview/web-recent-record.test.ts`
- `test/views/widget/use-widget-tool-context.test.ts`
- `CONTEXT.md`
- `changelog/2026-08-05.md`

### 删除

- `src/ai/tools/context/editor.ts`：迁移后不再需要 Editor 专用 Registry。

---

### Task 1: 实现通用 Registry 核心

**Files:**
- Modify: `types/chat-runtime.d.ts`
- Create: `src/hooks/useChatToolContext/types.ts`
- Create: `src/hooks/useChatToolContext/registry.ts`
- Test: `test/hooks/use-chat-tool-context-registry.test.ts`

**Interfaces:**
- Consumes: `AIToolExecutor`、`AIToolExecutionError`、`ChatRuntimeBridgeRequestEvent`。
- Produces: `ChatToolBinding`、`ChatBridgeDispatchResult`、`ChatToolRegistry`、`createChatToolRegistry()`、`chatToolRegistry`。

- [ ] **Step 1: 写 Registry 失败测试**

创建 `test/hooks/use-chat-tool-context-registry.test.ts`，覆盖精确 binding、当前激活项、隐藏工具去重、旧 handle cleanup 和 Bridge fail-closed：

```ts
/**
 * @file use-chat-tool-context-registry.test.ts
 * @description Chat 页面工具 Registry 的资源隔离与生命周期测试。
 */
import type { AIToolExecutor } from 'types/ai';
import type { ChatRuntimeBridgeRequestEvent, ChatToolBinding } from 'types/chat-runtime';
import { describe, expect, it, vi } from 'vitest';
import { createChatToolRegistry } from '@/hooks/useChatToolContext/registry';

/**
 * 创建 schema-only 测试工具。
 * @param name - 工具名称
 * @returns 工具执行器
 */
function createTool(name: string): AIToolExecutor {
  return {
    definition: {
      name,
      description: name,
      source: 'builtin',
      riskLevel: 'read',
      parameters: { type: 'object', properties: {} }
    },
    execute: async () => ({ toolName: name, status: 'success', data: null })
  };
}

/**
 * 创建 Bridge 请求。
 * @param kind - Bridge kind
 * @returns Bridge 请求
 */
function createEvent(kind: string): ChatRuntimeBridgeRequestEvent {
  return {
    runtimeId: 'runtime-a',
    sessionId: 'session-a',
    turnId: 'turn-a',
    clientId: 'bchat',
    agentId: 'primary',
    rootRuntimeId: 'runtime-a',
    requestId: `request-${kind}`,
    kind
  };
}

describe('chat tool context registry', (): void => {
  it('resolves tools and handlers only through the exact binding', async (): Promise<void> => {
    const registry = createChatToolRegistry();
    const editorBinding: ChatToolBinding = { providerId: 'editor', resourceId: 'shared-id' };
    const widgetBinding: ChatToolBinding = { providerId: 'widget', resourceId: 'shared-id' };
    const editorHandler = vi.fn(() => ({ handled: true as const, data: { title: 'Editor' } }));
    const editor = registry.register({
      binding: editorBinding,
      getTools: () => [createTool('read_current_document')],
      hiddenToolNames: [],
      bridgeHandlers: { 'document-snapshot': editorHandler }
    });
    registry.register({
      binding: widgetBinding,
      getTools: () => [createTool('read_current_widget')],
      hiddenToolNames: [],
      bridgeHandlers: {}
    });

    editor.activate();

    expect(registry.getActiveBinding()).toEqual(editorBinding);
    expect(registry.getBoundTools(editorBinding).map((tool) => tool.definition.name)).toEqual(['read_current_document']);
    expect(registry.getBoundTools(widgetBinding).map((tool) => tool.definition.name)).toEqual(['read_current_widget']);
    await expect(registry.dispatchBridge(editorBinding, createEvent('document-snapshot'))).resolves.toEqual({
      handled: true,
      data: { title: 'Editor' }
    });
    expect(editorHandler).toHaveBeenCalledOnce();
  });

  it('keeps newer registrations safe from stale cleanup and freezes hidden names', (): void => {
    const registry = createChatToolRegistry();
    const binding: ChatToolBinding = { providerId: 'webview', resourceId: 'web-a' };
    const first = registry.register({
      binding,
      getTools: () => [createTool('read_current_webpage')],
      hiddenToolNames: ['open_resource'],
      bridgeHandlers: {}
    });
    const second = registry.register({
      binding,
      getTools: () => [createTool('operate_webpage')],
      hiddenToolNames: ['open_resource', 'open_resource'],
      bridgeHandlers: {}
    });

    second.activate();
    first.unregister();

    expect(registry.getActiveBinding()).toEqual(binding);
    expect(registry.getBoundTools(binding).map((tool) => tool.definition.name)).toEqual(['operate_webpage']);
    expect(registry.getHiddenToolNames(binding)).toEqual(['open_resource']);
    expect(Object.isFrozen(registry.getHiddenToolNames(binding))).toBe(true);
  });

  it('fails closed for a missing binding and reports an unsupported handler', async (): Promise<void> => {
    const registry = createChatToolRegistry();
    const binding: ChatToolBinding = { providerId: 'widget', resourceId: 'widget-a' };
    const missing: ChatToolBinding = { providerId: 'widget', resourceId: 'missing' };
    registry.register({ binding, getTools: () => [], hiddenToolNames: [], bridgeHandlers: {} });

    expect(registry.getBoundTools(missing)).toEqual([]);
    await expect(registry.dispatchBridge(binding, createEvent('widget-operate'))).resolves.toEqual({ handled: false });
    await expect(registry.dispatchBridge(missing, createEvent('widget-snapshot'))).rejects.toMatchObject({ code: 'EDITOR_UNAVAILABLE' });
  });

  it('rejects duplicate tool names returned by one resource', (): void => {
    const registry = createChatToolRegistry();
    const binding: ChatToolBinding = { providerId: 'editor', resourceId: 'document-a' };
    expect(() =>
      registry.register({
        binding,
        getTools: () => [createTool('read_current_document'), createTool('read_current_document')],
        hiddenToolNames: [],
        bridgeHandlers: {}
      })
    ).toThrow('Duplicate Chat tool name: read_current_document');
  });

  it('publishes registration and activation changes', (): void => {
    const registry = createChatToolRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    const handle = registry.register({
      binding: { providerId: 'editor', resourceId: 'document-a' },
      getTools: () => [],
      hiddenToolNames: [],
      bridgeHandlers: {}
    });

    handle.activate();
    handle.deactivate();
    handle.unregister();
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(4);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run test/hooks/use-chat-tool-context-registry.test.ts`

Expected: FAIL，提示无法解析 `@/hooks/useChatToolContext/registry`。

- [ ] **Step 3: 添加共享 binding 与 Registry 类型**

在 `types/chat-runtime.d.ts` 的 capability descriptor 之前添加共享类型，暂时保留旧 descriptor 字段供后续迁移：

```ts
/** Cloneable page tool identity retained by one ChatRuntime. */
export interface ChatToolBinding {
  /** Stable provider namespace. */
  readonly providerId: string;
  /** Stable resource identity inside the provider. */
  readonly resourceId: string;
}
```

创建 `src/hooks/useChatToolContext/types.ts`：

```ts
/**
 * @file types.ts
 * @description Chat 页面工具注册、查询和 Bridge 分发类型。
 */
import type { AIToolExecutor } from 'types/ai';
import type { ChatRuntimeBridgeRequestEvent, ChatToolBinding } from 'types/chat-runtime';
import type { Ref } from 'vue';

export type { ChatToolBinding } from 'types/chat-runtime';

/** 页面 Bridge handler 的处理结果。 */
export type ChatBridgeDispatchResult =
  | { readonly handled: true; readonly data: unknown }
  | { readonly handled: false };

/** 页面 Bridge 请求处理器。 */
export type ChatBridgeHandler = (
  event: ChatRuntimeBridgeRequestEvent
) => Promise<ChatBridgeDispatchResult> | ChatBridgeDispatchResult;

/** Registry 内部可注册的页面工具能力。 */
export interface ChatToolRegistration {
  /** 页面工具资源身份。 */
  readonly binding: ChatToolBinding;
  /** 动态创建当前资源工具。 */
  readonly getTools: () => AIToolExecutor[];
  /** 需要隐藏的应用级工具名称。 */
  readonly hiddenToolNames: readonly string[];
  /** 按 Bridge kind 索引的处理器。 */
  readonly bridgeHandlers: Readonly<Record<string, ChatBridgeHandler>>;
}

/** 单次注册返回的 owner-safe 控制句柄。 */
export interface ChatToolHandle {
  /** 不可变资源身份。 */
  readonly binding: ChatToolBinding;
  /** 将该资源设为当前激活项。 */
  activate(): void;
  /** 仅在该资源仍为当前项时清除激活状态。 */
  deactivate(): void;
  /** 仅在 owner 仍匹配时注销资源。 */
  unregister(): void;
}

/** 页面工具 Registry。 */
export interface ChatToolRegistry {
  /** 注册页面工具资源。 */
  register(registration: ChatToolRegistration): ChatToolHandle;
  /** 获取当前激活 binding。 */
  getActiveBinding(): ChatToolBinding | undefined;
  /** 按 binding 获取工具。 */
  getBoundTools(binding: ChatToolBinding): AIToolExecutor[];
  /** 按 binding 获取隐藏工具名称。 */
  getHiddenToolNames(binding: ChatToolBinding): readonly string[];
  /** 按 binding 分发 Bridge。 */
  dispatchBridge(binding: ChatToolBinding, event: ChatRuntimeBridgeRequestEvent): Promise<ChatBridgeDispatchResult>;
  /** 订阅 Registry 有效状态变化。 */
  subscribe(listener: () => void): () => void;
  /** 清空 Registry，仅供应用销毁与测试隔离。 */
  clear(): void;
}

/** 页面注册 Hook 选项。 */
export interface UseChatToolContextOptions {
  /** 页面提供方命名空间。 */
  readonly providerId: string;
  /** 当前资源稳定标识。 */
  readonly resourceId: Readonly<Ref<string>>;
  /** 当前资源是否可以提供能力。 */
  readonly available: Readonly<Ref<boolean>>;
  /** 当前页面是否激活。 */
  readonly active: Readonly<Ref<boolean>>;
  /** 动态创建当前资源工具。 */
  readonly getTools: () => AIToolExecutor[];
  /** 需要隐藏的应用级工具名称。 */
  readonly hiddenToolNames?: readonly string[];
  /** 页面 Bridge handlers。 */
  readonly bridgeHandlers: Readonly<Record<string, ChatBridgeHandler>>;
}

/** BChat 消费的通用页面工具能力。 */
export interface ActiveChatTools extends Pick<
  ChatToolRegistry,
  'getActiveBinding' | 'getBoundTools' | 'getHiddenToolNames' | 'dispatchBridge'
> {
  /** Registry 状态变化修订号。 */
  readonly revision: Readonly<Ref<number>>;
}
```

- [ ] **Step 4: 实现 owner-safe Registry**

创建 `src/hooks/useChatToolContext/registry.ts`，实现嵌套 Map、不可变 binding、重复工具校验和稳定错误：

```ts
/**
 * @file registry.ts
 * @description Chat 页面工具资源的注册、激活和精确 binding 查询。
 */
import type { AIToolExecutionError, AIToolExecutor } from 'types/ai';
import type { ChatRuntimeBridgeRequestEvent, ChatToolBinding } from 'types/chat-runtime';
import { uniq } from 'lodash-es';
import type {
  ChatBridgeDispatchResult,
  ChatToolHandle,
  ChatToolRegistration,
  ChatToolRegistry
} from './types';

/** Registry 内部资源记录。 */
interface RegistryEntry extends ChatToolRegistration {
  /** 当前注册实例 owner。 */
  readonly owner: symbol;
}

/** 当前激活记录。 */
interface ActiveEntry {
  /** 当前资源 binding。 */
  readonly binding: ChatToolBinding;
  /** 当前注册实例 owner。 */
  readonly owner: symbol;
}

/**
 * 创建带稳定错误码的 Registry 错误。
 * @param code - 工具错误码
 * @param message - 错误消息
 * @returns 带稳定错误码的错误
 */
function createRegistryError(
  code: AIToolExecutionError['code'],
  message: string
): Error & { code: AIToolExecutionError['code'] } {
  const error = new Error(message) as Error & { code: AIToolExecutionError['code'] };
  error.code = code;
  return error;
}

/**
 * 创建不可变 binding。
 * @param binding - 原始 binding
 * @returns 不可变 binding
 */
function freezeBinding(binding: ChatToolBinding): ChatToolBinding {
  const providerId = binding.providerId.trim();
  const resourceId = binding.resourceId.trim();
  if (!providerId || !resourceId) throw new Error('Chat tool binding requires providerId and resourceId');
  return Object.freeze({ providerId, resourceId });
}

/**
 * 校验工具名称唯一性并复制工具数组。
 * @param tools - 候选工具
 * @returns 已校验工具
 */
function validateTools(tools: AIToolExecutor[]): AIToolExecutor[] {
  const names = tools.map((tool: AIToolExecutor): string => tool.definition.name);
  const uniqueNames = uniq(names);
  if (uniqueNames.length !== names.length) {
    const duplicateName = names.find((name: string, index: number): boolean => names.indexOf(name) !== index) ?? 'unknown';
    throw new Error(`Duplicate Chat tool name: ${duplicateName}`);
  }
  return [...tools];
}

/**
 * 创建 Chat 页面工具 Registry。
 * @returns 独立 Registry
 */
export function createChatToolRegistry(): ChatToolRegistry {
  const providers = new Map<string, Map<string, RegistryEntry>>();
  const listeners = new Set<() => void>();
  let activeEntry: ActiveEntry | undefined;

  /** 发布 Registry 有效状态变化。 */
  function emitChange(): void {
    listeners.forEach((listener: () => void): void => listener());
  }

  /** 按 binding 查找精确记录。 */
  function findEntry(binding: ChatToolBinding): RegistryEntry | undefined {
    return providers.get(binding.providerId)?.get(binding.resourceId);
  }

  /** 判断 entry 是否仍由目标 owner 持有。 */
  function ownsEntry(binding: ChatToolBinding, owner: symbol): boolean {
    return findEntry(binding)?.owner === owner;
  }

  return {
    register(registration: ChatToolRegistration): ChatToolHandle {
      const binding = freezeBinding(registration.binding);
      // 注册时先验证静态结果；读取时仍会再次验证动态结果。
      validateTools(registration.getTools());
      const owner = Symbol(`${binding.providerId}:${binding.resourceId}`);
      const provider = providers.get(binding.providerId) ?? new Map<string, RegistryEntry>();
      const entry: RegistryEntry = {
        ...registration,
        binding,
        owner,
        hiddenToolNames: Object.freeze(uniq([...registration.hiddenToolNames]))
      };
      provider.set(binding.resourceId, entry);
      providers.set(binding.providerId, provider);
      if (activeEntry?.binding.providerId === binding.providerId && activeEntry.binding.resourceId === binding.resourceId) {
        activeEntry = undefined;
      }
      emitChange();

      return {
        binding,
        activate(): void {
          if (!ownsEntry(binding, owner) || activeEntry?.owner === owner) return;
          activeEntry = { binding, owner };
          emitChange();
        },
        deactivate(): void {
          if (activeEntry?.owner !== owner) return;
          activeEntry = undefined;
          emitChange();
        },
        unregister(): void {
          if (!ownsEntry(binding, owner)) return;
          provider.delete(binding.resourceId);
          if (provider.size === 0) providers.delete(binding.providerId);
          if (activeEntry?.owner === owner) activeEntry = undefined;
          emitChange();
        }
      };
    },
    getActiveBinding(): ChatToolBinding | undefined {
      if (!activeEntry || !ownsEntry(activeEntry.binding, activeEntry.owner)) return undefined;
      return activeEntry.binding;
    },
    getBoundTools(binding: ChatToolBinding): AIToolExecutor[] {
      const entry = findEntry(binding);
      return entry ? validateTools(entry.getTools()) : [];
    },
    getHiddenToolNames(binding: ChatToolBinding): readonly string[] {
      return findEntry(binding)?.hiddenToolNames ?? Object.freeze([] as string[]);
    },
    async dispatchBridge(binding: ChatToolBinding, event: ChatRuntimeBridgeRequestEvent): Promise<ChatBridgeDispatchResult> {
      const entry = findEntry(binding);
      if (!entry) throw createRegistryError('EDITOR_UNAVAILABLE', 'Runtime 绑定的页面工具上下文已不可用');
      const handler = entry.bridgeHandlers[event.kind];
      return handler ? handler(event) : { handled: false };
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    clear(): void {
      const changed = providers.size > 0 || activeEntry !== undefined;
      providers.clear();
      activeEntry = undefined;
      if (changed) emitChange();
    }
  };
}

/** 应用级 Chat 页面工具 Registry 单例。 */
export const chatToolRegistry = createChatToolRegistry();
```

- [ ] **Step 5: 运行 Registry 测试**

Run: `pnpm exec vitest run test/hooks/use-chat-tool-context-registry.test.ts`

Expected: PASS，5 个 Registry 用例全部通过。

- [ ] **Step 6: 检查本任务差异但不提交**

Run: `pnpm exec eslint src/hooks/useChatToolContext/registry.ts src/hooks/useChatToolContext/types.ts --ext .ts`

Expected: exit 0，无 warning。检查 `git diff -- types/chat-runtime.d.ts src/hooks/useChatToolContext test/hooks/use-chat-tool-context-registry.test.ts`，不执行 stage 或 commit。

---

### Task 2: 实现 Vue 注册生命周期 Hook

**Files:**
- Create: `src/hooks/useChatToolContext/index.ts`
- Test: `test/hooks/use-chat-tool-context.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `chatToolRegistry`、`ChatToolHandle`、`UseChatToolContextOptions`。
- Produces: `useChatToolContext(options): void`、`useActiveChatTools(): ActiveChatTools`。

- [ ] **Step 1: 写生命周期失败测试**

创建 `test/hooks/use-chat-tool-context.test.ts`，使用真实 Vue watcher 验证 available、active、资源 ID 迁移和卸载：

```ts
/**
 * @file use-chat-tool-context.test.ts
 * @description Chat 页面工具 Hook 的响应式注册与清理测试。
 * @vitest-environment jsdom
 */
import type { AIToolExecutor } from 'types/ai';
import type { Ref, VNode } from 'vue';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { useActiveChatTools, useChatToolContext } from '@/hooks/useChatToolContext';
import { chatToolRegistry } from '@/hooks/useChatToolContext/registry';

/** Hook 测试宿主。 */
interface HookHarness {
  /** Vue wrapper。 */
  wrapper: VueWrapper;
  /** 资源 ID。 */
  resourceId: Ref<string>;
  /** 可用状态。 */
  available: Ref<boolean>;
  /** 激活状态。 */
  active: Ref<boolean>;
}

/** 创建测试工具。 */
function createTool(): AIToolExecutor {
  return {
    definition: {
      name: 'read_current_document',
      description: 'read',
      source: 'builtin',
      riskLevel: 'read',
      parameters: { type: 'object', properties: {} }
    },
    execute: async () => ({ toolName: 'read_current_document', status: 'success', data: null })
  };
}

/** 创建 Hook 宿主。 */
function createHarness(): HookHarness {
  const resourceId = ref<string>('document-a');
  const available = ref<boolean>(false);
  const active = ref<boolean>(true);
  const Host = defineComponent({
    setup(): () => VNode {
      useChatToolContext({
        providerId: 'editor',
        resourceId,
        available,
        active,
        getTools: () => [createTool()],
        hiddenToolNames: [],
        bridgeHandlers: {}
      });
      return (): VNode => h('div');
    }
  });
  return { wrapper: mount(Host), resourceId, available, active };
}

describe('useChatToolContext', (): void => {
  afterEach((): void => chatToolRegistry.clear());

  it('registers only when available and retains inactive mounted resources', async (): Promise<void> => {
    const harness = createHarness();
    const tools = useActiveChatTools();

    expect(tools.getActiveBinding()).toBeUndefined();
    harness.available.value = true;
    await nextTick();
    const binding = { providerId: 'editor', resourceId: 'document-a' };
    expect(tools.getActiveBinding()).toEqual(binding);

    harness.active.value = false;
    await nextTick();
    expect(tools.getActiveBinding()).toBeUndefined();
    expect(tools.getBoundTools(binding).map((tool) => tool.definition.name)).toEqual(['read_current_document']);

    harness.wrapper.unmount();
    expect(tools.getBoundTools(binding)).toEqual([]);
  });

  it('moves registration when the resource id changes', async (): Promise<void> => {
    const harness = createHarness();
    const tools = useActiveChatTools();
    harness.available.value = true;
    await nextTick();
    harness.resourceId.value = 'document-b';
    await nextTick();

    expect(tools.getBoundTools({ providerId: 'editor', resourceId: 'document-a' })).toEqual([]);
    expect(tools.getActiveBinding()).toEqual({ providerId: 'editor', resourceId: 'document-b' });
    harness.wrapper.unmount();
  });

  it('deactivates without unregistering across KeepAlive transitions', async (): Promise<void> => {
    const visible = ref<boolean>(true);
    const resourceId = ref<string>('document-a');
    const available = ref<boolean>(true);
    const active = ref<boolean>(true);
    const Host = defineComponent({
      setup(): () => VNode {
        useChatToolContext({
          providerId: 'editor',
          resourceId,
          available,
          active,
          getTools: () => [createTool()],
          hiddenToolNames: [],
          bridgeHandlers: {}
        });
        return (): VNode => h('div');
      }
    });
    const Root = defineComponent({
      setup(): () => VNode {
        return (): VNode => h(KeepAlive, null, { default: () => (visible.value ? h(Host) : h('span')) });
      }
    });
    const wrapper = mount(Root);
    const tools = useActiveChatTools();
    const binding = { providerId: 'editor', resourceId: 'document-a' };

    expect(tools.getActiveBinding()).toEqual(binding);
    visible.value = false;
    await nextTick();
    expect(tools.getActiveBinding()).toBeUndefined();
    expect(tools.getBoundTools(binding)).toHaveLength(1);
    visible.value = true;
    await nextTick();
    expect(tools.getActiveBinding()).toEqual(binding);
    wrapper.unmount();
  });
});
```

该测试文件从 Vue 额外导入 `KeepAlive`。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run test/hooks/use-chat-tool-context.test.ts`

Expected: FAIL，提示 `useChatToolContext` 或 `useActiveChatTools` 尚未导出。

- [ ] **Step 3: 实现 Hook**

创建 `src/hooks/useChatToolContext/index.ts`：

```ts
/**
 * @file index.ts
 * @description 将页面工具能力绑定到 Vue 生命周期，并提供 BChat 消费入口。
 */
import { onActivated, onBeforeUnmount, onDeactivated, readonly, ref, watch } from 'vue';
import { chatToolRegistry } from './registry';
import type { ActiveChatTools, ChatToolHandle, UseChatToolContextOptions } from './types';

export type {
  ActiveChatTools,
  ChatBridgeDispatchResult,
  ChatBridgeHandler,
  ChatToolBinding,
  UseChatToolContextOptions
} from './types';

/** Registry 状态变化的 Vue 修订投影。 */
const registryRevision = ref<number>(0);
chatToolRegistry.subscribe((): void => {
  registryRevision.value += 1;
});

/**
 * 注册页面提供给 ChatRuntime 的工具能力。
 * @param options - 页面工具注册选项
 */
export function useChatToolContext(options: UseChatToolContextOptions): void {
  let handle: ChatToolHandle | undefined;

  /** 注销当前 Hook 持有的资源。 */
  function disposeRegistration(): void {
    handle?.unregister();
    handle = undefined;
  }

  /** 同步当前激活状态。 */
  function syncActive(): void {
    if (!handle) return;
    if (options.active.value) handle.activate();
    else handle.deactivate();
  }

  /** 同步资源注册状态。 */
  function syncRegistration(): void {
    const resourceId = options.resourceId.value.trim();
    if (!options.available.value || !resourceId) {
      disposeRegistration();
      return;
    }
    if (handle?.binding.providerId === options.providerId && handle.binding.resourceId === resourceId) {
      syncActive();
      return;
    }
    disposeRegistration();
    handle = chatToolRegistry.register({
      binding: { providerId: options.providerId, resourceId },
      getTools: options.getTools,
      hiddenToolNames: options.hiddenToolNames ?? [],
      bridgeHandlers: options.bridgeHandlers
    });
    syncActive();
  }

  watch([options.resourceId, options.available], syncRegistration, { immediate: true });
  watch(options.active, syncActive, { immediate: true });
  onActivated((): void => {
    syncRegistration();
    syncActive();
  });
  onDeactivated((): void => handle?.deactivate());
  onBeforeUnmount(disposeRegistration);
}

/**
 * 获取 BChat 使用的通用页面工具能力。
 * @returns 页面工具查询和 Bridge 分发能力
 */
export function useActiveChatTools(): ActiveChatTools {
  return {
    revision: readonly(registryRevision),
    getActiveBinding: chatToolRegistry.getActiveBinding,
    getBoundTools: chatToolRegistry.getBoundTools,
    getHiddenToolNames: chatToolRegistry.getHiddenToolNames,
    dispatchBridge: chatToolRegistry.dispatchBridge
  };
}
```

- [ ] **Step 4: 运行 Hook 测试**

Run: `pnpm exec vitest run test/hooks/use-chat-tool-context-registry.test.ts test/hooks/use-chat-tool-context.test.ts`

Expected: PASS，Registry 与 Hook 测试全部通过。

- [ ] **Step 5: 检查本任务差异但不提交**

Run: `pnpm exec eslint src/hooks/useChatToolContext --ext .ts`

Expected: exit 0。检查新 Hook 文件和测试差异，不执行 stage 或 commit。

---

### Task 3: 注册 Editor 工具能力

**Files:**
- Create: `src/components/BEditor/hooks/useEditorChatContext.ts`
- Modify: `src/components/BEditor/index.vue`
- Modify: `test/components/BEditor/editor-scroll-controller.test.ts`
- Test: `test/components/BEditor/use-editor-chat-context.test.ts`

**Interfaces:**
- Consumes: `useChatToolContext`、`createReadCurrentDocumentTool()`、`createEditorToolContext()`。
- Produces: `useEditorChatContext(options): void`，注册 `read_current_document`、`document-snapshot`、`write-file-content`。

- [ ] **Step 1: 写 Editor provider 失败测试**

测试文件先声明 Bridge 事件 helper：

```ts
/** 创建 Editor provider 测试 Bridge 请求。 */
function createEvent(kind: string, payload?: unknown): ChatRuntimeBridgeRequestEvent {
  return {
    runtimeId: 'runtime-a',
    sessionId: 'session-a',
    turnId: 'turn-a',
    clientId: 'bchat',
    agentId: 'primary',
    rootRuntimeId: 'runtime-a',
    requestId: `request-${kind}`,
    kind,
    payload
  };
}
```

挂载一个最小 Host，使用 `createNoopEditorController()` 构建控制器：

```ts
const editorState = ref<EditorState>({
  id: 'document-a',
  name: 'Draft',
  path: null,
  ext: 'md',
  content: '# Draft'
});
const replaceDocument = vi.fn(async (): Promise<void> => undefined);
const editorController: EditorController = {
  ...createNoopEditorController(),
  replaceDocument
};
const active = ref<boolean>(true);
const Host = defineComponent({
  setup(): () => VNode {
    useEditorChatContext({
      editorState,
      active,
      getController: (): EditorController => editorController
    });
    return (): VNode => h('div');
  }
});
const wrapper = mount(Host);
```

然后断言：

```ts
const tools = useActiveChatTools();
const binding = { providerId: 'editor', resourceId: 'document-a' };
expect(tools.getBoundTools(binding).map((tool) => tool.definition.name)).toEqual(['read_current_document']);
await expect(tools.dispatchBridge(binding, createEvent('document-snapshot'))).resolves.toEqual({
  handled: true,
  data: expect.objectContaining({ id: 'document-a', content: '# Draft' })
});
await expect(
  tools.dispatchBridge(binding, createEvent('write-file-content', { path: 'unsaved://document-a/Draft.md', content: '# Updated' }))
).resolves.toEqual({
  handled: true,
  data: { artifactId: 'document-a', path: 'unsaved://document-a/Draft.md', content: '# Updated' }
});
expect(editorController.replaceDocument).toHaveBeenCalledWith('# Updated');
wrapper.unmount();
```

同时加入目标不匹配用例，期望 `{ handled: false }`，避免页面拦截其他未保存文件。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run test/components/BEditor/use-editor-chat-context.test.ts`

Expected: FAIL，提示无法解析 `useEditorChatContext`。

- [ ] **Step 3: 实现 Editor provider**

创建 `src/components/BEditor/hooks/useEditorChatContext.ts`，完整文件内容如下：

```ts
/**
 * @file useEditorChatContext.ts
 * @description 将 BEditor 文档能力注册为 ChatRuntime 页面工具上下文。
 */
import type { AIToolContext, AIToolExecutionError } from 'types/ai';
import type { ChatRuntimeBridgeRequestEvent } from 'types/chat-runtime';
import type { Ref } from 'vue';
import { computed } from 'vue';
import { createReadCurrentDocumentTool } from '@/ai/tools/catalog/runtimeTools';
import { useChatToolContext, type ChatBridgeDispatchResult } from '@/hooks/useChatToolContext';
import { asyncTo } from '@/utils/asyncTo';
import { parseUnsavedPath } from '@/utils/file/unsaved';
import type { EditorController, EditorState } from '../types';
import { createEditorToolContext } from './useEditorToolContext';

/** Editor Chat Context 选项。 */
interface UseEditorChatContextOptions {
  /** 编辑器状态。 */
  readonly editorState: Ref<EditorState>;
  /** 当前编辑器是否激活。 */
  readonly active: Readonly<Ref<boolean>>;
  /** 获取当前编辑器控制器。 */
  readonly getController: () => EditorController | null;
}

/** 创建稳定工具错误。 */
function createToolError(
  code: AIToolExecutionError['code'],
  message: string
): Error & { code: AIToolExecutionError['code'] } {
  const error = new Error(message) as Error & { code: AIToolExecutionError['code'] };
  error.code = code;
  return error;
}

/** 判断值是否为对象记录。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 注册 Editor Chat 工具上下文。 */
export function useEditorChatContext(options: UseEditorChatContextOptions): void {
  const resourceId = computed<string>((): string => options.editorState.value.id);
  const available = computed<boolean>((): boolean => Boolean(resourceId.value && options.getController()));

  /** 获取当前强类型 Editor Context。 */
  function getContext(): AIToolContext {
    if (!options.getController()) throw createToolError('EDITOR_UNAVAILABLE', 'Runtime 绑定的编辑器已不可用');
    return createEditorToolContext({
      getFileState: (): EditorState => options.editorState.value,
      getEditorInstance: options.getController
    });
  }

  /** 读取文档快照。 */
  function readSnapshot(): ChatBridgeDispatchResult {
    const context = getContext();
    return {
      handled: true,
      data: {
        id: context.document.id,
        title: context.document.title,
        path: context.document.path,
        ...(context.document.locator ? { locator: context.document.locator } : {}),
        content: context.document.getContent(),
        selection: context.editor.getSelection()
      }
    };
  }

  /** 写入匹配的未保存文档。 */
  async function writeContent(event: ChatRuntimeBridgeRequestEvent): Promise<ChatBridgeDispatchResult> {
    const payload = isRecord(event.payload) ? event.payload : {};
    const path = typeof payload.path === 'string' ? payload.path.trim() : '';
    const content = typeof payload.content === 'string' ? payload.content : '';
    const reference = parseUnsavedPath(path);
    const context = getContext();
    const matches = Boolean(
      reference &&
        (context.document.locator === path || context.document.path === path || context.document.id === reference.fileId)
    );
    if (!matches) return { handled: false };
    const [error] = await asyncTo(context.editor.replaceDocument(content));
    if (error) throw error;
    return { handled: true, data: { artifactId: context.document.id, path, content } };
  }

  useChatToolContext({
    providerId: 'editor',
    resourceId,
    available,
    active: options.active,
    getTools: () => [createReadCurrentDocumentTool()],
    hiddenToolNames: [],
    bridgeHandlers: {
      'document-snapshot': (): ChatBridgeDispatchResult => readSnapshot(),
      'write-file-content': writeContent
    }
  });
}
```

- [ ] **Step 4: 接入 BEditor，暂时保留旧 Registry 双写**

在 `src/components/BEditor/index.vue` 中新增 `active` ref，并在 `getEditorController` 定义后调用 provider：

```ts
const editable = toRef(props, 'editable');
const active = toRef(props, 'active');

useEditorChatContext({
  editorState,
  active,
  getController: getEditorController
});
```

本任务暂不删除 `editorToolContextRegistry` 的旧注册块，确保后续 BChat 消费迁移前行为不变。在 `test/components/BEditor/editor-scroll-controller.test.ts` 添加：

```ts
vi.mock('@/components/BEditor/hooks/useEditorChatContext', () => ({
  useEditorChatContext: vi.fn()
}));
```

- [ ] **Step 5: 运行 Editor 测试**

Run: `pnpm exec vitest run test/components/BEditor/use-editor-chat-context.test.ts test/components/BEditor/editor-scroll-controller.test.ts test/components/BEditor/use-editor-tool-context.test.ts`

Expected: PASS，Editor provider、滚动控制器和原 Context 行为均通过。

- [ ] **Step 6: 检查本任务差异但不提交**

Run: `pnpm exec eslint src/components/BEditor/index.vue src/components/BEditor/hooks/useEditorChatContext.ts --ext .vue,.ts`

Expected: exit 0。检查 Editor 相关差异，不执行 stage 或 commit。

---

### Task 4: 注册 WebView 工具能力

**Files:**
- Create: `src/views/webview/web/hooks/useWebviewChatContext.ts`
- Modify: `src/views/webview/web/index.vue`
- Modify: `test/views/webview/web-agent-activity.test.ts`
- Modify: `test/views/webview/web-capture-mask.test.ts`
- Modify: `test/views/webview/web-recent-record.test.ts`
- Test: `test/views/webview/use-webview-chat-context.test.ts`

**Interfaces:**
- Consumes: `WebviewToolContext`、`createReadCurrentWebpageTool()`、`createOperateWebpageTool()`、`OPEN_RESOURCE_TOOL_NAME`。
- Produces: `useWebviewChatContext(options): void`，注册网页读写工具并隐藏 `open_resource`。

- [ ] **Step 1: 写 WebView provider 失败测试**

测试先声明以下完整夹具：

```ts
const pageSnapshot: WebviewPageSnapshot = {
  url: 'https://example.com',
  title: 'Example',
  summary: 'Example page',
  header: '',
  content: '<main>Example</main>',
  footer: '',
  text: 'Example',
  selectedText: '',
  headings: [],
  links: [],
  capturedAt: 1,
  truncated: { text: false, content: false, headings: false, links: false, selectedText: false },
  snapshotId: 'snapshot-a'
};
const operationResult: WebviewOperateResult = {
  ok: true,
  action: 'click',
  target: { index: 1, label: 'Open', tagName: 'BUTTON' },
  message: 'Clicked Open',
  navigationStarted: false,
  pageChanged: true,
  shouldReadAgain: true
};

/** 创建 WebView provider 测试 Bridge 请求。 */
function createEvent(kind: string, payload?: unknown): ChatRuntimeBridgeRequestEvent {
  return {
    runtimeId: 'runtime-a',
    sessionId: 'session-a',
    turnId: 'turn-a',
    clientId: 'bchat',
    agentId: 'primary',
    rootRuntimeId: 'runtime-a',
    requestId: `request-${kind}`,
    kind,
    payload
  };
}
```

创建强类型 WebView Context 和最小宿主：

```ts
const resourceId = ref<string>('/webview/a');
const available = ref<boolean>(true);
const context: WebviewToolContext = {
  readPageSnapshot: vi.fn(async (): Promise<WebviewPageSnapshot> => pageSnapshot),
  operatePage: vi.fn(async (): Promise<WebviewOperateResult> => operationResult)
};
const Host = defineComponent({
  setup(): () => VNode {
    useWebviewChatContext({ resourceId, available, context });
    return (): VNode => h('div');
  }
});
const wrapper = mount(Host);
const tools = useActiveChatTools();
```

测试文件从 `types/chat-runtime` 导入 `ChatRuntimeBridgeRequestEvent`，从 Vue 导入 `VNode`、`defineComponent`、`h`、`ref`，从 Vue Test Utils 导入 `mount`，从 WebView 领域类型导入 `WebviewOperateResult`、`WebviewPageSnapshot`、`WebviewToolContext`，并导入 `useActiveChatTools` 与待实现的 `useWebviewChatContext`。然后断言：

```ts
const binding = { providerId: 'webview', resourceId: '/webview/a' };
expect(tools.getBoundTools(binding).map((tool) => tool.definition.name)).toEqual([
  'read_current_webpage',
  'operate_webpage'
]);
expect(tools.getHiddenToolNames(binding)).toEqual(['open_resource']);
await expect(tools.dispatchBridge(binding, createEvent('webview-snapshot'))).resolves.toEqual({
  handled: true,
  data: pageSnapshot
});
await expect(
  tools.dispatchBridge(binding, createEvent('webview-operate', { action: { type: 'click', index: 1 } }))
).rejects.toMatchObject({ code: 'INVALID_INPUT' });
await expect(
  tools.dispatchBridge(
    binding,
    createEvent('webview-operate', { snapshotId: 'snapshot-a', action: { type: 'click', index: 1 } })
  )
).resolves.toEqual({ handled: true, data: operationResult });
expect(context.operatePage).toHaveBeenCalledOnce();
wrapper.unmount();
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run test/views/webview/use-webview-chat-context.test.ts`

Expected: FAIL，提示无法解析 `useWebviewChatContext`。

- [ ] **Step 3: 实现 WebView 输入校验和 provider**

创建 `src/views/webview/web/hooks/useWebviewChatContext.ts`，先写入文件头、完整 imports、选项类型与错误构造：

```ts
/**
 * @file useWebviewChatContext.ts
 * @description 将 WebView 页面能力注册为 ChatRuntime 页面工具上下文。
 */
import type { AIToolExecutionError } from 'types/ai';
import type { ChatRuntimeBridgeRequestEvent } from 'types/chat-runtime';
import { ref, type Ref } from 'vue';
import {
  createOperateWebpageTool,
  createReadCurrentWebpageTool,
  OPEN_RESOURCE_TOOL_NAME
} from '@/ai/tools/catalog/runtimeTools';
import type {
  WebviewOperateInput,
  WebviewPressKey,
  WebviewToolContext
} from '@/ai/tools/context/webview';
import { useChatToolContext, type ChatBridgeDispatchResult } from '@/hooks/useChatToolContext';
import { asyncTo } from '@/utils/asyncTo';

/** WebView Chat Context 选项。 */
interface UseWebviewChatContextOptions {
  /** 当前 WebView 资源 ID。 */
  readonly resourceId: Readonly<Ref<string>>;
  /** 当前 WebView 能力是否可用。 */
  readonly available: Readonly<Ref<boolean>>;
  /** 当前 WebView 强类型工具上下文。 */
  readonly context: WebviewToolContext;
}

/** 创建稳定工具错误。 */
function createToolError(
  code: AIToolExecutionError['code'],
  message: string
): Error & { code: AIToolExecutionError['code'] } {
  const error = new Error(message) as Error & { code: AIToolExecutionError['code'] };
  error.code = code;
  return error;
}
```

继续写入以下完整校验链；它明确限定 click/input/select/press/scroll/navigate/wait 的字段规则：

```ts
/** 判断值是否为对象记录。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 判断值是否为有限数字。 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 判断值是否为网页滚动方向。 */
function isScrollDirection(value: unknown): value is 'up' | 'down' | 'left' | 'right' {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

/** 判断值是否为网页按键。 */
function isPressKey(value: unknown): value is WebviewPressKey {
  return (
    value === 'Enter' ||
    value === 'Tab' ||
    value === 'Escape' ||
    value === 'ArrowUp' ||
    value === 'ArrowDown' ||
    value === 'ArrowLeft' ||
    value === 'ArrowRight'
  );
}

/** 判断值是否为 WebView 操作动作。 */
function isOperateAction(value: unknown): value is WebviewOperateInput['action'] {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'click') return isFiniteNumber(value.index);
  if (value.type === 'input') {
    return isFiniteNumber(value.index) && typeof value.text === 'string' &&
      (value.clear === undefined || typeof value.clear === 'boolean');
  }
  if (value.type === 'select') return isFiniteNumber(value.index) && typeof value.optionText === 'string';
  if (value.type === 'press') return isFiniteNumber(value.index) && isPressKey(value.key);
  if (value.type === 'scroll') {
    return (value.index === undefined || isFiniteNumber(value.index)) &&
      isScrollDirection(value.direction) &&
      (value.pixels === undefined || isFiniteNumber(value.pixels));
  }
  if (value.type === 'navigate') return typeof value.url === 'string';
  if (value.type === 'wait') return value.seconds === undefined || isFiniteNumber(value.seconds);
  return false;
}

/** 判断 payload 是否为 WebView 操作输入。 */
function isOperateInput(value: unknown): value is WebviewOperateInput {
  if (!isRecord(value) || !isOperateAction(value.action)) return false;
  if (value.action.type === 'navigate') {
    return value.snapshotId === undefined || typeof value.snapshotId === 'string';
  }
  return typeof value.snapshotId === 'string' && value.snapshotId.length > 0;
}
```

provider 主体使用静态 `active = ref(true)` 配合通用 Hook 的 KeepAlive 回调，并使用 `asyncTo` 调用页面异步能力：

```ts
/** 注册 WebView Chat 工具上下文。 */
export function useWebviewChatContext(options: UseWebviewChatContextOptions): void {
  const active = ref<boolean>(true);

  /** 读取网页快照。 */
  async function readSnapshot(): Promise<ChatBridgeDispatchResult> {
    const [error, snapshot] = await asyncTo(options.context.readPageSnapshot());
    if (error) throw error;
    return { handled: true, data: snapshot };
  }

  /** 操作网页。 */
  async function operatePage(event: ChatRuntimeBridgeRequestEvent): Promise<ChatBridgeDispatchResult> {
    if (!isOperateInput(event.payload)) throw createToolError('INVALID_INPUT', '网页操作参数无效');
    const [error, result] = await asyncTo(options.context.operatePage(event.payload));
    if (error) throw error;
    return { handled: true, data: result };
  }

  useChatToolContext({
    providerId: 'webview',
    resourceId: options.resourceId,
    available: options.available,
    active,
    getTools: () => [createReadCurrentWebpageTool(), createOperateWebpageTool()],
    hiddenToolNames: [OPEN_RESOURCE_TOOL_NAME],
    bridgeHandlers: {
      'webview-snapshot': readSnapshot,
      'webview-operate': operatePage
    }
  });
}
```

至此校验链和 provider 主体与上面的文件头代码共同构成完整文件；错误构造保留在本文件内，避免页面类型耦合。

- [ ] **Step 4: 接入 WebView，暂时保留旧 Registry 双写**

在 `src/views/webview/web/index.vue` 创建响应式资源状态：

```ts
const chatResourceId = ref<string>(routeFullPath);
const chatContextAvailable = computed<boolean>((): boolean => Boolean(webviewElementRef.value));

useWebviewChatContext({
  resourceId: chatResourceId,
  available: chatContextAvailable,
  context: {
    readPageSnapshot: webview.readPageSnapshot,
    operatePage: webview.operatePage
  }
});
```

本任务暂时保留 `webviewToolContextRegistry` 的注册与生命周期调用。在三个现有 WebView 组件测试中统一添加：

```ts
vi.mock('@/views/webview/web/hooks/useWebviewChatContext', () => ({
  useWebviewChatContext: vi.fn()
}));
```

- [ ] **Step 5: 运行 WebView 测试**

Run: `pnpm exec vitest run test/views/webview/use-webview-chat-context.test.ts test/views/webview/web-agent-activity.test.ts test/views/webview/web-capture-mask.test.ts test/views/webview/web-recent-record.test.ts`

Expected: PASS，provider 与现有 WebView 组件测试全部通过。

- [ ] **Step 6: 检查本任务差异但不提交**

Run: `pnpm exec eslint src/views/webview/web/index.vue src/views/webview/web/hooks/useWebviewChatContext.ts --ext .vue,.ts`

Expected: exit 0。检查 WebView 差异，不执行 stage 或 commit。

---

### Task 5: 迁移 Widget provider 到通用 Hook

**Files:**
- Modify: `src/views/widget/hooks/useWidgetToolContext.ts`
- Modify: `test/views/widget/use-widget-tool-context.test.ts`

**Interfaces:**
- Consumes: `useChatToolContext`、`createReadCurrentWidgetTool()`、现有 Widget refs。
- Produces: Widget binding、`read_current_widget` 和 `widget-snapshot` handler。

- [ ] **Step 1: 将现有测试改为断言通用 Registry**

把 `widgetToolContextRegistry` 断言替换为：

```ts
/** 创建 Widget provider 测试 Bridge 请求。 */
function createEvent(kind: string): ChatRuntimeBridgeRequestEvent {
  return {
    runtimeId: 'runtime-a',
    sessionId: 'session-a',
    turnId: 'turn-a',
    clientId: 'bchat',
    agentId: 'primary',
    rootRuntimeId: 'runtime-a',
    requestId: `request-${kind}`,
    kind
  };
}

const tools = useActiveChatTools();
const binding = { providerId: 'widget', resourceId: 'widget-context-test-a' };
expect(tools.getActiveBinding()).toEqual(binding);
expect(tools.getBoundTools(binding).map((tool) => tool.definition.name)).toEqual(['read_current_widget']);
const result = await tools.dispatchBridge(binding, createEvent('widget-snapshot'));
expect(result).toEqual({
  handled: true,
  data: expect.objectContaining({ title: 'aether-weather' })
});
```

保留“数据和标题更新后读取最新值”“失活后 binding 仍可读取”“卸载后 binding 失效”三个断言。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run test/views/widget/use-widget-tool-context.test.ts`

Expected: FAIL，当前 Widget hook 尚未注册通用 binding。

- [ ] **Step 3: 在 Widget hook 中注册通用能力**

在 `useWidgetToolContext` 中新增：

```ts
const available = computed<boolean>((): boolean => Boolean(options.fileId.value));

/** 读取 Widget 快照。 */
function readSnapshot(): ChatBridgeDispatchResult {
  return {
    handled: true,
    data: {
      title: options.currentTitle.value,
      path: options.fileState.value.path,
      content: serializeData(options.data)
    }
  };
}

useChatToolContext({
  providerId: 'widget',
  resourceId: options.fileId,
  available,
  active: options.isActive,
  getTools: () => [createReadCurrentWidgetTool()],
  hiddenToolNames: [],
  bridgeHandlers: {
    'widget-snapshot': (): ChatBridgeDispatchResult => readSnapshot()
  }
});
```

本任务暂时保留旧 `widgetToolContextRegistry` 逻辑，直到 BChat 完成消费迁移。

- [ ] **Step 4: 运行 Widget 测试**

Run: `pnpm exec vitest run test/views/widget/use-widget-tool-context.test.ts`

Expected: PASS，Widget provider 生命周期与实时数据读取断言全部通过。

- [ ] **Step 5: 检查本任务差异但不提交**

Run: `pnpm exec eslint src/views/widget/hooks/useWidgetToolContext.ts --ext .ts`

Expected: exit 0。检查 Widget 差异，不执行 stage 或 commit。

---

### Task 6: 让 Runtime 工具发现只消费通用页面能力

**Files:**
- Modify: `src/ai/tools/builtin/index.ts`
- Modify: `src/components/BChat/hooks/useRuntimeTools.ts`
- Modify: `test/ai/tools/builtin-index.test.ts`
- Modify: `test/components/BChat/use-runtime-tools.test.ts`

**Interfaces:**
- Consumes: `useActiveChatTools()`、`RuntimeToolDiscoveryBinding.toolContext`。
- Produces: 页面无关的 `getActiveTools(binding?)`。

- [ ] **Step 1: 写核心工具工厂与通用 binding 失败测试**

在 `test/ai/tools/builtin-index.test.ts` 把 WebView schema 测试改为断言页面工具不再由核心工厂无条件创建：

```ts
it('keeps page-scoped schemas out of the core builtin factory', (): void => {
  const toolNames = createBuiltinTools().map((tool) => tool.definition.name);
  expect(toolNames).not.toEqual(
    expect.arrayContaining([
      READ_CURRENT_DOCUMENT_TOOL_NAME,
      READ_CURRENT_WEBPAGE_TOOL_NAME,
      READ_CURRENT_WIDGET_TOOL_NAME,
      OPERATE_WEBPAGE_TOOL_NAME
    ])
  );
});
```

在 `test/components/BChat/use-runtime-tools.test.ts` 用一个 `activeChatToolsMock` 替换三个 Registry mock，并新增：

```ts
const activeChatToolsMock = vi.hoisted(() => ({
  getActiveBinding: vi.fn(() => undefined),
  getBoundTools: vi.fn((): AIToolExecutor[] => []),
  getHiddenToolNames: vi.fn((): readonly string[] => []),
  dispatchBridge: vi.fn()
}));

vi.mock('@/hooks/useChatToolContext', () => ({
  useActiveChatTools: () => activeChatToolsMock
}));
```

并新增：

```ts
it('merges tools from the exact generic binding and applies hidden names', (): void => {
  const binding = { providerId: 'webview', resourceId: 'webview-a' };
  activeChatToolsMock.getBoundTools.mockImplementation((value) =>
    value.providerId === 'webview' && value.resourceId === 'webview-a'
      ? [builtinMockState.createExecutor('read_current_webpage'), builtinMockState.createExecutor('operate_webpage')]
      : []
  );
  activeChatToolsMock.getHiddenToolNames.mockReturnValue(['open_resource']);
  const runtimeTools = createRuntimeTools();

  const names = runtimeTools.getActiveTools({
    sessionId: 'session-a',
    runtimeId: 'runtime-a',
    workspaceRoot: '/workspace-a',
    toolContext: binding
  }).map((tool) => tool.definition.name);

  expect(names).toEqual(expect.arrayContaining(['read_current_webpage', 'operate_webpage']));
  expect(names).not.toContain('open_resource');
  expect(activeChatToolsMock.getActiveBinding).not.toHaveBeenCalled();
});
```

另加一个 binding 对象存在但 `toolContext` 缺失的用例，断言不会回退 `getActiveBinding()`。

把该文件现有的 Editor、WebView、Widget 可用性和资源隔离用例全部改为驱动 `activeChatToolsMock.getBoundTools()`；原 `webviewId: 'webview-a'`、`widgetId: 'widget-a'` binding fixture 分别改为 `toolContext: { providerId: 'webview', resourceId: 'webview-a' }` 和 `toolContext: { providerId: 'widget', resourceId: 'widget-a' }`。删除三套专用 Registry mock、`WebviewToolContext` fixture 和与页面 Context getter 有关的断言，保留工具名称、工作区、Skill 与 Widget 目录工具的原行为断言。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run test/ai/tools/builtin-index.test.ts test/components/BChat/use-runtime-tools.test.ts`

Expected: FAIL；核心工厂仍含页面工具，BChat 仍读取三个专用 Registry。

- [ ] **Step 3: 从核心工厂移除页面 schema**

在 `createBuiltinTools` 中删除 `createReadCurrentDocumentTool()`、`createReadCurrentWebpageTool()`、`createReadCurrentWidgetTool()`、`createOperateWebpageTool()` 的创建和返回项。共享 `ALL_BUILTIN_TOOL_NAMES` 与 catalog factories 保持不变，使页面 provider 创建的工具仍通过 `isBuiltinToolName()`。

核心只读数组应从：

```ts
const allReadonlyTools: AIToolExecutor[] = [
  createGetCurrentTimeTool(),
  createQuestionTool({
    getPendingQuestion: options.getPendingQuestion ?? (() => null),
    createQuestionId: options.createQuestionId ?? (() => nanoid())
  }),
  createReadFileTool(),
  createGetSettingsTool(),
  createQueryLogsTool(),
  createOpenResourceTool()
];
```

产生；两个 return 数组均不再追加页面工具。

- [ ] **Step 4: 改造 useRuntimeTools**

将 `RuntimeToolResourceBinding` 的页面字段替换为：

```ts
/** 请求准备时冻结的页面工具资源。 */
readonly toolContext?: ChatToolBinding;
```

在 `useRuntimeTools` 初始化时调用：

```ts
const activeChatTools = useActiveChatTools();
```

新增通用解析函数：

```ts
/**
 * 解析工具发现或执行使用的页面 binding。
 * @param binding - 可选 Runtime binding
 * @returns 页面 binding
 */
function resolveToolBinding(binding?: RuntimeToolDiscoveryBinding): ChatToolBinding | undefined {
  return binding ? binding.toolContext : activeChatTools.getActiveBinding();
}
```

`createBoundTools` 只创建应用级工具；`getActiveTools` 合并页面工具：

```ts
const pageBinding = resolveToolBinding(binding);
const pageTools = pageBinding ? activeChatTools.getBoundTools(pageBinding) : [];
const hiddenNames = new Set(pageBinding ? activeChatTools.getHiddenToolNames(pageBinding) : []);
const coreTools = createBoundTools(binding).filter((tool: AIToolExecutor): boolean => !hiddenNames.has(tool.definition.name));
const allTools = [...coreTools, ...pageTools];
```

动态 Skill/Widget 定义资源代码不作编辑。最终过滤函数删除 Editor、WebView、Widget 和 `open_resource` 的五个页面条件分支，只执行以下检查：非 `isBuiltinToolName` 返回 `false`；`READ_DIRECTORY_TOOL_NAME` 且无工作区返回 `false`；其他工具返回 `true`。

- [ ] **Step 5: 运行工具测试**

Run: `pnpm exec vitest run test/ai/tools/builtin-index.test.ts test/ai/tools/builtin-main-process-tool.test.ts test/components/BChat/use-runtime-tools.test.ts`

Expected: PASS，核心工具工厂和通用页面工具测试全部通过。

- [ ] **Step 6: 检查本任务差异但不提交**

Run: `pnpm exec eslint src/ai/tools/builtin/index.ts src/components/BChat/hooks/useRuntimeTools.ts --ext .ts`

Expected: exit 0。检查工具发现差异，不执行 stage 或 commit。

---

### Task 7: 将 Runtime capability 收敛为通用 binding

**Files:**
- Modify: `types/chat-runtime.d.ts`
- Modify: `src/ai/chat/runtimeCapabilities.ts`
- Modify: `src/components/BChat/hooks/useChatRuntimeLauncher.ts`
- Modify: `src/hooks/useChat/useRuntimeRecovery.ts`
- Modify: `test/ai/chat/runtime-capabilities.test.ts`
- Modify: `test/ai/chat/actor-system.test.ts`
- Modify: `test/components/BChat/use-chat-runtime-launcher.test.ts`
- Modify: `test/components/BChat/use-runtime-request-config.test.ts`
- Modify: `test/hooks/use-runtime-recovery.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/service.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/shared-types.test.ts`

**Interfaces:**
- Consumes: `ChatToolBinding`、`useActiveChatTools().getActiveBinding()`。
- Produces: `ChatRuntimeCapabilityDescriptor.toolContext`，不再产生三个页面 ID。

- [ ] **Step 1: 写通用 descriptor 失败测试**

更新 launcher 测试，使 `useActiveChatTools` 返回：

```ts
const activeToolsMock = vi.hoisted(() => ({
  activeBinding: { providerId: 'widget', resourceId: 'widget-a' } as ChatToolBinding | undefined,
  revision: null as unknown as Ref<number>
}));

vi.mock('@/hooks/useChatToolContext', () => ({
  useActiveChatTools: () => ({
    revision: activeToolsMock.revision,
    getActiveBinding: () => activeToolsMock.activeBinding,
    getBoundTools: () => [],
    getHiddenToolNames: () => [],
    dispatchBridge: vi.fn()
  })
}));
```

从 `types/chat-runtime` 导入 `ChatToolBinding`，从 Vue 导入 `Ref` 类型；在测试 `beforeEach` 中创建真实响应式 revision，确保晚注册用例能触发 watcher：

```ts
activeToolsMock.revision = ref<number>(0);
```

断言异步预检收到：

```ts
expect(prepareRuntimeRequest).toHaveBeenCalledWith(
  undefined,
  undefined,
  expect.objectContaining({ toolContext: activeToolsMock.activeBinding })
);
```

在 capability Registry 测试中注册：

```ts
registry.register('runtime-1', {
  tools: sourceTools,
  descriptor: {
    rendererToolNames: ['read_current_widget'],
    toolContext: { providerId: 'widget', resourceId: 'widget-a' }
  },
  getToolContext: () => undefined,
  handleBridgeRequest
});
```

修改原始 `toolContext.resourceId` 后，断言 Registry 内仍为 `widget-a`，验证嵌套冻结和复制。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run test/ai/chat/runtime-capabilities.test.ts test/components/BChat/use-chat-runtime-launcher.test.ts`

Expected: FAIL，descriptor 尚无 `toolContext`，launcher 仍捕获三个专用 ID。

- [ ] **Step 3: 更新共享 descriptor 和 capability Registry**

将 `ChatRuntimeCapabilityDescriptor` 页面字段替换为：

```ts
/** Page tool resource captured when renderer capabilities were registered. */
toolContext?: ChatToolBinding;
```

删除 `documentId`、`webviewId`、`widgetId`。从 `RuntimeExecutionCapabilities` 删除重复的 `documentId`；保留 `getToolContext` 作为 renderer 工具执行器的通用调用协议，但 BChat 注册时固定返回 `undefined`，不再通过它暴露 Editor。冻结 descriptor 时显式复制通用 binding：

```ts
descriptor: capabilities.descriptor
  ? Object.freeze({
      ...capabilities.descriptor,
      rendererToolNames: Object.freeze([...capabilities.descriptor.rendererToolNames]),
      toolContext: capabilities.descriptor.toolContext
        ? Object.freeze({ ...capabilities.descriptor.toolContext })
        : undefined
    })
  : undefined
```

- [ ] **Step 4: 更新 launcher 捕获与恢复**

`RuntimeResourceSnapshot` 只保留：

```ts
interface RuntimeResourceSnapshot {
  /** 预检开始时的页面工具 binding。 */
  readonly toolContext?: ChatToolBinding;
}
```

在 `useChatRuntimeLauncher` 内获取通用能力，并在所有 `await` 之前捕获：

```ts
const activeChatTools = useActiveChatTools();

/** 捕获预检开始时的页面资源。 */
function captureRuntimeResources(): RuntimeResourceSnapshot {
  return Object.freeze({ toolContext: activeChatTools.getActiveBinding() });
}
```

`createResourceBinding`、`createCapabilityDescriptor`、`start` 与 `upgradeRecoveredCapabilities` 都只复制 `toolContext`。注册 Actor capability 时使用：

```ts
options.actorSystem.registerRuntime(address, {
  tools,
  descriptor,
  getToolContext: (): undefined => undefined,
  handleBridgeRequest: options.createBridgeHandler(binding)
});
```

删除三个页面 Registry import；`getToolContext` 不再查询 Editor Registry，仅保留上述 page-agnostic 空实现，避免把本次页面注册改造扩大成 renderer 工具执行协议重命名。

恢复 watcher 必须加入 Registry 修订号：

```ts
watch(
  [options.activeSessionId, options.sessionActor.activeRuntimeId, activeChatTools.revision],
  async (): Promise<void> => {
    await nextTick();
    upgradeRecoveredCapabilities();
  },
  { immediate: true }
);
```

这样恢复 Runtime 早于页面挂载时，匹配 binding 的页面稍后注册会重新触发 capability 升级；升级仍使用 descriptor 中的 binding 和 allowlist，不使用新的当前页面。

- [ ] **Step 5: 迁移通用 binding 的外围恢复与传递测试**

`src/hooks/useChat/useRuntimeRecovery.ts` 的降级 capability 删除顶层 `documentId`，保留 descriptor 与 page-agnostic 工具执行 Context：

```ts
return {
  tools: [],
  descriptor: snapshot.capabilities,
  getToolContext: (): undefined => undefined,
  handleBridgeRequest: async (): Promise<never> => {
    throw new Error('Renderer context is unavailable after reload');
  }
};
```

逐一把以下 fixture 的 descriptor 页面字段替换为通用 binding：

```ts
toolContext: { providerId: 'editor', resourceId: 'document-1' }
```

- `test/hooks/use-runtime-recovery.test.ts`：快照使用 `toolContext`，断言 `getRuntimeCapabilities(...).descriptor?.toolContext`。
- `test/ai/chat/actor-system.test.ts`：删除 capability 顶层 `documentId`；第二次恢复传入 `resourceId: 'document-current'`，仍断言首次冻结的 descriptor resource 为 `document-1`。
- `test/electron/main/modules/chat/runtime/service.test.ts`：恢复快照的输入与期望都使用 `toolContext`。
- `test/electron/main/modules/chat/runtime/shared-types.test.ts`：cloneable descriptor 使用 `toolContext`。

在 `test/components/BChat/use-runtime-request-config.test.ts` 把两个 `RuntimeToolDiscoveryBinding` fixture 改为：

```ts
const toolBinding: RuntimeToolDiscoveryBinding = {
  workspaceRoot: '/workspace',
  toolContext: { providerId: 'widget', resourceId: 'widget-a' }
};
```

工作区冻结断言改为：

```ts
expect(getActiveTools).toHaveBeenCalledWith({
  toolContext: { providerId: 'widget', resourceId: 'widget-a' },
  workspaceRoot: '/workspace-a'
});
```

- [ ] **Step 6: 运行 capability 与传递测试**

Run: `pnpm exec vitest run test/ai/chat/runtime-capabilities.test.ts test/ai/chat/actor-system.test.ts test/components/BChat/use-chat-runtime-launcher.test.ts test/components/BChat/use-runtime-request-config.test.ts test/hooks/use-runtime-recovery.test.ts test/electron/main/modules/chat/runtime/service.test.ts test/electron/main/modules/chat/runtime/shared-types.test.ts`

Expected: PASS，通用 binding 在预检前捕获、跨请求准备与恢复快照传递，并在 capability Registry 内保持不可变。

- [ ] **Step 7: 检查本任务差异但不提交**

Run: `pnpm exec eslint src/ai/chat/runtimeCapabilities.ts src/components/BChat/hooks/useChatRuntimeLauncher.ts src/hooks/useChat/useRuntimeRecovery.ts --ext .ts`

Expected: exit 0。不执行 stage 或 commit。

---

### Task 8: 将 Runtime Bridge 改为通用 dispatcher

**Files:**
- Modify: `src/components/BChat/hooks/useRuntimeBridgeHandler.ts`
- Modify: `src/components/BChat/utils/runtimeBridge.ts`
- Modify: `test/components/BChat/runtime-bridge.test.ts`

**Interfaces:**
- Consumes: `RuntimeToolBinding.toolContext`、`useActiveChatTools().dispatchBridge()`。
- Produces: `BChatRuntimeBridgeDependencies.dispatchToolBridge`，应用 Bridge 与页面 Bridge 分层。

- [ ] **Step 1: 将 Bridge 测试改为 dispatcher 失败测试**

测试先统一使用完整 Runtime Bridge 事件，替换原有缺少 `turnId` 与 `rootRuntimeId` 的内联事件对象：

```ts
/**
 * 创建 Runtime Bridge 测试事件。
 * @param kind - Bridge kind
 * @param payload - 可选 Bridge payload
 * @returns 完整 Bridge 事件
 */
function createEvent(kind: string, payload?: unknown): ChatRuntimeBridgeRequestEvent {
  return {
    runtimeId: 'runtime-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    clientId: 'bchat',
    agentId: 'primary',
    rootRuntimeId: 'runtime-1',
    requestId: `request-${kind}`,
    kind,
    payload
  };
}
```

从 `types/chat-runtime` 导入 `ChatRuntimeBridgeRequestEvent`，删除 `AIToolContext` import 与 `createEditorContext()` fixture。测试依赖改为：

```ts
const dispatchToolBridge = vi.fn(async (event: ChatRuntimeBridgeRequestEvent) => {
  if (event.kind === 'document-snapshot') {
    return { handled: true as const, data: { id: 'document-a', content: '# A' } };
  }
  return { handled: false as const };
});
```

新增三个断言：

```ts
await expect(handleBChatRuntimeBridgeRequest(createEvent('document-snapshot'), createDependencies({ dispatchToolBridge }))).resolves.toEqual({
  id: 'document-a',
  content: '# A'
});
await expect(handleBChatRuntimeBridgeRequest(createEvent('widget-operate'), createDependencies({ dispatchToolBridge }))).rejects.toMatchObject({
  code: 'ACTION_NOT_SUPPORTED'
});
await expect(handleBChatRuntimeBridgeRequest(createEvent('webview-snapshot'), createDependencies({ dispatchToolBridge: undefined }))).rejects.toMatchObject({
  code: 'EDITOR_UNAVAILABLE'
});
```

为 `write-file-content` 保留页面先处理、`handled: false` 后回退 recent store 的测试。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run test/components/BChat/runtime-bridge.test.ts`

Expected: FAIL，Bridge dependencies 仍要求三个 getter。

- [ ] **Step 3: 改造 runtimeBridge 依赖和分发**

删除只用于旧测试的 `BChatRuntimeBridgeRequest` alias 和不再使用的 `ChatRuntimeEventBase` import；`handleBChatRuntimeBridgeRequest`、`readFileContentSnapshot`、`writeFileContent`、`applySetting`、`openDraft` 与 `openResource` 的事件参数统一改为 `ChatRuntimeBridgeRequestEvent`，使页面 dispatcher 和 Registry handler 共用同一个完整事件类型。

将三个页面 getter 替换为：

```ts
/** 分发 Runtime 绑定页面的 Bridge 请求。 */
dispatchToolBridge?: (
  event: ChatRuntimeBridgeRequestEvent
) => Promise<ChatBridgeDispatchResult>;
```

新增统一页面分发函数：

```ts
/**
 * 分发页面 Bridge 请求。
 * @param event - Bridge 请求
 * @param dependencies - Bridge 依赖
 * @returns 页面处理结果
 */
async function dispatchPageBridge(
  event: ChatRuntimeBridgeRequestEvent,
  dependencies: BChatRuntimeBridgeDependencies
): Promise<unknown> {
  if (!dependencies.dispatchToolBridge) {
    throw createBridgeError('EDITOR_UNAVAILABLE', 'Runtime 未绑定可用的页面工具上下文');
  }
  const result = await dependencies.dispatchToolBridge(event);
  if (!result.handled) {
    throw createBridgeError('ACTION_NOT_SUPPORTED', `绑定页面不支持 Bridge 请求：${event.kind}`);
  }
  return result.data;
}
```

删除文档、Widget、WebView 专用快照函数和 WebView 输入校验。应用级 kind 保留原分支；未匹配的 kind 最终调用 `dispatchPageBridge`。

`write-file-content` 分支先用 `asyncTo` 尝试页面拦截：

```ts
if (event.kind === 'write-file-content') {
  if (dependencies.dispatchToolBridge) {
    const [dispatchError, result] = await asyncTo(dependencies.dispatchToolBridge(event));
    if (dispatchError && (dispatchError as { code?: unknown }).code !== 'EDITOR_UNAVAILABLE') throw dispatchError;
    if (result?.handled) return result.data;
  }
  return writeFileContent(event, dependencies);
}
```

应用级 `writeFileContent` 删除 Editor Context 分支，只负责通过 `updateRecentFileById` 更新匹配的未保存文档记录。

- [ ] **Step 4: 改造 Bridge handler hook**

在 `useRuntimeBridgeHandler` 中调用 `useActiveChatTools()`，并按冻结 binding 创建 dispatcher：

```ts
const activeChatTools = useActiveChatTools();

function createBridgeHandler(binding?: RuntimeToolBinding): RuntimeBridgeHandler {
  const toolContext = binding?.toolContext;
  async function handleRuntimeBridgeRequest(event: ChatRuntimeBridgeRequestEvent): Promise<unknown> {
    return handleBChatRuntimeBridgeRequest(event, {
      dispatchToolBridge: toolContext
        ? (request: ChatRuntimeBridgeRequestEvent) => activeChatTools.dispatchBridge(toolContext, request)
        : undefined,
      getRecentFileById: (fileId: string) => recentStore.getFileById(fileId),
      updateRecentFileById: (fileId: string, updates: Partial<StoredDocumentRecord>) => recentStore.updateFile(fileId, updates),
      getSettingsSnapshot,
      applySetting: applyRuntimeSetting,
      openDraft: options.openDraft,
      openFileByPath: options.openFileByPath,
      openInWebview: (url: string): void => options.openWebview(new URL(url)),
      openExternal: (url: string): Promise<void> => native.openExternal(url)
    });
  }
  return handleRuntimeBridgeRequest;
}
```

删除三个页面 Registry import 和 getter 组装。

- [ ] **Step 5: 运行 Bridge 测试**

Run: `pnpm exec vitest run test/components/BChat/runtime-bridge.test.ts test/components/BChat/use-chat-runtime-launcher.test.ts`

Expected: PASS，应用 Bridge 保持原行为，页面 Bridge 通过通用 dispatcher。

- [ ] **Step 6: 检查本任务差异但不提交**

Run: `pnpm exec eslint src/components/BChat/hooks/useRuntimeBridgeHandler.ts src/components/BChat/utils/runtimeBridge.ts --ext .ts`

Expected: exit 0。不执行 stage 或 commit。

---

### Task 9: 切换 Runtime 集成测试到通用 binding

**Files:**
- Modify: `test/components/BChat/session-id-runtime.test.ts`
- Modify: `test/components/BChat/use-runtime-tools.test.ts`
- Modify: `test/components/BChat/use-chat-runtime-launcher.test.ts`

**Interfaces:**
- Consumes: `chatToolRegistry`、通用 descriptor、Registry `revision` 和 Bridge dispatcher。
- Produces: 后台 Runtime 隔离、预检前冻结、资源关闭和晚注册恢复的集成证据。

- [ ] **Step 1: 添加通用测试注册 helper**

在 `test/components/BChat/session-id-runtime.test.ts` 添加：

```ts
/**
 * 注册测试页面工具资源。
 * @param binding - 页面 binding
 * @param toolNames - 页面工具名称
 * @param bridgeHandlers - 页面 Bridge handlers
 * @returns 注册控制句柄
 */
function registerPageTools(
  binding: ChatToolBinding,
  toolNames: string[],
  bridgeHandlers: Readonly<Record<string, ChatBridgeHandler>>
): ChatToolHandle {
  return chatToolRegistry.register({
    binding,
    getTools: (): AIToolExecutor[] => toolNames.map(createRuntimeTool),
    hiddenToolNames: [],
    bridgeHandlers
  });
}
```

从 `@/hooks/useChatToolContext/registry` 导入 `chatToolRegistry`，从 `types/chat-runtime` 导入 `ChatToolBinding`，从 Hook types 导入 `ChatBridgeHandler` 与 `ChatToolHandle`。在每个测试的既有 `beforeEach` 中调用 `chatToolRegistry.clear()`，删除三个专用 Registry 清理。

- [ ] **Step 2: 迁移后台资源隔离用例**

将 WebView A 注册改为：

```ts
const readWebviewA = vi.fn(async (): Promise<WebviewPageSnapshot> => webviewASnapshot);
const webviewA = registerPageTools(
  { providerId: 'webview', resourceId: 'webview-a' },
  ['read_current_webpage', 'operate_webpage'],
  {
    'webview-snapshot': async () => ({ handled: true, data: await readWebviewA() })
  }
);
webviewA.activate();
```

Runtime 启动后注册并激活 WebView B，再调用 Runtime A 的 `handleBridgeRequest`，断言只调用 A。预检冻结测试继续在 `syncDirtyFromDisk` promise 解除前切换 A→B，断言 descriptor 与 Bridge 均绑定 A。

新增关闭资源断言：

```ts
webviewA.unregister();
await expect(registeredCapabilities?.handleBridgeRequest({
  runtimeId,
  sessionId: 'session-active',
  turnId: 'session-active:turn:1',
  clientId: 'bchat',
  agentId: 'primary',
  rootRuntimeId: runtimeId,
  requestId: 'bridge-webview-closed',
  kind: 'webview-snapshot'
})).rejects.toMatchObject({ code: 'EDITOR_UNAVAILABLE' });
expect(readWebviewB).not.toHaveBeenCalled();
```

- [ ] **Step 3: 迁移 descriptor fixture**

将 capability fixture 的 `documentId`、`webviewId`、`widgetId` 替换为：

```ts
toolContext: { providerId: 'widget', resourceId: 'weather' }
```

Run: `rg -n "documentId:|webviewId:|widgetId:" test/components/BChat test/ai/chat`

Expected: 仅允许业务消息或 Widget 结果数据自身的 `widgetId`；descriptor 和 `RuntimeToolBinding` fixture 不得保留旧字段。

- [ ] **Step 4: 添加晚注册恢复测试**

在 `test/components/BChat/use-chat-runtime-launcher.test.ts` 先添加该文件所需的 schema-only helper：

```ts
/**
 * 创建 Runtime launcher 测试工具。
 * @param name - 工具名称
 * @returns schema-only 工具
 */
function createRuntimeTool(name: string): AIToolExecutor {
  return {
    definition: {
      name,
      description: name,
      source: 'builtin',
      riskLevel: 'read',
      parameters: { type: 'object', properties: {} }
    },
    execute: async () => ({ toolName: name, status: 'success', data: null })
  };
}
```

同时从 `types/ai` 导入 `AIToolExecutor`。然后构造一个 descriptor 已含 binding、但 `getActiveTools` 首次返回空数组的恢复 Runtime。推进 `activeToolsMock.revision.value` 前后断言：

```ts
expect(getActiveTools).toHaveBeenLastCalledWith(
  expect.objectContaining({
    toolContext: { providerId: 'widget', resourceId: 'widget-a' }
  })
);
getActiveTools.mockReturnValue([createRuntimeTool('read_current_widget')]);
activeToolsMock.revision.value += 1;
await nextTick();
expect(actorSystem.registerRuntime).toHaveBeenLastCalledWith(
  expect.objectContaining({ runtimeId: 'runtime-a' }),
  expect.objectContaining({
    tools: [expect.objectContaining({ definition: expect.objectContaining({ name: 'read_current_widget' }) })]
  })
);
```

测试中的 recovered descriptor allowlist 必须包含 `read_current_widget`；断言重新升级仍使用 descriptor 的 `widget-a`，不读取另一个当前 binding。

- [ ] **Step 5: 运行 BChat 集成测试**

Run: `pnpm exec vitest run test/components/BChat/use-runtime-tools.test.ts test/components/BChat/use-chat-runtime-launcher.test.ts test/components/BChat/runtime-bridge.test.ts test/components/BChat/session-id-runtime.test.ts test/ai/chat/runtime-capabilities.test.ts`

Expected: PASS，通用 binding、后台隔离、资源关闭和晚注册恢复用例全部通过。

- [ ] **Step 6: 检查本任务差异但不提交**

Run: `pnpm exec eslint src/components/BChat/hooks/useRuntimeTools.ts src/components/BChat/hooks/useChatRuntimeLauncher.ts --ext .ts`

Expected: exit 0。检查 Runtime 测试差异，不执行 stage 或 commit。

---

### Task 10: 删除兼容层、更新文档并完成验证

**Files:**
- Delete: `src/ai/tools/context/editor.ts`
- Modify: `src/ai/tools/context/webview.ts`
- Modify: `src/ai/tools/context/widget.ts`
- Modify: `src/ai/tools/shared/types.ts`
- Modify: `src/components/BEditor/index.vue`
- Modify: `src/views/webview/web/index.vue`
- Modify: `src/views/widget/hooks/useWidgetToolContext.ts`
- Modify: `test/components/BEditor/editor-scroll-controller.test.ts`
- Modify: `test/views/webview/web-agent-activity.test.ts`
- Modify: `test/views/webview/web-capture-mask.test.ts`
- Modify: `test/views/webview/web-recent-record.test.ts`
- Modify: `CONTEXT.md`
- Modify: `changelog/2026-08-05.md`

**Interfaces:**
- Consumes: Tasks 3–5 providers 与 Task 9 已迁移测试。
- Produces: 无页面专用 Registry 的最终实现和完整验证证据。

- [ ] **Step 1: 运行旧耦合检查确认仍有命中**

Run: `rg -n "editorToolContextRegistry|webviewToolContextRegistry|widgetToolContextRegistry|getEditorContext|getWebviewContext|getWidgetContext" src`

Expected: 当前仍命中专用 Registry 文件和页面双写调用。

- [ ] **Step 2: 删除页面双写与专用 Registry**

执行以下精确清理：

- `src/components/BEditor/index.vue` 删除 `editorToolContextRegistry` import、`lastRegisteredDocumentId`、两个旧注册函数、旧 watch 与旧 unmount cleanup；保留 `useEditorChatContext`。
- `src/views/webview/web/index.vue` 删除 `webviewToolContextRegistry` import、setup 注册和 mounted/activated/deactivated/unmount Registry 调用；保留 WebView 资源销毁和 `useWebviewChatContext`。
- `src/views/widget/hooks/useWidgetToolContext.ts` 删除 `widgetToolContextRegistry` import、`registeredId`、`syncContext`、`clearCurrent` 与旧生命周期；保留序列化和通用 Hook。
- 删除 `src/ai/tools/context/editor.ts`。
- 从 `src/ai/tools/context/webview.ts`、`src/ai/tools/context/widget.ts` 删除 Registry interface、factory 与 singleton，只保留领域类型。
- 从 `src/ai/tools/shared/types.ts` 删除 `ToolPageContextOptions`，并改为：

```ts
export interface BuiltinToolBaseOptions extends ToolConfirmationOptions, ToolWorkspaceOptions, ToolDraftOptions {}
```

- [ ] **Step 3: 清理组件测试 mocks**

删除旧 Registry mock，并保留 provider mock：

```ts
vi.mock('@/components/BEditor/hooks/useEditorChatContext', () => ({
  useEditorChatContext: vi.fn()
}));

vi.mock('@/views/webview/web/hooks/useWebviewChatContext', () => ({
  useWebviewChatContext: vi.fn()
}));
```

Widget provider 测试使用真实通用 Registry，不 mock `useChatToolContext`。

- [ ] **Step 4: 运行页面与 BChat 回归测试**

Run: `pnpm exec vitest run test/components/BEditor/editor-scroll-controller.test.ts test/components/BEditor/use-editor-chat-context.test.ts test/views/webview/use-webview-chat-context.test.ts test/views/webview/web-agent-activity.test.ts test/views/webview/web-capture-mask.test.ts test/views/webview/web-recent-record.test.ts test/views/widget/use-widget-tool-context.test.ts test/components/BChat/session-id-runtime.test.ts`

Expected: PASS，页面与 Runtime 集成测试均不再依赖专用 Registry。

- [ ] **Step 5: 更新 CONTEXT 和 Changelog**

在 `CONTEXT.md` 的 `src/hooks` 目录树和 hooks 汇总中加入：

```markdown
`useChatToolContext`：页面向 ChatRuntime 注册工具、Bridge handlers 与稳定资源 binding。
```

在 `changelog/2026-08-05.md` 的 `## Changed` 追加：

```markdown
- 将 Editor、WebView、Widget 的 ChatRuntime 页面上下文收敛到 `useChatToolContext` 注册机制，BChat 通过通用 binding 发现工具与分发 Bridge，同时保留后台 Runtime 的资源隔离。
```

- [ ] **Step 6: 运行完整静态检查**

Run: `pnpm exec eslint src/hooks/useChatToolContext src/components/BEditor/index.vue src/components/BEditor/hooks/useEditorChatContext.ts src/views/webview/web/index.vue src/views/webview/web/hooks/useWebviewChatContext.ts src/views/widget/hooks/useWidgetToolContext.ts src/components/BChat/hooks/useRuntimeTools.ts src/components/BChat/hooks/useChatRuntimeLauncher.ts src/components/BChat/hooks/useRuntimeBridgeHandler.ts src/components/BChat/utils/runtimeBridge.ts src/ai/chat/runtimeCapabilities.ts src/ai/tools/builtin/index.ts src/ai/tools/context/webview.ts src/ai/tools/context/widget.ts src/ai/tools/shared/types.ts --ext .vue,.ts`

Expected: exit 0，无 error 或 warning。

Run: `pnpm exec tsc --noEmit`

Expected: exit 0，无 TypeScript 错误。

Run: `pnpm electron:build-main`

Expected: exit 0，主进程 TypeScript 编译通过。

- [ ] **Step 7: 运行完整测试**

Run: `pnpm test`

Expected: Vitest 与数据库测试全部通过；若存在与本功能无关的既有失败，记录精确测试名和失败输出，不修改无关代码。

- [ ] **Step 8: 最终静态耦合和差异审查**

Run: `rg -n "editorToolContextRegistry|webviewToolContextRegistry|widgetToolContextRegistry|getEditorContext|getWebviewContext|getWidgetContext" src`

Expected: 无输出；`rg` 返回 1 代表零命中，是成功结果。

Run: `git status --short`

Expected: 只新增或修改计划列出的功能文件，以及实施前已经存在的用户改动。逐个检查差异，不执行 `git add`、`git commit`、push 或 PR 操作。
