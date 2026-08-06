/**
 * @file tool-context-registry.test.ts
 * @description 页面工具上下文 Registry 的资源隔离与生命周期测试。
 * @vitest-environment jsdom
 */
import type { ChatRuntimeBridgeRequestEvent, ChatToolBinding } from 'types/chat-runtime';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIToolConfirmationAdapter, AIToolConfirmationRequest } from '@/ai/tools/confirmation';
import { createToolContextRegistry } from '@/hooks/useChat/tool/registry';
import type { ToolContextTool } from '@/hooks/useChat/useContextRegistry';

/**
 * 创建测试确认适配器。
 * @param approved - 是否批准工具执行
 * @returns 确认适配器
 */
function createConfirmation(approved = true): AIToolConfirmationAdapter {
  return {
    confirm: vi.fn(async (): Promise<boolean> => approved)
  };
}

/**
 * 创建 schema-only 测试工具。
 * @param name - 工具名称
 * @returns 工具执行器
 */
function createTool(name: string): ToolContextTool {
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

describe('tool context registry', (): void => {
  beforeEach((): void => {
    setActivePinia(createPinia());
  });

  it('resolves tools and handlers only through the exact binding', async (): Promise<void> => {
    const registry = createToolContextRegistry();
    const editorBinding: ChatToolBinding = { providerId: 'editor', resourceId: 'shared-id' };
    const widgetBinding: ChatToolBinding = { providerId: 'widget', resourceId: 'shared-id' };
    const editorHandler = vi.fn(() => ({ handled: true as const, data: { title: 'Editor' } }));
    const editor = registry.register({
      binding: editorBinding,
      getTools: () => [createTool('read_current_document')],
      hiddenToolNames: [],
      appBridgeHandlers: { 'document-snapshot': editorHandler }
    });
    registry.register({
      binding: widgetBinding,
      getTools: () => [createTool('read_current_widget')],
      hiddenToolNames: [],
      appBridgeHandlers: {}
    });

    editor.activate();

    expect(registry.getActiveBinding()).toEqual(editorBinding);
    expect(Object.isFrozen(registry.getActiveBinding())).toBe(true);
    expect(registry.getBoundTools(editorBinding, { confirmation: createConfirmation() }).map((tool) => tool.definition.name)).toEqual([
      'read_current_document'
    ]);
    expect(registry.getBoundTools(widgetBinding, { confirmation: createConfirmation() }).map((tool) => tool.definition.name)).toEqual(['read_current_widget']);
    await expect(registry.dispatchAppBridge(editorBinding, createEvent('document-snapshot'))).resolves.toEqual({
      handled: true,
      data: { title: 'Editor' }
    });
    expect(editorHandler).toHaveBeenCalledOnce();
  });

  it('keeps newer registrations safe from stale cleanup and freezes hidden names', (): void => {
    const registry = createToolContextRegistry();
    const binding: ChatToolBinding = { providerId: 'webview', resourceId: 'web-a' };
    const first = registry.register({
      binding,
      getTools: () => [createTool('read_current_webpage')],
      hiddenToolNames: ['open_resource'],
      appBridgeHandlers: {}
    });
    const second = registry.register({
      binding,
      getTools: () => [createTool('operate_webpage')],
      hiddenToolNames: ['open_resource', 'open_resource'],
      appBridgeHandlers: {}
    });

    second.activate();
    first.unregister();

    expect(registry.getActiveBinding()).toEqual(binding);
    expect(registry.getBoundTools(binding, { confirmation: createConfirmation() }).map((tool) => tool.definition.name)).toEqual(['operate_webpage']);
    expect(registry.getHiddenToolNames(binding)).toEqual(['open_resource']);
    expect(Object.isFrozen(registry.getHiddenToolNames(binding))).toBe(true);
  });

  it('ignores every stale lifecycle operation after the same binding is replaced', (): void => {
    const registry = createToolContextRegistry();
    const binding: ChatToolBinding = { providerId: 'editor', resourceId: 'document-a' };
    const first = registry.register({ binding, getTools: () => [createTool('old_tool')], hiddenToolNames: [], appBridgeHandlers: {} });
    const second = registry.register({ binding, getTools: () => [createTool('new_tool')], hiddenToolNames: [], appBridgeHandlers: {} });

    second.activate();
    first.activate();
    first.deactivate();
    first.unregister();

    expect(registry.getActiveBinding()).toEqual(binding);
    expect(registry.getBoundTools(binding, { confirmation: createConfirmation() }).map((tool) => tool.definition.name)).toEqual(['new_tool']);
  });

  it('fails closed for a missing binding and reports an unsupported handler', async (): Promise<void> => {
    const registry = createToolContextRegistry();
    const binding: ChatToolBinding = { providerId: 'widget', resourceId: 'widget-a' };
    const missing: ChatToolBinding = { providerId: 'widget', resourceId: 'missing' };
    registry.register({ binding, getTools: () => [], hiddenToolNames: [], appBridgeHandlers: {} });

    expect(registry.getBoundTools(missing, { confirmation: createConfirmation() })).toEqual([]);
    await expect(registry.dispatchAppBridge(binding, createEvent('widget-operate'))).resolves.toEqual({ handled: false });
    await expect(registry.dispatchAppBridge(missing, createEvent('widget-snapshot'))).rejects.toMatchObject({ code: 'EDITOR_UNAVAILABLE' });
  });

  it('rejects duplicate tool names returned by one resource', (): void => {
    const registry = createToolContextRegistry();
    const binding: ChatToolBinding = { providerId: 'editor', resourceId: 'document-a' };

    expect(() =>
      registry.register({
        binding,
        getTools: () => [createTool('read_current_document'), createTool('read_current_document')],
        hiddenToolNames: [],
        appBridgeHandlers: {}
      })
    ).toThrow('Duplicate Tool context tool name: read_current_document');
  });

  it('rejects page tool definitions that cannot cross the Runtime IPC boundary', (): void => {
    const registry = createToolContextRegistry();
    const tool = createTool('inspect_page');
    const invalidTool: ToolContextTool = {
      ...tool,
      definition: {
        ...tool.definition,
        parameters: { type: 'object', properties: { callback: { default: (): null => null } } }
      }
    };

    expect(() =>
      registry.register({
        binding: { providerId: 'future-page', resourceId: 'page-a' },
        getTools: () => [invalidTool],
        hiddenToolNames: [],
        appBridgeHandlers: {}
      })
    ).toThrow('Tool context definition must be cloneable: inspect_page');
  });

  it('revalidates dynamic tool names on every resource read', (): void => {
    const registry = createToolContextRegistry();
    const binding: ChatToolBinding = { providerId: 'future-page', resourceId: 'page-a' };
    let duplicate = false;
    registry.register({
      binding,
      getTools: () => (duplicate ? [createTool('future_tool'), createTool('future_tool')] : [createTool('future_tool')]),
      hiddenToolNames: [],
      appBridgeHandlers: {}
    });

    duplicate = true;

    expect(() => registry.getBoundTools(binding, { confirmation: createConfirmation() })).toThrow('Duplicate Tool context tool name: future_tool');
  });

  it('fails closed when cloneable tool metadata changes without a new registration', (): void => {
    const registry = createToolContextRegistry();
    const binding: ChatToolBinding = { providerId: 'future-page', resourceId: 'page-a' };
    let description = 'initial description';
    registry.register({
      binding,
      getTools: () => [
        {
          ...createTool('future_tool'),
          definition: { ...createTool('future_tool').definition, description }
        }
      ],
      hiddenToolNames: [],
      appBridgeHandlers: {}
    });

    description = 'changed description';

    expect(() => registry.getBoundTools(binding, { confirmation: createConfirmation() })).toThrow(
      'Tool context metadata changed without re-registration: future-page:page-a'
    );
  });

  it('fails closed when a captured page executor runs after its resource is removed', async (): Promise<void> => {
    const registry = createToolContextRegistry();
    const binding: ChatToolBinding = { providerId: 'future-page', resourceId: 'page-a' };
    const execute = vi.fn(async () => ({ toolName: 'future_tool', status: 'success' as const, data: 'unsafe' }));
    const handle = registry.register({
      binding,
      getTools: () => [{ ...createTool('future_tool'), execute }],
      hiddenToolNames: [],
      appBridgeHandlers: {}
    });
    const capturedTool = registry.getBoundTools(binding, { confirmation: createConfirmation() })[0];
    if (!capturedTool) throw new Error('captured page tool should exist');

    handle.unregister();

    await expect(capturedTool.execute({})).resolves.toMatchObject({
      status: 'failure',
      error: { code: 'EDITOR_UNAVAILABLE' }
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not enter a page handler when the Runtime was already interrupted', async (): Promise<void> => {
    const registry = createToolContextRegistry();
    const execute = vi.fn(async () => ({ toolName: 'future_tool', status: 'success' as const, data: 'unsafe' }));
    const binding: ChatToolBinding = { providerId: 'future-page', resourceId: 'page-a' };
    registry.register({
      binding,
      getTools: () => [{ ...createTool('future_tool'), execute }],
      hiddenToolNames: [],
      appBridgeHandlers: {}
    });
    const tool = registry.getBoundTools(binding, { confirmation: createConfirmation() })[0];
    if (!tool) throw new Error('future page tool should exist');
    const controller = new AbortController();
    controller.abort();

    await expect(tool.execute({}, undefined, { abortSignal: controller.signal })).resolves.toMatchObject({
      status: 'failure',
      error: { code: 'RUNTIME_INTERRUPTED' }
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('routes a captured executor through the current owner of the exact binding', async (): Promise<void> => {
    const registry = createToolContextRegistry();
    const binding: ChatToolBinding = { providerId: 'future-page', resourceId: 'page-a' };
    const oldExecute = vi.fn(async () => ({ toolName: 'future_tool', status: 'success' as const, data: 'old' }));
    const newExecute = vi.fn(async () => ({ toolName: 'future_tool', status: 'success' as const, data: 'new' }));
    registry.register({
      binding,
      getTools: () => [{ ...createTool('future_tool'), execute: oldExecute }],
      hiddenToolNames: [],
      appBridgeHandlers: {}
    });
    const capturedTool = registry.getBoundTools(binding, { confirmation: createConfirmation() })[0];
    if (!capturedTool) throw new Error('captured page tool should exist');
    registry.register({
      binding,
      getTools: () => [{ ...createTool('future_tool'), execute: newExecute }],
      hiddenToolNames: [],
      appBridgeHandlers: {}
    });

    await expect(capturedTool.execute({})).resolves.toMatchObject({ status: 'success', data: 'new' });
    expect(oldExecute).not.toHaveBeenCalled();
    expect(newExecute).toHaveBeenCalledOnce();
  });

  it('confirms a write page tool before executing its handler', async (): Promise<void> => {
    const registry = createToolContextRegistry();
    const binding: ChatToolBinding = { providerId: 'future-page', resourceId: 'page-a' };
    const execute = vi.fn(async () => ({ toolName: 'change_page', status: 'success' as const, data: 'changed' }));
    const confirmation = createConfirmation(false);
    registry.register({
      binding,
      getTools: () => [
        {
          ...createTool('change_page'),
          definition: {
            ...createTool('change_page').definition,
            riskLevel: 'write',
            safeAutoApprove: false
          },
          createConfirmation: () => ({ title: '修改页面', description: '将修改当前页面。' }),
          execute
        }
      ],
      hiddenToolNames: [],
      appBridgeHandlers: {}
    });

    const tool = registry.getBoundTools(binding, { confirmation })[0];
    if (!tool) throw new Error('write page tool should exist');
    const result = await tool.execute({ value: 'next' });

    expect(result).toMatchObject({ status: 'failure', error: { code: 'USER_CANCELLED' } });
    expect(confirmation.confirm).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });

  it('honors definition-level permission remembering without making a write tool auto-safe', async (): Promise<void> => {
    const registry = createToolContextRegistry();
    const binding: ChatToolBinding = { providerId: 'future-page', resourceId: 'page-a' };
    const execute = vi.fn(async () => ({ toolName: 'change_page', status: 'success' as const, data: 'changed' }));
    const confirm = vi.fn(async (request: AIToolConfirmationRequest): Promise<{ approved: true }> => {
      expect(request.allowRemember).toBe(true);
      return { approved: true };
    });
    registry.register({
      binding,
      getTools: () => [
        {
          ...createTool('change_page'),
          definition: {
            ...createTool('change_page').definition,
            riskLevel: 'write',
            safeAutoApprove: false,
            allowPermissionRemember: true
          },
          execute
        }
      ],
      hiddenToolNames: [],
      appBridgeHandlers: {}
    });
    const tool = registry.getBoundTools(binding, { confirmation: { confirm } })[0];
    if (!tool) throw new Error('write page tool should exist');

    await expect(tool.execute({ value: 'next' })).resolves.toMatchObject({ status: 'success' });
    expect(confirm).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });

  it('returns a stable failure when confirmation input validation rejects the call', async (): Promise<void> => {
    const registry = createToolContextRegistry();
    const binding: ChatToolBinding = { providerId: 'future-page', resourceId: 'page-a' };
    const execute = vi.fn(async () => ({ toolName: 'change_page', status: 'success' as const, data: 'changed' }));
    const confirmation = createConfirmation(true);
    registry.register({
      binding,
      getTools: () => [
        {
          ...createTool('change_page'),
          definition: {
            ...createTool('change_page').definition,
            riskLevel: 'write',
            safeAutoApprove: false
          },
          createConfirmation: () => {
            throw Object.assign(new Error('页面操作参数无效'), { code: 'INVALID_INPUT' as const });
          },
          execute
        }
      ],
      hiddenToolNames: [],
      appBridgeHandlers: {}
    });

    const tool = registry.getBoundTools(binding, { confirmation })[0];
    if (!tool) throw new Error('write page tool should exist');
    const result = await tool.execute({ invalid: true });

    expect(result).toMatchObject({ status: 'failure', error: { code: 'INVALID_INPUT', message: '页面操作参数无效' } });
    expect(confirmation.confirm).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('reads frozen history and presentation only from the exact binding', (): void => {
    const registry = createToolContextRegistry();
    const editorBinding: ChatToolBinding = { providerId: 'editor', resourceId: 'page-a' };
    const widgetBinding: ChatToolBinding = { providerId: 'widget', resourceId: 'page-a' };
    registry.register({
      binding: editorBinding,
      getTools: () => [
        {
          ...createTool('inspect_page'),
          presentation: { label: '检查编辑页' },
          history: { mode: 'latest-only', placeholder: '已保留最新结果', redactInputPaths: ['secret.token'] }
        }
      ],
      hiddenToolNames: [],
      appBridgeHandlers: {}
    });
    registry.register({ binding: widgetBinding, getTools: () => [createTool('inspect_widget')], hiddenToolNames: [], appBridgeHandlers: {} });

    const descriptors = registry.getRendererTools(editorBinding);

    expect(registry.getPresentation(editorBinding, 'inspect_page')).toEqual({ label: '检查编辑页' });
    expect(registry.getPresentation(widgetBinding, 'inspect_page')).toBeUndefined();
    expect(descriptors).toEqual([
      {
        name: 'inspect_page',
        history: { mode: 'latest-only', placeholder: '已保留最新结果', redactInputPaths: ['secret.token'] }
      }
    ]);
    expect(Object.isFrozen(descriptors)).toBe(true);
    expect(Object.isFrozen(descriptors[0])).toBe(true);
    expect(Object.isFrozen(descriptors[0]?.history)).toBe(true);
    expect(Object.isFrozen(descriptors[0]?.history?.redactInputPaths)).toBe(true);
  });

  it('rejects unsafe renderer history metadata during registration', (): void => {
    const registry = createToolContextRegistry();
    const binding: ChatToolBinding = { providerId: 'future-page', resourceId: 'page-a' };

    expect(() =>
      registry.register({
        binding,
        getTools: () => [{ ...createTool('inspect_page'), history: { mode: 'latest-only', redactInputPaths: ['payload.__proto__.token'] } }],
        hiddenToolNames: [],
        appBridgeHandlers: {}
      })
    ).toThrow('Invalid renderer history redact path for tool: inspect_page');
  });

  it('publishes registration and activation changes', (): void => {
    const registry = createToolContextRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    const handle = registry.register({
      binding: { providerId: 'editor', resourceId: 'document-a' },
      getTools: () => [],
      hiddenToolNames: [],
      appBridgeHandlers: {}
    });

    handle.activate();
    handle.deactivate();
    handle.unregister();
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(4);
  });
});
