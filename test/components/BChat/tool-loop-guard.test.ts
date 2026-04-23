/**
 * @file tool-loop-guard.test.ts
 * @description BChat 工具续轮防护测试
 */
import { describe, expect, it } from 'vitest';
import { createToolLoopGuard } from '@/components/BChat/utils/toolLoopGuard';

describe('BChat tool loop guard', () => {
  it('blocks follow-up rounds after the configured round limit', () => {
    const guard = createToolLoopGuard({ maxRounds: 2, maxRepeatedCalls: 2 });

    expect(guard.canContinue()).toEqual({ allowed: true });

    guard.advanceRound();
    expect(guard.canContinue()).toEqual({ allowed: true });

    guard.advanceRound();
    expect(guard.canContinue()).toEqual({
      allowed: false,
      reason: '工具调用轮次超过限制（2），已停止自动续轮。'
    });
  });

  it('blocks repeated tool calls with the same signature', () => {
    const guard = createToolLoopGuard({ maxRounds: 5, maxRepeatedCalls: 2 });

    expect(guard.recordToolCall('read_current_document', {})).toEqual({ allowed: true });
    expect(guard.recordToolCall('read_current_document', {})).toEqual({ allowed: true });
    expect(guard.recordToolCall('read_current_document', {})).toEqual({
      allowed: false,
      reason: '工具 `read_current_document` 使用相同参数重复调用超过限制（2），已停止自动续轮。'
    });
  });

  it('resets repeated call tracking when the signature changes', () => {
    const guard = createToolLoopGuard({ maxRounds: 5, maxRepeatedCalls: 1 });

    expect(guard.recordToolCall('read_current_document', {})).toEqual({ allowed: true });
    expect(guard.recordToolCall('search_current_document', { query: 'AI' })).toEqual({ allowed: true });
    expect(guard.recordToolCall('read_current_document', {})).toEqual({ allowed: true });
  });
});
