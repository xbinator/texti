/**
 * @file message-safety.test.ts
 * @description BMessage Markdown 复杂度与体积安全扫描测试。
 */
import { describe, expect, it } from 'vitest';
import { inspectMessageSafety } from '@/components/BMessage/utils/messageSafety';

describe('message markdown safety inspection', (): void => {
  it.each([
    ['nested blockquotes', `${'> '.repeat(4_000)}content`],
    ['nested lists', `${'- '.repeat(4_000)}content`],
    ['mixed containers', `${'> - '.repeat(4_000)}content`]
  ])('downgrades $0 before invoking a Markdown parser', (_label: string, content: string): void => {
    expect(inspectMessageSafety(content)).toEqual({ mode: 'text', reason: 'container-depth' });
  });

  it('downgrades content larger than two MiB', (): void => {
    expect(inspectMessageSafety('x'.repeat(2 * 1024 * 1024 + 1))).toEqual({ mode: 'text', reason: 'content-too-large' });
  });

  it('keeps ordinary Markdown enabled', (): void => {
    expect(inspectMessageSafety('## Heading\n\n- one\n- two')).toEqual({ mode: 'markdown' });
  });
});
