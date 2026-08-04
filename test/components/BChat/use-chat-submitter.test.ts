/**
 * @file use-chat-submitter.test.ts
 * @description BChat 统一提交器测试。
 */
import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useChatSubmitter } from '@/components/BChat/hooks/useChatSubmitter';
import { createUserChoice, type AdaptedUserMessageInput, type MessagePartUpdateInput, type SubmitAction } from '@/components/BChat/utils/submitAction';
import type { Message } from '@/components/BChat/utils/types';

/**
 * 创建已适配好的用户消息输入。
 * @returns 用户消息输入
 */
function createAdaptedUserMessageInput(): AdaptedUserMessageInput {
  return {
    userMessage: {
      id: 'user-widget-message',
      role: 'user',
      content: '确认下单',
      parts: [{ id: 'part-user-text', type: 'text', text: '确认下单' }],
      createdAt: '2026-07-06T00:00:00.000Z',
      finished: true
    },
    parts: [{ id: 'part-user-text', type: 'text', text: '确认下单' }]
  };
}

/**
 * 创建发送已适配用户消息的提交动作。
 * @param input - 用户消息输入
 * @returns 提交动作
 */
function createSendAdaptedUserMessageAction(input: AdaptedUserMessageInput): SubmitAction {
  return {
    async run(context): Promise<void> {
      await context.sendAdaptedUserMessage(input);
    }
  };
}

/**
 * 创建消息 part 更新提交动作。
 * @param input - 消息 part 更新输入
 * @returns 提交动作
 */
function createMessagePartUpdateAction(input: MessagePartUpdateInput): SubmitAction {
  return {
    async run(context): Promise<void> {
      await context.updateMessagePart(input);
    }
  };
}

describe('useChatSubmitter', (): void => {
  it('shares one in-flight user-choice submission across duplicate actions', async (): Promise<void> => {
    const order: string[] = [];
    let resolveSubmission: ((result: { runtimeId: string; sessionId: string }) => void) | undefined;
    const submission = new Promise<{ runtimeId: string; sessionId: string }>((resolve) => {
      resolveSubmission = resolve;
    });
    const submitUserChoice = vi.fn(() => {
      order.push('runtime-choice');
      return submission;
    });
    const startRuntime = vi.fn(() => {
      order.push('start-runtime');
      return {
        runtimeId: 'runtime-choice',
        sessionId: 'session-1',
        turnId: 'turn-1',
        agentId: 'primary',
        rootRuntimeId: 'runtime-choice'
      };
    });
    const ensureSessionModel = vi.fn(async (): Promise<void> => {
      order.push('persist-model');
    });
    const submitter = useChatSubmitter({
      isWorkflowBusy: () => true,
      messages: ref<Message[]>([]),
      getSessionId: () => 'session-1',
      getActiveRuntimeId: () => 'runtime-question',
      resolveRuntimeRequestConfig: vi.fn(),
      prepareRuntimeRequest: vi.fn().mockResolvedValue({
        config: {
          model: { providerId: 'provider-1', modelId: 'model-2' },
          contextWindow: 12_000
        },
        rendererTools: [],
        editMemoryExposed: false
      }),
      ensureSessionModel,
      startRuntime,
      submitUserChoice,
      controlRuntimeTool: vi.fn(),
      sendRuntimeUserMessage: vi.fn(),
      submitRuntimeMessagePart: vi.fn(),
      updateSessionMessage: vi.fn()
    });
    const action = createUserChoice({ questionId: 'question-1', toolCallId: 'tool-call-question', answers: ['yes'] });

    const firstSubmission = submitter.submit(action);
    const duplicateSubmission = submitter.submit(action);
    await Promise.resolve();
    await Promise.resolve();

    expect(startRuntime).toHaveBeenCalledTimes(1);
    expect(ensureSessionModel).toHaveBeenCalledWith('session-1', { providerId: 'provider-1', modelId: 'model-2' });
    expect(order).toEqual(['persist-model', 'start-runtime', 'runtime-choice']);
    expect(submitUserChoice).toHaveBeenCalledTimes(1);
    expect(submitUserChoice).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeId: 'runtime-choice',
        sessionId: 'session-1',
        model: { providerId: 'provider-1', modelId: 'model-2' }
      })
    );

    resolveSubmission?.({ runtimeId: 'runtime-choice', sessionId: 'session-1' });
    await Promise.all([firstSubmission, duplicateSubmission]);
  });

  it('does not start a user-choice runtime when model persistence fails', async (): Promise<void> => {
    const startRuntime = vi.fn(() => ({
      runtimeId: 'runtime-choice',
      sessionId: 'session-1',
      turnId: 'turn-1',
      agentId: 'primary',
      rootRuntimeId: 'runtime-choice'
    }));
    const submitUserChoice = vi.fn();
    const submitter = useChatSubmitter({
      isWorkflowBusy: () => true,
      messages: ref<Message[]>([]),
      getSessionId: () => 'session-1',
      getActiveRuntimeId: () => 'runtime-question',
      resolveRuntimeRequestConfig: vi.fn(),
      prepareRuntimeRequest: vi.fn().mockResolvedValue({
        config: {
          model: { providerId: 'provider-1', modelId: 'model-2' },
          contextWindow: 12_000
        },
        rendererTools: [],
        editMemoryExposed: false
      }),
      ensureSessionModel: vi.fn().mockRejectedValue(new Error('metadata failed')),
      startRuntime,
      submitUserChoice,
      controlRuntimeTool: vi.fn(),
      sendRuntimeUserMessage: vi.fn(),
      submitRuntimeMessagePart: vi.fn(),
      updateSessionMessage: vi.fn()
    });
    const action = createUserChoice({ questionId: 'question-1', toolCallId: 'tool-call-question', answers: ['yes'] });

    await expect(submitter.submit(action)).rejects.toThrow('metadata failed');

    expect(startRuntime).not.toHaveBeenCalled();
    expect(submitUserChoice).not.toHaveBeenCalled();
  });

  it('sends adapted user messages while the Session workflow accepts input', async (): Promise<void> => {
    const sendRuntimeUserMessage = vi.fn<(_input: AdaptedUserMessageInput) => Promise<void>>(() => Promise.resolve());
    const input = createAdaptedUserMessageInput();
    const submitter = useChatSubmitter({
      isWorkflowBusy: () => false,
      messages: ref<Message[]>([]),
      getSessionId: () => 'session-1',
      getActiveRuntimeId: () => undefined,
      resolveRuntimeRequestConfig: vi.fn(),
      ensureSessionModel: vi.fn(),
      submitUserChoice: vi.fn(),
      controlRuntimeTool: vi.fn(),
      sendRuntimeUserMessage,
      submitRuntimeMessagePart: vi.fn(),
      updateSessionMessage: vi.fn()
    });

    await submitter.submit(createSendAdaptedUserMessageAction(input));

    expect(sendRuntimeUserMessage).toHaveBeenCalledWith(input);
  });

  it('does not send adapted user messages while the Session workflow is busy', async (): Promise<void> => {
    const sendRuntimeUserMessage = vi.fn<(_input: AdaptedUserMessageInput) => Promise<void>>(() => Promise.resolve());
    const input = createAdaptedUserMessageInput();
    const submitter = useChatSubmitter({
      isWorkflowBusy: () => true,
      messages: ref<Message[]>([]),
      getSessionId: () => 'session-1',
      getActiveRuntimeId: () => undefined,
      resolveRuntimeRequestConfig: vi.fn(),
      ensureSessionModel: vi.fn(),
      submitUserChoice: vi.fn(),
      controlRuntimeTool: vi.fn(),
      sendRuntimeUserMessage,
      submitRuntimeMessagePart: vi.fn(),
      updateSessionMessage: vi.fn()
    });

    await submitter.submit(createSendAdaptedUserMessageAction(input));

    expect(sendRuntimeUserMessage).not.toHaveBeenCalled();
  });

  it('submits message part updates to the active runtime when a chat turn is running', async (): Promise<void> => {
    const messages = ref<Message[]>([
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        parts: [
          {
            id: 'part-open-widget',
            type: 'tool',
            toolCallId: 'tool-call-widget',
            toolName: 'open_widget',
            status: 'done',
            input: { id: 'weather' }
          }
        ],
        createdAt: '2026-07-06T00:00:00.000Z'
      }
    ]);
    const submitRuntimeMessagePart = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const updateSessionMessage = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const submitter = useChatSubmitter({
      isWorkflowBusy: () => true,
      messages,
      getSessionId: () => 'session-1',
      getActiveRuntimeId: () => 'runtime-1',
      resolveRuntimeRequestConfig: vi.fn(),
      ensureSessionModel: vi.fn(),
      submitUserChoice: vi.fn(),
      controlRuntimeTool: vi.fn(),
      sendRuntimeUserMessage: vi.fn(),
      submitRuntimeMessagePart,
      updateSessionMessage
    });

    await submitter.submit(
      createMessagePartUpdateAction({
        messageId: 'assistant-1',
        part: {
          id: 'part-open-widget',
          type: 'tool',
          toolCallId: 'tool-call-widget',
          toolName: 'open_widget',
          status: 'done',
          input: { id: 'weather' },
          result: { toolName: 'open_widget', status: 'success', data: { ok: true } }
        }
      })
    );

    expect(submitRuntimeMessagePart).toHaveBeenCalledWith({
      runtimeId: 'runtime-1',
      messageId: 'assistant-1',
      part: expect.objectContaining({
        id: 'part-open-widget',
        result: { toolName: 'open_widget', status: 'success', data: { ok: true } }
      })
    });
    expect(updateSessionMessage).not.toHaveBeenCalled();
  });
});
