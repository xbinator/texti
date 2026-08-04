/**
 * @file finalizer.test.ts
 * @description ChatRuntime assistant 工具终态与活动快照一致性测试。
 */
import type { ChatMessageRecord } from 'types/chat';
import { describe, expect, it } from 'vitest';
import { AI_ERROR_CODE, createAIServiceError } from '../../../../../../../electron/main/modules/ai/errors/codes.mjs';
import { finishAssistantMessageInterrupted, markAssistantMessageFailed } from '../../../../../../../electron/main/modules/chat/runtime/messages/finalizer.mjs';

/**
 * 创建带在途活动快照的 assistant 消息。
 * @returns 测试消息
 */
function createActiveToolMessage(): ChatMessageRecord {
  return {
    id: 'assistant-active-tool',
    sessionId: 'session-active-tool',
    role: 'assistant',
    content: '',
    parts: [
      {
        id: 'tool-part-active',
        type: 'tool',
        toolCallId: 'tool-active',
        toolName: 'grep',
        status: 'executing',
        input: { pattern: 'needle' },
        activity: { state: 'running_idle', sequence: 3 }
      }
    ],
    loading: false,
    finished: false,
    createdAt: '2026-08-04T00:00:00.000Z'
  };
}

describe('runtime message finalizer', (): void => {
  it('removes stale activity when a pending tool is cancelled', (): void => {
    const message = createActiveToolMessage();

    finishAssistantMessageInterrupted(message);

    expect(message.parts[0]).toMatchObject({ type: 'tool', status: 'done', result: { status: 'cancelled' } });
    expect(message.parts[0]).not.toHaveProperty('activity');
  });

  it('removes stale activity when a pending tool fails with the runtime', (): void => {
    const message = createActiveToolMessage();

    markAssistantMessageFailed(message, createAIServiceError(AI_ERROR_CODE.REQUEST_FAILED, '模型流失败'));

    expect(message.parts[0]).toMatchObject({ type: 'tool', status: 'done', result: { status: 'failure' } });
    expect(message.parts[0]).not.toHaveProperty('activity');
  });
});
