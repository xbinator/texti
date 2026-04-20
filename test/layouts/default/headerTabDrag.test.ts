/**
 * @file headerTabDrag.test.ts
 * @description 验证顶部标签拖拽插入位置与边缘自动滚动计算。
 */

import { describe, expect, it } from 'vitest';
import { getHeaderTabAutoScrollDelta, getHeaderTabDropSlot, getHeaderTabMovePosition } from '@/layouts/default/components/headerTabDrag';

describe('headerTabDrag', () => {
  it('uses the target midpoint to decide whether a dragged tab inserts before or after', () => {
    const rect = { left: 100, width: 80 };

    expect(getHeaderTabMovePosition(120, rect)).toBe('before');
    expect(getHeaderTabMovePosition(160, rect)).toBe('after');
  });

  it('returns zero auto-scroll delta when pointer is outside the edge zones', () => {
    const rect = { left: 100, right: 500 };

    expect(getHeaderTabAutoScrollDelta(250, rect)).toBe(0);
  });

  it('returns negative auto-scroll delta near the left edge and positive delta near the right edge', () => {
    const rect = { left: 100, right: 500 };

    expect(getHeaderTabAutoScrollDelta(110, rect)).toBeLessThan(0);
    expect(getHeaderTabAutoScrollDelta(490, rect)).toBeGreaterThan(0);
  });

  it('canonicalizes the gap between two tabs to the next tab before slot', () => {
    const tabRects = [
      { id: 'alpha', left: 100, width: 80 },
      { id: 'beta', left: 184, width: 80 },
      { id: 'gamma', left: 268, width: 80 }
    ];

    expect(getHeaderTabDropSlot(182, tabRects, 'gamma')).toEqual({
      targetId: 'beta',
      position: 'before'
    });
    expect(getHeaderTabDropSlot(186, tabRects, 'gamma')).toEqual({
      targetId: 'beta',
      position: 'before'
    });
  });

  it('uses the last remaining tab after slot when dragging beyond the final center', () => {
    const tabRects = [
      { id: 'alpha', left: 100, width: 80 },
      { id: 'beta', left: 184, width: 80 },
      { id: 'gamma', left: 268, width: 80 }
    ];

    expect(getHeaderTabDropSlot(260, tabRects, 'gamma')).toEqual({
      targetId: 'beta',
      position: 'after'
    });
  });
});
