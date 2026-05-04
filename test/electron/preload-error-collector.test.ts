/**
 * @file preload-error-collector.test.ts
 * @description 验证 Preload 层错误收集器的错误过滤与格式化行为。
 */
import { describe, expect, it } from 'vitest';

describe('preload-error-collector', () => {
  it('ignores ResizeObserver noise', async () => {
    const { shouldIgnorePreloadError } = await import('../../electron/preload/error-collector.mjs');

    const error = new Error('ResizeObserver loop completed with undelivered notifications.');

    expect(shouldIgnorePreloadError(error)).toBe(true);
  });

  it('formats standard errors without duplicating the Error prefix', async () => {
    const { formatPreloadErrorMessage } = await import('../../electron/preload/error-collector.mjs');

    const error = new Error('Something went wrong');
    const message = formatPreloadErrorMessage(error, {
      source: 'index.mjs',
      lineno: 12,
      colno: 8,
      type: 'preload.onerror'
    });

    expect(message).toContain('Error: Something went wrong');
    expect(message).not.toContain('Error: Error: Something went wrong');
    expect(message).toContain('Stack: Error: Something went wrong');
    expect(message).toContain('"type":"preload.onerror"');
  });

  it('formats non-standard errors with their custom name', async () => {
    const { formatPreloadErrorMessage } = await import('../../electron/preload/error-collector.mjs');

    const error = new TypeError('Bad input');
    const message = formatPreloadErrorMessage(error);

    expect(message).toContain('TypeError: Bad input');
    expect(message).toContain('Stack: TypeError: Bad input');
  });
});
