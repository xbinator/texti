/**
 * @file webview-tool-input.test.ts
 * @description WebView 当前页面操作输入归一化测试。
 */
import type { RuntimeWebpageOperateInput } from '../../../../../../electron/main/modules/chat/runtime/tools/types.mjs';
import { describe, expect, it } from 'vitest';
import { normalizeWebpageInput } from '../../../../../../electron/main/modules/chat/runtime/tools/WebviewTool/input.mjs';

describe('WebView tool input normalization', (): void => {
  it('accepts every supported action and removes history-only fields', (): void => {
    const inputs: unknown[] = [
      { snapshotId: 'snap-1', step: { memory: 'fact' }, action: { type: 'click', index: 1, unknown: 'drop' } },
      { snapshotId: 'snap-1', step: {}, action: { type: 'input', index: 1, text: 'hello', clear: false } },
      { snapshotId: 'snap-1', step: {}, action: { type: 'select', index: 1, optionText: 'A' } },
      { snapshotId: 'snap-1', step: {}, action: { type: 'press', index: 1, key: 'Enter' } },
      { snapshotId: 'snap-1', step: {}, action: { type: 'scroll', index: 1, direction: 'down', pixels: 200 } },
      { step: {}, action: { type: 'navigate', url: 'https://example.com' } },
      { snapshotId: 'snap-1', step: {}, action: { type: 'wait', seconds: 1 } }
    ];

    const normalized = inputs.map((input): RuntimeWebpageOperateInput | undefined => normalizeWebpageInput(input));

    expect(normalized.every(Boolean)).toBe(true);
    expect(JSON.stringify(normalized)).not.toContain('memory');
    expect(JSON.stringify(normalized)).not.toContain('unknown');
    expect(normalized[5]).toEqual({ action: { type: 'navigate', url: 'https://example.com' } });
  });

  it('rejects invalid required fields and invalid provided optional fields', (): void => {
    const invalidInputs: unknown[] = [
      { action: { type: 'click', index: 1 } },
      { snapshotId: 'snap-1', action: { type: 'click', index: Number.NaN } },
      { snapshotId: 'snap-1', action: { type: 'click', index: -1 } },
      { snapshotId: 'snap-1', action: { type: 'click', index: 1.5 } },
      { snapshotId: 'snap-1', action: { type: 'click', index: Number.MAX_SAFE_INTEGER + 1 } },
      { snapshotId: 'snap-1', action: { type: 'input', index: 1, text: 'ok', clear: 'yes' } },
      { snapshotId: 'snap-1', action: { type: 'scroll', direction: 'down', pixels: 50_000 } },
      { snapshotId: 'snap-1', action: { type: 'scroll', direction: 'down', index: Number.POSITIVE_INFINITY } },
      { snapshotId: 'snap-1', action: { type: 'wait', seconds: 10 } },
      { snapshotId: 'snap-1', action: { type: 'press', index: 1, key: 'Space' } },
      { action: { type: 'navigate', url: '' } }
    ];

    expect(invalidInputs.map((input): RuntimeWebpageOperateInput | undefined => normalizeWebpageInput(input))).toEqual(
      invalidInputs.map((): undefined => undefined)
    );
  });
});
