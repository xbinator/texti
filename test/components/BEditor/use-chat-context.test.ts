/**
 * @file use-chat-context.test.ts
 * @description BEditor Chat 上下文注册与 Bridge 行为测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import type { ChatRuntimeBridgeRequestEvent } from 'types/chat-runtime';
import type { VNode } from 'vue';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNoopEditorController, type EditorController } from '@/components/BEditor/adapters/types';
import { useChatContext } from '@/components/BEditor/hooks/useChatContext';
import type { EditorState } from '@/components/BEditor/types';
import { toolContextRegistry } from '@/hooks/useChat/lib/registry';
import { useActiveToolContext } from '@/hooks/useChat/useToolContext';

/**
 * 创建 Editor provider 测试 Bridge 请求。
 * @param kind - Bridge kind
 * @param payload - 可选 Bridge payload
 * @returns Bridge 请求
 */
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

describe('useChatContext', (): void => {
  afterEach((): void => toolContextRegistry.clear());

  it('registers document tools and serves the bound document bridge', async (): Promise<void> => {
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
        useChatContext({
          editorState,
          active,
          getController: (): EditorController => editorController
        });
        return (): VNode => h('div');
      }
    });
    const wrapper = mount(Host);
    const tools = useActiveToolContext();
    const binding = { providerId: 'editor', resourceId: 'document-a' };

    expect(tools.getBoundTools(binding).map((tool) => tool.definition.name)).toEqual(['read_current_document']);
    await expect(tools.dispatchBridge(binding, createEvent('document-snapshot'))).resolves.toEqual({
      handled: true,
      data: expect.objectContaining({
        id: 'document-a',
        title: 'Draft.md',
        content: '# Draft',
        locator: 'unsaved://document-a/Draft.md'
      })
    });
    await expect(
      tools.dispatchBridge(binding, createEvent('write-file-content', { path: 'unsaved://document-a/Draft.md', content: '# Updated' }))
    ).resolves.toEqual({
      handled: true,
      data: { artifactId: 'document-a', path: 'unsaved://document-a/Draft.md', content: '# Updated' }
    });
    expect(replaceDocument).toHaveBeenCalledWith('# Updated');
    await expect(
      tools.dispatchBridge(binding, createEvent('write-file-content', { path: 'unsaved://document-b/Other.md', content: '# Other' }))
    ).resolves.toEqual({ handled: false });
    wrapper.unmount();
  });

  it('preserves stable errors thrown by the editor controller', async (): Promise<void> => {
    const editorState = ref<EditorState>({
      id: 'document-a',
      name: 'Draft',
      path: null,
      ext: 'md',
      content: '# Draft'
    });
    const staleContextError = Object.assign(new Error('编辑器上下文已变化'), { code: 'STALE_CONTEXT' as const });
    const editorController: EditorController = {
      ...createNoopEditorController(),
      replaceDocument: vi.fn(async (): Promise<void> => Promise.reject(staleContextError))
    };
    const Host = defineComponent({
      setup(): () => VNode {
        useChatContext({
          editorState,
          active: ref<boolean>(true),
          getController: (): EditorController => editorController
        });
        return (): VNode => h('div');
      }
    });
    const wrapper = mount(Host);
    const tools = useActiveToolContext();

    await expect(
      tools.dispatchBridge(
        { providerId: 'editor', resourceId: 'document-a' },
        createEvent('write-file-content', { path: 'unsaved://document-a/Draft.md', content: '# Updated' })
      )
    ).rejects.toMatchObject({ code: 'STALE_CONTEXT', message: '编辑器上下文已变化' });
    wrapper.unmount();
  });
});
