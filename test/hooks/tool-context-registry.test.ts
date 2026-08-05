/**
 * @file tool-context-registry.test.ts
 * @description 页面工具上下文 Registry 的资源隔离与生命周期测试。
 */
import type { AIToolExecutor } from 'types/ai';
import type { ChatRuntimeBridgeRequestEvent, ChatToolBinding } from 'types/chat-runtime';
import { describe, expect, it, vi } from 'vitest';
import { createToolContextRegistry } from '@/hooks/useChat/lib/registry';

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

describe('tool context registry', (): void => {
  it('resolves tools and handlers only through the exact binding', async (): Promise<void> => {
    const registry = createToolContextRegistry();
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
    expect(Object.isFrozen(registry.getActiveBinding())).toBe(true);
    expect(registry.getBoundTools(editorBinding).map((tool) => tool.definition.name)).toEqual(['read_current_document']);
    expect(registry.getBoundTools(widgetBinding).map((tool) => tool.definition.name)).toEqual(['read_current_widget']);
    await expect(registry.dispatchBridge(editorBinding, createEvent('document-snapshot'))).resolves.toEqual({
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

  it('ignores every stale lifecycle operation after the same binding is replaced', (): void => {
    const registry = createToolContextRegistry();
    const binding: ChatToolBinding = { providerId: 'editor', resourceId: 'document-a' };
    const first = registry.register({ binding, getTools: () => [createTool('old_tool')], hiddenToolNames: [], bridgeHandlers: {} });
    const second = registry.register({ binding, getTools: () => [createTool('new_tool')], hiddenToolNames: [], bridgeHandlers: {} });

    second.activate();
    first.activate();
    first.deactivate();
    first.unregister();

    expect(registry.getActiveBinding()).toEqual(binding);
    expect(registry.getBoundTools(binding).map((tool) => tool.definition.name)).toEqual(['new_tool']);
  });

  it('fails closed for a missing binding and reports an unsupported handler', async (): Promise<void> => {
    const registry = createToolContextRegistry();
    const binding: ChatToolBinding = { providerId: 'widget', resourceId: 'widget-a' };
    const missing: ChatToolBinding = { providerId: 'widget', resourceId: 'missing' };
    registry.register({ binding, getTools: () => [], hiddenToolNames: [], bridgeHandlers: {} });

    expect(registry.getBoundTools(missing)).toEqual([]);
    await expect(registry.dispatchBridge(binding, createEvent('widget-operate'))).resolves.toEqual({ handled: false });
    await expect(registry.dispatchBridge(missing, createEvent('widget-snapshot'))).rejects.toMatchObject({ code: 'EDITOR_UNAVAILABLE' });
  });

  it('rejects duplicate tool names returned by one resource', (): void => {
    const registry = createToolContextRegistry();
    const binding: ChatToolBinding = { providerId: 'editor', resourceId: 'document-a' };

    expect(() =>
      registry.register({
        binding,
        getTools: () => [createTool('read_current_document'), createTool('read_current_document')],
        hiddenToolNames: [],
        bridgeHandlers: {}
      })
    ).toThrow('Duplicate Tool context tool name: read_current_document');
  });

  it('revalidates dynamic tool names on every resource read', (): void => {
    const registry = createToolContextRegistry();
    const binding: ChatToolBinding = { providerId: 'future-page', resourceId: 'page-a' };
    let duplicate = false;
    registry.register({
      binding,
      getTools: () => (duplicate ? [createTool('future_tool'), createTool('future_tool')] : [createTool('future_tool')]),
      hiddenToolNames: [],
      bridgeHandlers: {}
    });

    duplicate = true;

    expect(() => registry.getBoundTools(binding)).toThrow('Duplicate Tool context tool name: future_tool');
  });

  it('fails closed when a captured page executor runs after its resource is removed', async (): Promise<void> => {
    const registry = createToolContextRegistry();
    const binding: ChatToolBinding = { providerId: 'future-page', resourceId: 'page-a' };
    const execute = vi.fn(async () => ({ toolName: 'future_tool', status: 'success' as const, data: 'unsafe' }));
    const handle = registry.register({
      binding,
      getTools: () => [{ ...createTool('future_tool'), execute }],
      hiddenToolNames: [],
      bridgeHandlers: {}
    });
    const capturedTool = registry.getBoundTools(binding)[0];
    if (!capturedTool) throw new Error('captured page tool should exist');

    handle.unregister();

    await expect(capturedTool.execute({})).resolves.toMatchObject({
      status: 'failure',
      error: { code: 'EDITOR_UNAVAILABLE' }
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
      bridgeHandlers: {}
    });
    const capturedTool = registry.getBoundTools(binding)[0];
    if (!capturedTool) throw new Error('captured page tool should exist');
    registry.register({
      binding,
      getTools: () => [{ ...createTool('future_tool'), execute: newExecute }],
      hiddenToolNames: [],
      bridgeHandlers: {}
    });

    await expect(capturedTool.execute({})).resolves.toMatchObject({ status: 'success', data: 'new' });
    expect(oldExecute).not.toHaveBeenCalled();
    expect(newExecute).toHaveBeenCalledOnce();
  });

  it('publishes registration and activation changes', (): void => {
    const registry = createToolContextRegistry();
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
