/**
 * @file use-chat-session.test.ts
 * @description ChatSider 会话选择 hook 测试。
 * @vitest-environment jsdom
 */
import type { ChatSession } from 'types/chat';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useChatSession } from '@/layouts/default/hooks/useChatSession';
import { useChatSessionStore } from '@/stores/chat/session';
import { useSettingStore } from '@/stores/ui/setting';

/**
 * 创建测试会话。
 * @returns 测试会话
 */
function createSession(): ChatSession {
  return {
    id: 'session-a',
    type: 'assistant',
    title: '会话 A',
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    lastMessageAt: '2026-07-22T00:00:00.000Z'
  };
}

describe('useChatSession', (): void => {
  beforeEach((): void => {
    setActivePinia(createPinia());
  });

  it('switches sessions without a chat-loading guard', async (): Promise<void> => {
    const settingStore = useSettingStore();
    settingStore.setChatSidebarActiveSessionId('session-a');
    const session = useChatSession();

    await session.switchSession('session-b');

    expect(settingStore.chatSidebarActiveSessionId).toBe('session-b');
    expect('currentSession' in session).toBe(true);
  });

  it('clears the active session id when the active session is deleted', (): void => {
    const settingStore = useSettingStore();
    settingStore.setChatSidebarActiveSessionId('session-deleted');
    const session = useChatSession();

    session.handleDeletedSession('session-deleted');

    expect(settingStore.chatSidebarActiveSessionId).toBeNull();
    expect('currentSession' in session).toBe(true);
  });

  it('derives the current session from the shared Store', (): void => {
    const settingStore = useSettingStore();
    const chatStore = useChatSessionStore();
    const currentSession = createSession();
    chatStore.sessions = [currentSession];
    settingStore.setChatSidebarActiveSessionId(currentSession.id);

    const session = useChatSession();

    expect(session.currentSession.value).toEqual(currentSession);
  });
});
