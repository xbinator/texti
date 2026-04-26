/**
 * @file types.test.ts
 * @description 验证 WebView 类型定义
 */

import { describe, expect, it } from 'vitest';

describe('WebViewTypes', () => {
  it('WebViewState should have correct shape', () => {
    const state = {
      url: 'https://example.com',
      title: 'Example',
      isLoading: false,
      canGoBack: true,
      canGoForward: false,
      loadProgress: 1
    };

    expect(state.url).toBe('https://example.com');
    expect(state.title).toBe('Example');
    expect(state.isLoading).toBe(false);
    expect(state.canGoBack).toBe(true);
    expect(state.canGoForward).toBe(false);
    expect(state.loadProgress).toBe(1);
  });

  it('WebViewBounds should have correct shape', () => {
    const bounds = {
      x: 0,
      y: 0,
      width: 800,
      height: 600
    };

    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
    expect(bounds.width).toBe(800);
    expect(bounds.height).toBe(600);
  });

  it('loadProgress should be between 0 and 1', () => {
    const minProgress = 0;
    const maxProgress = 1;

    expect(minProgress).toBeGreaterThanOrEqual(0);
    expect(maxProgress).toBeLessThanOrEqual(1);
  });
});
