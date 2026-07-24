/**
 * @file language-workers.test.ts
 * @description 验证 BMonaco 为语言服务选择正确的 Monaco worker。
 */

import { describe, expect, it } from 'vitest';
import { resolveMonacoWorkerKind } from '@/components/BMonaco/utils/createMonaco';

describe('BMonaco language workers', (): void => {
  it('routes CSS-family languages to the CSS worker', (): void => {
    expect(resolveMonacoWorkerKind('css')).toBe('css');
    expect(resolveMonacoWorkerKind('less')).toBe('css');
    expect(resolveMonacoWorkerKind('scss')).toBe('css');
  });

  it('routes HTML-family languages to the HTML worker', (): void => {
    expect(resolveMonacoWorkerKind('html')).toBe('html');
    expect(resolveMonacoWorkerKind('handlebars')).toBe('html');
    expect(resolveMonacoWorkerKind('razor')).toBe('html');
  });

  it('keeps existing JSON, TypeScript and fallback worker routing', (): void => {
    expect(resolveMonacoWorkerKind('json')).toBe('json');
    expect(resolveMonacoWorkerKind('typescript')).toBe('typescript');
    expect(resolveMonacoWorkerKind('javascript')).toBe('typescript');
    expect(resolveMonacoWorkerKind('plaintext')).toBe('editor');
  });
});
