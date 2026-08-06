/**
 * @file chat-page-tool-self-registration.test.ts
 * @description 用一个中央工具表完全未知的第四页面验证端到端自注册协议。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import type { ActiveChatRuntime } from '../../electron/main/modules/chat/runtime/types.mjs';
import type { AIToolExecutionResult } from 'types/ai';
import type { ChatMessagePart, ChatMessageRecord, ChatMessageToolPart } from 'types/chat';
import type { VNode } from 'vue';
import { defineComponent, h, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toolContextRegistry } from '@/hooks/useChat/tool/registry';
import { useActiveChatContext, useChatContextProvider, type ToolContextTool } from '@/hooks/useChat/useContextRegistry';
import { projectRendererToolOutputs } from '../../electron/main/modules/chat/runtime/context/renderer-tool-output.mjs';
import { isRendererManagedTool } from '../../electron/main/modules/chat/runtime/stream/tools.mjs';

/** 虚构第四页面的工具名，不出现在任何生产中央配置。 */
const TEST_PAGE_TOOL_NAME = 'inspect_test_page';

/**
 * 创建第四页面的完整本地工具。
 * @param execute - 页面真实执行函数
 * @returns 页面一次性注册契约
 */
function createTestPageTool(execute: ToolContextTool['execute']): ToolContextTool {
  return {
    definition: {
      name: TEST_PAGE_TOOL_NAME,
      description: 'Inspect the currently bound test page',
      source: 'builtin',
      riskLevel: 'read',
      requiresActiveDocument: false,
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    },
    execute,
    presentation: { label: '检查测试页面', summarize: (): string => '已检查测试页面' },
    history: { mode: 'latest-only', placeholder: '历史测试页面结果已裁剪。' }
  };
}

/**
 * 创建只包含第四页面工具的历史消息。
 * @param id - 消息标识
 * @param value - 页面结果标识
 * @returns ChatRuntime 消息
 */
function createMessage(id: string, value: string): ChatMessageRecord {
  const part: ChatMessageToolPart = {
    id: `part-${id}`,
    type: 'tool',
    toolCallId: `call-${id}`,
    toolName: TEST_PAGE_TOOL_NAME,
    status: 'done',
    input: {},
    result: { toolName: TEST_PAGE_TOOL_NAME, status: 'success', data: { value } }
  };
  return {
    id,
    sessionId: 'session-test-page',
    role: 'assistant',
    content: '',
    parts: [part] as ChatMessagePart[],
    createdAt: '2026-08-05T00:00:00.000Z',
    loading: false,
    finished: true
  };
}

describe('chat page tool self registration integration', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach((): void => toolContextRegistry.clear());

  it('discovers, executes, presents, projects and revokes an unknown fourth-page tool', async (): Promise<void> => {
    const execute = vi.fn(
      async (): Promise<AIToolExecutionResult> => ({
        toolName: TEST_PAGE_TOOL_NAME,
        status: 'success',
        data: { title: 'Test page' }
      })
    );
    const Host = defineComponent({
      setup(): () => VNode {
        useChatContextProvider({
          providerId: 'test-page',
          resourceId: ref<string>('page-a'),
          available: ref<boolean>(true),
          active: ref<boolean>(true),
          getTools: (): ToolContextTool[] => [createTestPageTool(execute)],
          hiddenToolNames: [],
          appBridgeHandlers: {}
        });
        return (): VNode => h('div');
      }
    });
    const wrapper = mount(Host);
    const chatContext = useActiveChatContext();
    const binding = { providerId: 'test-page', resourceId: 'page-a' };
    const confirm = vi.fn(async (): Promise<boolean> => true);
    const executor = chatContext.getBoundTools(binding, { confirmation: { confirm } })[0];
    if (!executor) throw new Error('test page executor should be registered');
    const descriptors = chatContext.getRendererTools(binding);

    await expect(executor.execute({})).resolves.toEqual({
      toolName: TEST_PAGE_TOOL_NAME,
      status: 'success',
      data: { title: 'Test page' }
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(chatContext.getPresentationByTool(TEST_PAGE_TOOL_NAME)?.label).toBe('检查测试页面');
    expect(descriptors).toEqual([{ name: TEST_PAGE_TOOL_NAME, history: { mode: 'latest-only', placeholder: '历史测试页面结果已裁剪。' } }]);

    const runtime: ActiveChatRuntime = {
      runtimeId: 'runtime-test-page',
      sessionId: 'session-test-page',
      turnId: 'turn-test-page',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: 'runtime-test-page',
      status: 'running',
      phase: 'streaming',
      abortController: new AbortController(),
      createdAt: 0,
      tools: [{ name: TEST_PAGE_TOOL_NAME, description: 'Inspect test page', parameters: { type: 'object', properties: {} } }]
    };
    expect(isRendererManagedTool(runtime, TEST_PAGE_TOOL_NAME)).toBe(true);

    const projected = projectRendererToolOutputs([createMessage('old', 'OLD_PAGE_STATE'), createMessage('current', 'CURRENT_PAGE_STATE')], descriptors);
    expect(JSON.stringify(projected)).not.toContain('OLD_PAGE_STATE');
    expect(JSON.stringify(projected)).toContain('CURRENT_PAGE_STATE');

    wrapper.unmount();
    await expect(executor.execute({})).resolves.toMatchObject({ status: 'failure', error: { code: 'EDITOR_UNAVAILABLE' } });
  });
});
