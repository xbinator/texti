/**
 * @file use-runtime-environment.test.ts
 * @description BChat Runtime 当前环境上下文 hook 测试。
 */
import type { ChatRuntimePageEnvironmentContext } from 'types/chat-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRuntimeEnvironment } from '@/components/BChat/hooks/useRuntimeEnvironment';
import type { RuntimeToolDiscoveryBinding } from '@/components/BChat/hooks/useRuntimeTools';

/**
 * 根据指定时区格式化测试期望时间。
 * @param date - 固定测试时间
 * @param timezone - IANA 时区
 * @returns YYYY-MM-DD HH:mm:ss 时间
 */
function formatExpectedTime(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const year = parts.find((part): boolean => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part): boolean => part.type === 'month')?.value ?? '01';
  const day = parts.find((part): boolean => part.type === 'day')?.value ?? '01';
  const hour = parts.find((part): boolean => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part): boolean => part.type === 'minute')?.value ?? '00';
  const second = parts.find((part): boolean => part.type === 'second')?.value ?? '00';
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

describe('useRuntimeEnvironment', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('creates metadata with concrete current time and registered page context', (): void => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T09:12:34.000Z'));
    vi.stubGlobal('navigator', { platform: 'MacIntel' });

    const binding: RuntimeToolDiscoveryBinding = {
      toolContext: { providerId: 'editor', resourceId: 'document-a' },
      pageEnvironment: {
        sections: [{ tag: 'current_file', lines: ['Path: /home/user/workspace/src/App.vue', 'Selected lines:', '8: const title = "Tibis";'] }]
      }
    };
    const { resolveRuntimeEnvironmentContext } = useRuntimeEnvironment();

    const context = resolveRuntimeEnvironmentContext(binding, '/home/user/workspace', 'user-1');

    expect(context).toMatchObject({
      targetMessageId: 'user-1',
      metadata: {
        operatingSystem: 'macOS',
        workspaceRoot: '/home/user/workspace'
      },
      sections: [{ tag: 'current_file', lines: ['Path: /home/user/workspace/src/App.vue', 'Selected lines:', '8: const title = "Tibis";'] }]
    });
    expect(context?.metadata.currentTime).toBe(formatExpectedTime(new Date('2026-08-06T09:12:34.000Z'), context?.metadata.timezone ?? 'UTC'));
  });

  it('prevents registered page context from overriding runtime metadata', (): void => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T09:12:34.000Z'));
    vi.stubGlobal('navigator', { platform: 'MacIntel' });

    const unsafePageEnvironment = {
      targetMessageId: 'evil-user',
      metadata: {
        operatingSystem: 'evil-os',
        timezone: 'Etc/UTC',
        currentDate: '1900-01-01',
        currentTime: '1900-01-01 00:00:00',
        workspaceRoot: '/evil/workspace'
      },
      sections: [{ tag: 'current_page', lines: ['URL: https://example.com'] }]
    } as unknown as ChatRuntimePageEnvironmentContext;
    const binding: RuntimeToolDiscoveryBinding = {
      toolContext: { providerId: 'webview', resourceId: 'webview-a' },
      pageEnvironment: unsafePageEnvironment
    };
    const { resolveRuntimeEnvironmentContext } = useRuntimeEnvironment();

    const context = resolveRuntimeEnvironmentContext(binding, '/home/user/workspace', 'user-1');

    expect(context?.targetMessageId).toBe('user-1');
    expect(context?.metadata).toMatchObject({
      operatingSystem: 'macOS',
      workspaceRoot: '/home/user/workspace'
    });
    expect(context?.metadata.currentTime).not.toBe('1900-01-01 00:00:00');
    expect(context?.sections).toEqual([{ tag: 'current_page', lines: ['URL: https://example.com'] }]);
  });

  it('filters page environment sections to the public context shape', (): void => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T09:12:34.000Z'));

    const unsafePageEnvironment = {
      sections: [
        { tag: 'current_page', lines: ['URL: https://example.com', 42, 'Selected text: selected\ntext'], secret: 'hidden page data' },
        { tag: 'bad tag', lines: ['hidden section'] },
        { tag: 'current_file', lines: ['Path: /workspace/Draft.md', '', 'Selected lines:', '2: safe line'] }
      ]
    } as unknown as ChatRuntimePageEnvironmentContext;
    const binding: RuntimeToolDiscoveryBinding = {
      toolContext: { providerId: 'mixed', resourceId: 'page-a' },
      pageEnvironment: unsafePageEnvironment
    };
    const { resolveRuntimeEnvironmentContext } = useRuntimeEnvironment();

    const context = resolveRuntimeEnvironmentContext(binding, '/home/user/workspace', 'user-1');

    expect(context?.sections).toEqual([
      { tag: 'current_page', lines: ['URL: https://example.com', 'Selected text: selected text'] },
      { tag: 'current_file', lines: ['Path: /workspace/Draft.md', 'Selected lines:', '2: safe line'] }
    ]);
  });
});
