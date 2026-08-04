/**
 * @file tool-loop-policy.test.ts
 * @description AI SDK 托管工具循环重复调用收口与超时策略测试。
 */
import { describe, expect, it } from 'vitest';
import {
  AI_DIRECT_REQUEST_TIMEOUT,
  AI_LEGACY_TOOL_TIMEOUT_MS,
  AI_RUNTIME_STREAM_TIMEOUT,
  createRequestTimeout,
  createRuntimeToolLoopTimeout,
  getLoopStopReason
} from '../../../../../electron/main/modules/ai/tool-loop-policy.mjs';

describe('tool loop policy', (): void => {
  it('does not impose a step limit while tools continue making progress', (): void => {
    const progressiveSteps = Array.from({ length: 12 }, (_value: unknown, index: number) => ({
      toolCalls: [{ toolName: 'read', input: { path: `src/file-${index}.ts` } }]
    }));

    expect(getLoopStopReason(progressiveSteps)).toBeUndefined();
  });

  it('finalizes after consecutive equivalent tool calls', (): void => {
    expect(
      getLoopStopReason([
        { toolCalls: [{ toolName: 'search', input: { query: 'AI SDK 7', limit: 5 } }] },
        { toolCalls: [{ toolName: 'search', input: { limit: 5, query: 'AI SDK 7' } }] }
      ])
    ).toBe('repeated-tool-call');
  });

  it('keeps running when adjacent batches only partially overlap', (): void => {
    expect(
      getLoopStopReason([
        {
          toolCalls: [
            { toolName: 'read', input: { path: 'a.ts' } },
            { toolName: 'read', input: { path: 'b.ts' } }
          ]
        },
        {
          toolCalls: [
            { toolName: 'read', input: { path: 'a.ts' } },
            { toolName: 'read', input: { path: 'c.ts' } }
          ]
        }
      ])
    ).toBeUndefined();
  });

  it('treats reordered equivalent batches as repeated', (): void => {
    expect(
      getLoopStopReason([
        {
          toolCalls: [
            { toolName: 'read', input: { path: 'a.ts' } },
            { toolName: 'search', input: { query: 'sdk' } }
          ]
        },
        {
          toolCalls: [
            { toolName: 'search', input: { query: 'sdk' } },
            { toolName: 'read', input: { path: 'a.ts' } }
          ]
        }
      ])
    ).toBe('repeated-tool-call');
  });

  it('uses the fixed internal timeout policy', (): void => {
    expect(AI_DIRECT_REQUEST_TIMEOUT).toEqual({
      totalMs: 300_000,
      chunkMs: 90_000,
      toolMs: 60_000
    });
  });

  it('uses one fixed protection for every direct SDK call', (): void => {
    expect(createRequestTimeout()).toEqual(AI_DIRECT_REQUEST_TIMEOUT);
  });

  it('omits SDK total timeout when ChatRuntime owns the tool loop', (): void => {
    expect(AI_RUNTIME_STREAM_TIMEOUT).toEqual({ chunkMs: 90_000 });
    expect(AI_LEGACY_TOOL_TIMEOUT_MS).toBe(60_000);
    expect(createRuntimeToolLoopTimeout()).toEqual(AI_RUNTIME_STREAM_TIMEOUT);
    expect(createRuntimeToolLoopTimeout()).not.toHaveProperty('totalMs');
    expect(createRuntimeToolLoopTimeout()).not.toHaveProperty('toolMs');
  });
});
