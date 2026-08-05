/**
 * @file use-chat-context.test.ts
 * @description WebView Chat 上下文注册与 Bridge 行为测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import type { ChatRuntimeBridgeRequestEvent } from 'types/chat-runtime';
import type { VNode } from 'vue';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toolContextRegistry } from '@/hooks/useChat/lib/registry';
import { useActiveToolContext } from '@/hooks/useChat/useToolContext';
import { useChatContext } from '@/views/webview/web/hooks/useChatContext';
import type { WebviewOperateResult, WebviewPageSnapshot, WebviewToolContext } from '@/views/webview/web/types';

/** WebView 页面快照夹具。 */
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

/** WebView 操作结果夹具。 */
const operationResult: WebviewOperateResult = {
  ok: true,
  action: 'click',
  target: { index: 1, label: 'Open', tagName: 'BUTTON' },
  message: 'Clicked Open',
  navigationStarted: false,
  pageChanged: true,
  shouldReadAgain: true
};

/**
 * 创建 WebView provider 测试 Bridge 请求。
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

  it('registers webpage tools, hides open_resource, and validates operations', async (): Promise<void> => {
    const resourceId = ref<string>('/webview/a');
    const available = ref<boolean>(true);
    const context: WebviewToolContext = {
      readPageSnapshot: vi.fn(async (): Promise<WebviewPageSnapshot> => pageSnapshot),
      operatePage: vi.fn(async (): Promise<WebviewOperateResult> => operationResult)
    };
    const Host = defineComponent({
      setup(): () => VNode {
        useChatContext({ resourceId, available, context });
        return (): VNode => h('div');
      }
    });
    const wrapper = mount(Host);
    const tools = useActiveToolContext();
    const binding = { providerId: 'webview', resourceId: '/webview/a' };

    expect(tools.getBoundTools(binding).map((tool) => tool.definition.name)).toEqual(['read_current_webpage', 'operate_webpage']);
    expect(tools.getHiddenToolNames(binding)).toEqual(['open_resource']);
    await expect(tools.dispatchBridge(binding, createEvent('webview-snapshot'))).resolves.toEqual({
      handled: true,
      data: pageSnapshot
    });
    await expect(tools.dispatchBridge(binding, createEvent('webview-operate', { action: { type: 'click', index: 1 } }))).rejects.toMatchObject({
      code: 'INVALID_INPUT'
    });
    await expect(
      tools.dispatchBridge(binding, createEvent('webview-operate', { snapshotId: 'snapshot-a', action: { type: 'click', index: 1 } }))
    ).resolves.toEqual({ handled: true, data: operationResult });
    expect(context.operatePage).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it('preserves stable errors thrown by the WebView context', async (): Promise<void> => {
    const resourceId = ref<string>('/webview/a');
    const available = ref<boolean>(true);
    const staleSnapshotError = Object.assign(new Error('网页快照已过期'), { code: 'STALE_SNAPSHOT' as const });
    const context: WebviewToolContext = {
      readPageSnapshot: vi.fn(async (): Promise<WebviewPageSnapshot> => pageSnapshot),
      operatePage: vi.fn(async (): Promise<WebviewOperateResult> => Promise.reject(staleSnapshotError))
    };
    const Host = defineComponent({
      setup(): () => VNode {
        useChatContext({ resourceId, available, context });
        return (): VNode => h('div');
      }
    });
    const wrapper = mount(Host);
    const tools = useActiveToolContext();
    const binding = { providerId: 'webview', resourceId: '/webview/a' };

    await expect(
      tools.dispatchBridge(binding, createEvent('webview-operate', { snapshotId: 'snapshot-a', action: { type: 'click', index: 1 } }))
    ).rejects.toMatchObject({ code: 'STALE_SNAPSHOT', message: '网页快照已过期' });
    wrapper.unmount();
  });

  it('preserves stable errors thrown while reading the WebView context', async (): Promise<void> => {
    const resourceId = ref<string>('/webview/a');
    const available = ref<boolean>(true);
    const pageLoadingError = Object.assign(new Error('页面正在导航'), { code: 'PAGE_LOADING' as const });
    const context: WebviewToolContext = {
      readPageSnapshot: vi.fn(async (): Promise<WebviewPageSnapshot> => Promise.reject(pageLoadingError)),
      operatePage: vi.fn(async (): Promise<WebviewOperateResult> => operationResult)
    };
    const Host = defineComponent({
      setup(): () => VNode {
        useChatContext({ resourceId, available, context });
        return (): VNode => h('div');
      }
    });
    const wrapper = mount(Host);
    const tools = useActiveToolContext();

    await expect(tools.dispatchBridge({ providerId: 'webview', resourceId: '/webview/a' }, createEvent('webview-snapshot'))).rejects.toMatchObject({
      code: 'PAGE_LOADING',
      message: '页面正在导航'
    });
    wrapper.unmount();
  });
});
