/**
 * @file chat-tool-result.test.ts
 * @description WebView 页面工具结果校验与敏感瞬时引用清洗测试。
 */
import { describe, expect, it } from 'vitest';
import { isWebpageResult, sanitizeWebpageError, sanitizeWebpageResult } from '@/views/webview/web/hooks/chatToolResult';

describe('WebView chat tool result', (): void => {
  it('accepts a complete operation result and keeps only safe fields', (): void => {
    const result = {
      ok: true,
      action: 'click',
      target: { index: 2, label: '[2] <button>购买</button>', tagName: 'BUTTON', selector: '#buy' },
      message: 'clicked webview-snapshot-secret [2] <button>购买</button>',
      navigationStarted: false,
      pageChanged: true,
      shouldReadAgain: true,
      rawDom: '<main>secret</main>'
    };

    expect(isWebpageResult(result)).toBe(true);
    expect(sanitizeWebpageResult(result)).toEqual({
      ok: true,
      action: 'click',
      target: { index: 2, label: '购买', tagName: 'BUTTON' },
      message: 'clicked 购买',
      navigationStarted: false,
      pageChanged: true,
      shouldReadAgain: true
    });
  });

  it('rejects incomplete operation results', (): void => {
    expect(isWebpageResult({ ok: true, action: 'click' })).toBe(false);
  });

  it('preserves only a stable code and sanitized error message', (): void => {
    expect(
      sanitizeWebpageError({
        code: 'STALE_SNAPSHOT',
        message: 'webview-snapshot-secret [3] <div>网页快照已过期</div>',
        details: { dom: '<main>secret</main>' }
      })
    ).toEqual({ code: 'STALE_SNAPSHOT', message: '网页快照已过期' });
  });
});
