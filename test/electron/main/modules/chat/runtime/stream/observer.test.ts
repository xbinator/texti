/**
 * @file observer.test.ts
 * @description ChatRuntime Provider 流观察器边界测试。
 */
import type { AssistantProjection } from '../../../../../../../electron/main/modules/chat/runtime/stream/projection.mjs';
import type { ActiveChatRuntime } from '../../../../../../../electron/main/modules/chat/runtime/types.mjs';
import type { AIStreamResult } from 'types/ai';
import type { ChatMessageRecord } from 'types/chat';
import { describe, expect, it, vi } from 'vitest';
import { observeRuntimeStream } from '../../../../../../../electron/main/modules/chat/runtime/stream/observer.mjs';

/**
 * 创建测试 Runtime。
 * @returns 可消费 Provider 流的 Runtime
 */
function createRuntime(): ActiveChatRuntime {
  return {
    runtimeId: 'runtime-observer',
    sessionId: 'session-observer',
    turnId: 'turn-observer',
    clientId: 'client-observer',
    agentId: 'agent-observer',
    rootRuntimeId: 'runtime-observer',
    status: 'running',
    phase: 'streaming',
    abortController: new AbortController(),
    createdAt: 0,
    currentToolStep: { toolCalls: [] }
  };
}

/**
 * 创建工作 Assistant 消息。
 * @returns 空的 Assistant 消息
 */
function createMessage(): ChatMessageRecord {
  return {
    id: 'assistant-observer',
    sessionId: 'session-observer',
    role: 'assistant',
    content: '',
    parts: [],
    createdAt: '2026-08-10T00:00:00.000Z',
    loading: true,
    finished: false
  };
}

/**
 * 将测试 chunk 序列转换为 AI stream。
 * @param chunks - SDK 兼容的测试 chunk
 * @returns 异步 chunk 流
 */
function createStream(chunks: readonly unknown[]): AIStreamResult['stream'] {
  async function* iterate(): AsyncGenerator<unknown> {
    for (const chunk of chunks) yield chunk;
  }

  return iterate() as unknown as AIStreamResult['stream'];
}

/**
 * 创建只记录调用的 Assistant 投影器。
 * @returns 投影器与追加观察函数
 */
function createProjection(): { projection: AssistantProjection; append: ReturnType<typeof vi.fn> } {
  const append = vi.fn();
  return {
    append,
    projection: {
      append,
      mark: vi.fn(),
      checkpoint: vi.fn(async (): Promise<void> => undefined),
      flush: vi.fn(async (): Promise<void> => undefined),
      cancel: vi.fn(async (): Promise<void> => undefined),
      revision: vi.fn((): number => 0)
    }
  };
}

describe('runtime stream observer', (): void => {
  it('projects chunks and returns complete tool facts without late text after a stop result', async (): Promise<void> => {
    const runtime = createRuntime();
    const assistantMessage = createMessage();
    const { projection, append } = createProjection();
    const persistAssistant = vi.fn(async (): Promise<void> => undefined);
    const input = { path: 'CONTEXT.md' };
    const stream = createStream([
      { type: 'text-delta', id: 'text-1', text: 'hello' },
      { type: 'tool-input-start', id: 'call-1', toolName: 'read_file' },
      { type: 'tool-input-delta', id: 'call-1', delta: JSON.stringify(input) },
      { type: 'tool-input-end', id: 'call-1' },
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'read_file', input },
      {
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'read_file',
        output: {
          toolName: 'read_file',
          status: 'cancelled',
          error: { code: 'USER_CANCELLED', message: '用户取消了工具调用' }
        }
      },
      { type: 'text-delta', id: 'text-1', text: 'late-secret' },
      { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } }
    ]);

    const observation = await observeRuntimeStream({
      runtime,
      stream,
      assistantMessage,
      projection,
      forceFinal: false,
      deferredToolCallIds: new Set<string>(),
      persistAssistant,
      applyPendingActivity: vi.fn()
    });

    expect(assistantMessage.content).toBe('hello');
    expect(assistantMessage.content).not.toContain('late-secret');
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ kind: 'append-text', text: 'hello' }));
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ kind: 'append-tool-input', toolCallId: 'call-1' }));
    expect(persistAssistant).toHaveBeenCalledTimes(3);
    expect(observation.stoppedToolCallId).toBe('call-1');
    expect(observation.finishReason).toBe('tool-calls');
    expect(observation.totalUsage).toEqual(expect.objectContaining({ inputTokens: 4, outputTokens: 2, totalTokens: 6 }));
    expect(observation.observedTools.get('call-1')).toEqual(
      expect.objectContaining({
        startNames: ['read_file'],
        calls: [expect.objectContaining({ toolName: 'read_file', input })],
        resultNames: ['read_file'],
        results: [expect.objectContaining({ toolName: 'read_file' })]
      })
    );
    expect(runtime.currentToolStep?.toolCalls).toEqual([{ toolName: 'read_file', input }]);
  });
});
