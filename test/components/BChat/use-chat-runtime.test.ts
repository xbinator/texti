/**
 * @file use-chat-runtime.test.ts
 * @description BChat ChatRuntime 无状态 IPC 命令适配器测试。
 * @vitest-environment jsdom
 */
import type { ChatMessageRecord } from 'types/chat';
import type {
  ChatRuntimeAddress,
  ChatRuntimeCompactInput,
  ChatRuntimeContinueInput,
  ChatRuntimeSendInput,
  ChatRuntimeSubmitUserChoiceInput
} from 'types/chat-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatRuntime } from '@/components/BChat/hooks/useChatRuntime';
import type { Message } from '@/components/BChat/utils/types';

const electronAPIMock = vi.hoisted(() => ({
  chatRuntimeSend: vi.fn(),
  chatRuntimeContinue: vi.fn(),
  chatRuntimeCompact: vi.fn(),
  chatRuntimeSubmitUserChoice: vi.fn(),
  chatRuntimeSubmitMessagePart: vi.fn(),
  chatRuntimeAbort: vi.fn()
}));

/** 每类 Runtime 命令共享的模型快照。 */
const RUNTIME_MODEL = { providerId: 'provider-1', modelId: 'model-2' };

/**
 * 创建 renderer 命令使用的完整 Runtime 地址。
 * @param runtimeId - Runtime ID
 * @returns 不含固定 Agent ID 的地址
 */
function createRuntimeAddress(runtimeId: string): Omit<ChatRuntimeAddress, 'agentId'> {
  return {
    runtimeId,
    sessionId: 'session-1',
    turnId: 'turn-1',
    rootRuntimeId: runtimeId
  };
}

vi.mock('@/shared/platform/electron-api', () => ({
  getElectronAPI: (): typeof electronAPIMock => electronAPIMock
}));

/** 创建 renderer 消息夹具。 */
function createMessage(): Message {
  return {
    id: 'user-1',
    role: 'user',
    content: 'hello',
    parts: [{ id: 'part-1', type: 'text', text: 'hello' }],
    createdAt: '2026-07-11T00:00:00.000Z',
    loading: false,
    finished: true,
    references: [
      {
        token: '@note.md',
        path: '/workspace/note.md',
        startLine: 1,
        endLine: 1,
        selectedContent: 'hello',
        fullContent: 'hello'
      }
    ]
  };
}

describe('useChatRuntime', (): void => {
  beforeEach((): void => {
    for (const command of Object.values(electronAPIMock)) command.mockReset();
    electronAPIMock.chatRuntimeSend.mockResolvedValue({ ok: true, data: { runtimeId: 'runtime-send', sessionId: 'session-1' } });
    electronAPIMock.chatRuntimeContinue.mockResolvedValue({ ok: true, data: { runtimeId: 'runtime-continue', sessionId: 'session-1' } });
    electronAPIMock.chatRuntimeCompact.mockResolvedValue({ ok: true, data: { runtimeId: 'runtime-compact', sessionId: 'session-1' } });
    electronAPIMock.chatRuntimeSubmitUserChoice.mockResolvedValue({ ok: true, data: { runtimeId: 'runtime-choice', sessionId: 'session-1' } });
    electronAPIMock.chatRuntimeSubmitMessagePart.mockResolvedValue({ ok: true });
    electronAPIMock.chatRuntimeAbort.mockResolvedValue({ ok: true, data: {} });
  });

  it('sends the renderer-allocated runtime id with stable client and agent ids', async (): Promise<void> => {
    const runtime = useChatRuntime();

    await runtime.send({ ...createRuntimeAddress('runtime-send'), content: 'hello', model: RUNTIME_MODEL });

    const [input] = electronAPIMock.chatRuntimeSend.mock.calls[0] as [ChatRuntimeSendInput];
    expect(input).toMatchObject({
      runtimeId: 'runtime-send',
      sessionId: 'session-1',
      clientId: 'bchat',
      agentId: 'primary',
      content: 'hello',
      model: RUNTIME_MODEL
    });
    expect(() => structuredClone(input)).not.toThrow();
  });

  it('converts continuation messages to cloneable runtime snapshots', async (): Promise<void> => {
    const runtime = useChatRuntime();

    await runtime.continueTurn({ ...createRuntimeAddress('runtime-continue'), messages: [createMessage()], model: RUNTIME_MODEL });

    const [input] = electronAPIMock.chatRuntimeContinue.mock.calls[0] as [ChatRuntimeContinueInput];
    expect(input.runtimeId).toBe('runtime-continue');
    expect(input.model).toEqual(RUNTIME_MODEL);
    expect(input.messages[0]).toMatchObject({ id: 'user-1', sessionId: 'session-1', content: 'hello' });
    expect('references' in input.messages[0]).toBe(false);
    expect(() => structuredClone(input)).not.toThrow();
  });

  it('submits user choices with the renderer-allocated runtime id', async (): Promise<void> => {
    const runtime = useChatRuntime();
    const answer = { questionId: 'question-1', toolCallId: 'tool-1', answers: ['yes'] };

    await runtime.submitUserChoice({ ...createRuntimeAddress('runtime-choice'), answer, model: RUNTIME_MODEL });

    const [input] = electronAPIMock.chatRuntimeSubmitUserChoice.mock.calls[0] as [ChatRuntimeSubmitUserChoiceInput];
    expect(input).toMatchObject({ runtimeId: 'runtime-choice', clientId: 'bchat', agentId: 'primary', answer, model: RUNTIME_MODEL });
  });

  it('starts manual compaction without a user message payload', async (): Promise<void> => {
    const runtime = useChatRuntime();

    await runtime.compact({
      ...createRuntimeAddress('runtime-compact'),
      contextWindow: 12_000,
      model: RUNTIME_MODEL
    });

    const [input] = electronAPIMock.chatRuntimeCompact.mock.calls[0] as [ChatRuntimeCompactInput];
    expect(input).toEqual({
      runtimeId: 'runtime-compact',
      sessionId: 'session-1',
      turnId: 'turn-1',
      rootRuntimeId: 'runtime-compact',
      contextWindow: 12_000,
      model: RUNTIME_MODEL,
      clientId: 'bchat',
      agentId: 'primary'
    });
    expect(input).not.toHaveProperty('content');
  });

  it('submits renderer message parts and aborts an explicitly addressed runtime', async (): Promise<void> => {
    const runtime = useChatRuntime();
    const part = { id: 'part-1', type: 'text' as const, text: 'updated' };
    const interruptMessage = {
      id: 'interrupt-message-1',
      sessionId: 'session-1',
      role: 'interrupt',
      content: '已中断',
      parts: [],
      createdAt: '2026-07-20T00:00:00.000Z',
      loading: false,
      finished: true
    } satisfies ChatMessageRecord;
    electronAPIMock.chatRuntimeAbort.mockResolvedValue({ ok: true, data: { interruptMessage } });

    await runtime.submitMessagePart({ runtimeId: 'runtime-1', messageId: 'assistant-1', part });
    const abortResult = await runtime.abort('runtime-1');

    expect(electronAPIMock.chatRuntimeSubmitMessagePart).toHaveBeenCalledWith({ runtimeId: 'runtime-1', messageId: 'assistant-1', part });
    expect(electronAPIMock.chatRuntimeAbort).toHaveBeenCalledWith({ runtimeId: 'runtime-1' });
    expect(abortResult).toEqual({ interruptMessage });
  });

  it('surfaces Runtime command failures', async (): Promise<void> => {
    electronAPIMock.chatRuntimeAbort.mockResolvedValue({ ok: false, code: 'ABORT_FAILED', error: 'abort failed' });
    const runtime = useChatRuntime();

    await expect(runtime.abort('runtime-1')).rejects.toThrow('abort failed');
  });
});
