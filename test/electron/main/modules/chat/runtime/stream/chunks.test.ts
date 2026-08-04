/**
 * @file chunks.test.ts
 * @description ChatRuntime 工具结果 chunk 的运行时判别测试。
 */
import { describe, expect, it } from 'vitest';
import { normalizeToolResult } from '../../../../../../../electron/main/modules/chat/runtime/stream/chunks.mjs';

describe('runtime stream chunk normalization', (): void => {
  it('keeps a strict result only when its identity and discriminated shape are valid', (): void => {
    const valid = normalizeToolResult('safe_tool', {
      toolName: 'safe_tool',
      status: 'failure',
      error: { code: 'TOOL_UNRESPONSIVE', message: 'no activity' }
    });

    expect(valid).toEqual({
      toolName: 'safe_tool',
      status: 'failure',
      error: { code: 'TOOL_UNRESPONSIVE', message: 'no activity' }
    });
  });

  it('wraps malformed structured-looking output as ordinary success data', (): void => {
    const malformed = { toolName: 'other_tool', status: 'cancelled', error: { code: 'USER_CANCELLED' } };

    expect(normalizeToolResult('safe_tool', malformed)).toEqual({
      toolName: 'safe_tool',
      status: 'success',
      data: malformed
    });
  });
});
