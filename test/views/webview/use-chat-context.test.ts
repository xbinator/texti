/**
 * @file use-chat-context.test.ts
 * @description WebView 页面工具自注册、权限与稳定错误语义测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import type { VNode } from 'vue';
import { defineComponent, h, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIToolConfirmationAdapter } from '@/ai/tools/confirmation';
import { toolContextRegistry } from '@/hooks/useChat/tool/registry';
import { useActiveChatContext } from '@/hooks/useChat/useContextRegistry';
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
 * 创建确认适配器。
 * @param approved - 是否批准写操作
 * @returns 可观测确认适配器
 */
function createConfirmation(approved: boolean): AIToolConfirmationAdapter {
  return { confirm: vi.fn(async (): Promise<boolean> => approved) };
}

/**
 * 挂载一个 WebView 工具上下文。
 * @param context - 强类型页面上下文
 * @returns Vue 测试 wrapper
 */
function mountContext(context: WebviewToolContext): ReturnType<typeof mount> {
  const resourceId = ref<string>('/webview/a');
  const available = ref<boolean>(true);
  const Host = defineComponent({
    setup(): () => VNode {
      useChatContext({ resourceId, available, context });
      return (): VNode => h('div');
    }
  });
  return mount(Host);
}

describe('useChatContext', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach((): void => toolContextRegistry.clear());

  it('registers executable webpage tools with presentation and history metadata', async (): Promise<void> => {
    const context: WebviewToolContext = {
      readPageSnapshot: vi.fn(async (): Promise<WebviewPageSnapshot> => pageSnapshot),
      operatePage: vi.fn(async (): Promise<WebviewOperateResult> => operationResult)
    };
    const wrapper = mountContext(context);
    const tools = useActiveChatContext();
    const binding = { providerId: 'webview', resourceId: '/webview/a' };
    const confirmation = createConfirmation(true);
    const executors = tools.getBoundTools(binding, { confirmation });
    const readTool = executors.find((tool): boolean => tool.definition.name === 'read_current_webpage');
    if (!readTool) throw new Error('read_current_webpage should be registered');

    await expect(readTool.execute({})).resolves.toEqual({ toolName: 'read_current_webpage', status: 'success', data: pageSnapshot });
    expect(tools.getHiddenToolNames(binding)).toEqual(['open_resource']);
    expect(tools.getPresentation(binding, 'read_current_webpage')).toEqual(expect.objectContaining({ label: '读取当前网页' }));
    expect(tools.getPresentation(binding, 'operate_webpage')).toEqual(expect.objectContaining({ label: '操作当前网页' }));
    expect(tools.getRendererTools(binding)).toEqual([
      {
        name: 'read_current_webpage',
        history: { mode: 'latest-only', placeholder: '历史网页快照已裁剪，请重新读取当前网页。' }
      },
      {
        name: 'operate_webpage',
        history: { mode: 'keep', redactInputPaths: ['snapshotId', 'step', 'action.text', 'action.url', 'action.optionText'] }
      }
    ]);
    wrapper.unmount();
  });

  it('validates an operation before confirmation and executes only after approval', async (): Promise<void> => {
    const context: WebviewToolContext = {
      readPageSnapshot: vi.fn(async (): Promise<WebviewPageSnapshot> => pageSnapshot),
      operatePage: vi.fn(async (): Promise<WebviewOperateResult> => operationResult)
    };
    const wrapper = mountContext(context);
    const tools = useActiveChatContext();
    const confirmation = createConfirmation(true);
    const controller = new AbortController();
    const operateTool = tools
      .getBoundTools({ providerId: 'webview', resourceId: '/webview/a' }, { confirmation })
      .find((tool): boolean => tool.definition.name === 'operate_webpage');
    if (!operateTool) throw new Error('operate_webpage should be registered');

    await expect(operateTool.execute({ action: { type: 'click', index: 1 } })).resolves.toMatchObject({
      status: 'failure',
      error: { code: 'INVALID_INPUT' }
    });
    expect(confirmation.confirm).not.toHaveBeenCalled();

    await expect(
      operateTool.execute(
        {
          snapshotId: 'snapshot-a',
          step: { evaluation: '', memory: '', nextGoal: 'open' },
          action: { type: 'click', index: 1, unknown: 'drop' }
        },
        undefined,
        { abortSignal: controller.signal }
      )
    ).resolves.toEqual({ toolName: 'operate_webpage', status: 'success', data: operationResult });
    expect(confirmation.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'operate_webpage', title: '操作当前网页', description: '点击当前网页元素 #1' })
    );
    expect(context.operatePage).toHaveBeenCalledWith({ snapshotId: 'snapshot-a', action: { type: 'click', index: 1 } }, controller.signal);
    wrapper.unmount();
  });

  it('does not operate the page when permission is denied', async (): Promise<void> => {
    const context: WebviewToolContext = {
      readPageSnapshot: vi.fn(async (): Promise<WebviewPageSnapshot> => pageSnapshot),
      operatePage: vi.fn(async (): Promise<WebviewOperateResult> => operationResult)
    };
    const wrapper = mountContext(context);
    const tools = useActiveChatContext();
    const confirmation = createConfirmation(false);
    const operateTool = tools
      .getBoundTools({ providerId: 'webview', resourceId: '/webview/a' }, { confirmation })
      .find((tool): boolean => tool.definition.name === 'operate_webpage');
    if (!operateTool) throw new Error('operate_webpage should be registered');

    await expect(
      operateTool.execute({
        snapshotId: 'snapshot-a',
        step: { evaluation: '', memory: '', nextGoal: 'open' },
        action: { type: 'click', index: 1 }
      })
    ).resolves.toMatchObject({ status: 'failure', error: { code: 'USER_CANCELLED' } });
    expect(context.operatePage).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('preserves stable errors thrown by read and operate handlers', async (): Promise<void> => {
    const pageLoadingError = Object.assign(new Error('页面正在导航'), { code: 'PAGE_LOADING' as const });
    const staleSnapshotError = Object.assign(new Error('网页快照已过期'), { code: 'STALE_SNAPSHOT' as const });
    const context: WebviewToolContext = {
      readPageSnapshot: vi.fn(async (): Promise<WebviewPageSnapshot> => Promise.reject(pageLoadingError)),
      operatePage: vi.fn(async (): Promise<WebviewOperateResult> => Promise.reject(staleSnapshotError))
    };
    const wrapper = mountContext(context);
    const tools = useActiveChatContext();
    const executors = tools.getBoundTools({ providerId: 'webview', resourceId: '/webview/a' }, { confirmation: createConfirmation(true) });
    const readTool = executors.find((tool): boolean => tool.definition.name === 'read_current_webpage');
    const operateTool = executors.find((tool): boolean => tool.definition.name === 'operate_webpage');
    if (!readTool || !operateTool) throw new Error('WebView tools should be registered');

    await expect(readTool.execute({})).resolves.toMatchObject({ status: 'failure', error: { code: 'PAGE_LOADING', message: '页面正在导航' } });
    await expect(
      operateTool.execute({
        snapshotId: 'snapshot-a',
        step: { evaluation: '', memory: '', nextGoal: 'open' },
        action: { type: 'click', index: 1 }
      })
    ).resolves.toMatchObject({ status: 'failure', error: { code: 'STALE_SNAPSHOT', message: '网页快照已过期' } });
    wrapper.unmount();
  });
});
