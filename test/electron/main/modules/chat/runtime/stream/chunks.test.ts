/**
 * @file chunks.test.ts
 * @description AI SDK 7 完整流事件到 Chat Runtime 事件的规范化测试。
 */
import type { TextStreamPart, ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';
import { toRuntimeStreamChunk } from '../../../../../../../electron/main/modules/chat/runtime/stream/chunks.mjs';

describe('runtime stream chunks', (): void => {
  it('maps v7 incremental tool input fields to runtime names', (): void => {
    const start = { type: 'tool-input-start', id: 'call-1', toolName: 'search' } satisfies TextStreamPart<ToolSet>;
    const delta = { type: 'tool-input-delta', id: 'call-1', delta: '{"query":"AI SDK 7"}' } satisfies TextStreamPart<ToolSet>;
    const end = { type: 'tool-input-end', id: 'call-1' } satisfies TextStreamPart<ToolSet>;

    expect(toRuntimeStreamChunk(start)).toEqual({ type: 'tool-input-start', toolCallId: 'call-1', toolName: 'search' });
    expect(toRuntimeStreamChunk(delta)).toEqual({ type: 'tool-input-delta', toolCallId: 'call-1', inputTextDelta: '{"query":"AI SDK 7"}' });
    expect(toRuntimeStreamChunk(end)).toEqual({ type: 'tool-input-end', toolCallId: 'call-1' });
  });

  it.each([
    ['null', null],
    ['false', false],
    ['zero', 0],
    ['empty string', '']
  ])('preserves defined falsey Provider metadata: %s', (_label: string, providerMetadata: unknown): void => {
    const start = {
      type: 'tool-input-start',
      id: 'call-start',
      toolName: 'search',
      providerMetadata
    } as unknown as TextStreamPart<ToolSet>;
    const call = {
      type: 'tool-call',
      toolCallId: 'call-complete',
      toolName: 'search',
      input: {},
      providerMetadata
    } as unknown as TextStreamPart<ToolSet>;

    expect(toRuntimeStreamChunk(start)).toEqual({
      type: 'tool-input-start',
      toolCallId: 'call-start',
      toolName: 'search',
      providerMetadata
    });
    expect(toRuntimeStreamChunk(call)).toEqual({
      type: 'tool-call',
      toolCallId: 'call-complete',
      toolName: 'search',
      input: {},
      providerMetadata
    });
  });

  it('maps v7 tool output without a legacy result fallback', (): void => {
    const toolResult = {
      type: 'tool-result',
      toolCallId: 'call-1',
      toolName: 'search',
      input: { query: 'AI SDK 7' },
      output: { matches: 3 },
      dynamic: true
    } satisfies TextStreamPart<ToolSet>;

    expect(toRuntimeStreamChunk(toolResult)).toEqual({
      type: 'tool-result',
      toolCallId: 'call-1',
      toolName: 'search',
      result: { toolName: 'search', status: 'success', data: { matches: 3 } }
    });
  });

  it('keeps step and total usage as separate events', (): void => {
    const stepUsage = {
      inputTokens: 2,
      inputTokenDetails: { noCacheTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokens: 3,
      outputTokenDetails: { textTokens: 3, reasoningTokens: 0 },
      totalTokens: 5
    };
    const totalUsage = {
      inputTokens: 7,
      inputTokenDetails: { noCacheTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokens: 4,
      outputTokenDetails: { textTokens: 4, reasoningTokens: 0 },
      totalTokens: 11
    };
    const finishStep = {
      type: 'finish-step',
      usage: stepUsage
    } as TextStreamPart<ToolSet>;
    const finish = {
      type: 'finish',
      finishReason: 'stop',
      rawFinishReason: undefined,
      totalUsage
    } satisfies TextStreamPart<ToolSet>;

    expect(toRuntimeStreamChunk(finishStep)).toEqual({
      type: 'finish-step',
      stepUsage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }
    });
    expect(toRuntimeStreamChunk(finish)).toEqual({
      type: 'finish',
      finishReason: 'stop',
      totalUsage: { inputTokens: 7, outputTokens: 4, totalTokens: 11 }
    });
  });

  it('maps SDK tool errors and denied output to stable tool failures', (): void => {
    const toolError = {
      type: 'tool-error',
      toolCallId: 'call-error',
      toolName: 'search',
      input: { query: 'AI SDK 7' },
      error: new Error('provider tool failed'),
      dynamic: true
    } satisfies TextStreamPart<ToolSet>;
    const denied = {
      type: 'tool-output-denied',
      toolCallId: 'call-denied',
      toolName: 'search'
    } as TextStreamPart<ToolSet>;

    expect(toRuntimeStreamChunk(toolError)).toEqual({
      type: 'tool-result',
      toolCallId: 'call-error',
      toolName: 'search',
      result: {
        toolName: 'search',
        status: 'failure',
        error: { code: 'EXECUTION_FAILED', message: 'provider tool failed' }
      }
    });
    expect(toRuntimeStreamChunk(denied)).toEqual({
      type: 'tool-result',
      toolCallId: 'call-denied',
      toolName: 'search',
      result: {
        toolName: 'search',
        status: 'failure',
        error: { code: 'PERMISSION_DENIED', message: '工具 search 的执行未获批准' }
      }
    });
  });

  it('surfaces aborts and non-automatic approval requests', (): void => {
    const abort = { type: 'abort', reason: 'deadline reached' } satisfies TextStreamPart<ToolSet>;
    const approval = {
      type: 'tool-approval-request',
      approvalId: 'approval-1',
      toolCall: {
        type: 'tool-call',
        toolCallId: 'call-approval',
        toolName: 'write_file',
        input: { path: 'README.md' },
        dynamic: true
      }
    } satisfies TextStreamPart<ToolSet>;

    expect(toRuntimeStreamChunk(abort)).toEqual({ type: 'abort', reason: 'deadline reached' });
    expect(toRuntimeStreamChunk(approval)).toMatchObject({ type: 'error', error: expect.any(Error) });
  });

  it('keeps explicitly unsupported v7 file events visible at the boundary', (): void => {
    const reasoningFile = { type: 'reasoning-file', file: {} } as TextStreamPart<ToolSet>;
    expect(toRuntimeStreamChunk(reasoningFile)).toEqual({ type: 'unsupported', sourceType: 'reasoning-file' });
  });
});
