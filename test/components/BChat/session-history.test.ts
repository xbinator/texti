/**
 * @file session-history.test.ts
 * @description 会话历史统一确认与删除事务测试。
 * @vitest-environment jsdom
 */
import type { ChatSession } from 'types/chat';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SessionHistory from '@/components/BChat/components/SessionHistory.vue';
import { useChatTabStore } from '@/stores/chat/tab';

const chatStoreMock = vi.hoisted(() => ({
  sessions: [] as ChatSession[],
  sessionsLoading: false,
  sessionsHasMore: true,
  deleteSession: vi.fn<(sessionId: string) => Promise<void>>()
}));
const messageErrorMock = vi.hoisted(() => vi.fn());
const modalDeleteMock = vi.hoisted(() => vi.fn<(content: string) => Promise<[boolean, boolean]>>());
const infiniteScrollState = vi.hoisted(() => ({ callback: undefined as (() => void) | undefined }));

vi.mock('@/stores/chat/session', () => ({
  useChatSessionStore: (): typeof chatStoreMock => chatStoreMock
}));

vi.mock('@vueuse/core', () => ({
  useInfiniteScroll: vi.fn((_target: unknown, callback: () => void): void => {
    infiniteScrollState.callback = callback;
  })
}));

vi.mock('ant-design-vue', () => ({
  message: {
    error: messageErrorMock
  }
}));

vi.mock('@/utils/modal', () => ({
  Modal: {
    delete: modalDeleteMock
  }
}));

/**
 * 创建测试会话。
 * @param id - 会话 ID
 * @returns 测试会话
 */
function createSession(id: string): ChatSession {
  return {
    id,
    type: 'assistant',
    title: `会话 ${id}`,
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    lastMessageAt: '2026-07-21T00:00:00.000Z'
  };
}

/**
 * 挂载会话历史。
 * @returns 组件包装器
 */
function mountHistory(): ReturnType<typeof mount> {
  return mount(SessionHistory, {
    global: {
      stubs: {
        BDropdown: {
          template: '<div><slot /><slot name="overlay" /></div>'
        },
        BButton: {
          props: ['disabled'],
          emits: ['click'],
          template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
        },
        BIcon: {
          name: 'BIcon',
          props: ['icon', 'size'],
          template: '<i class="b-icon-stub" :data-icon="icon" :data-size="size" />'
        }
      }
    }
  });
}

describe('SessionHistory confirmed deletion', (): void => {
  beforeEach((): void => {
    setActivePinia(createPinia());
    chatStoreMock.sessions = [createSession('session-a')];
    chatStoreMock.sessionsLoading = false;
    chatStoreMock.sessionsHasMore = true;
    chatStoreMock.deleteSession.mockReset();
    chatStoreMock.deleteSession.mockResolvedValue();
    messageErrorMock.mockReset();
    modalDeleteMock.mockReset();
    modalDeleteMock.mockResolvedValue([false, true]);
    infiniteScrollState.callback = undefined;
  });

  it('renders the shared Store collection without exposing a refresh method', (): void => {
    const wrapper = mountHistory();

    expect(wrapper.text()).toContain('会话 session-a');
    expect('refreshSessions' in wrapper.vm).toBe(false);
    expect('disabled' in wrapper.props()).toBe(false);
    expect(wrapper.find('button').attributes('disabled')).toBeUndefined();
  });

  it('requests the next page through an event when more sessions are available', (): void => {
    const wrapper = mountHistory();

    infiniteScrollState.callback?.();

    expect(wrapper.emitted('load-more')).toEqual([[]]);
  });

  it('always delegates infinite-scroll requests to the Store owner', (): void => {
    chatStoreMock.sessionsHasMore = false;
    chatStoreMock.sessionsLoading = true;
    const wrapper = mountHistory();

    infiniteScrollState.callback?.();

    expect(wrapper.emitted('load-more')).toEqual([[]]);
  });

  it('shows and confirms deletion while the session is running', async (): Promise<void> => {
    const runtimeStore = useChatTabStore();
    runtimeStore.ensureTab('chat:session-a', 'session-a');
    runtimeStore.setStatus('chat:session-a', 'running');
    const wrapper = mountHistory();
    await flushPromises();

    const deleteButton = wrapper.find('.session-history__actions button');
    const statusIcon = wrapper.find('.session-history__content .session-history__status-icon');
    expect(deleteButton.exists()).toBe(true);
    expect(deleteButton.attributes('disabled')).toBeUndefined();
    expect(statusIcon.attributes('data-icon')).toBe('lucide:loader-2');
    expect(statusIcon.classes()).toContain('is-spinning');
    expect(wrapper.find('.session-history__actions .session-history__status-icon').exists()).toBe(false);
    await deleteButton.trigger('click');
    await flushPromises();

    expect(modalDeleteMock).toHaveBeenCalledWith('确定终止并删除聊天“会话 session-a”吗？当前聊天仍在运行，删除前会先终止所有任务。删除后无法恢复。');
    expect(chatStoreMock.deleteSession).toHaveBeenCalledWith('session-a');
  });

  it('does not delete when confirmation is cancelled', async (): Promise<void> => {
    modalDeleteMock.mockResolvedValue([true, false]);
    const wrapper = mountHistory();
    await flushPromises();

    await wrapper.find('.session-history__actions button').trigger('click');
    await flushPromises();

    expect(modalDeleteMock).toHaveBeenCalledOnce();
    expect(chatStoreMock.deleteSession).not.toHaveBeenCalled();
    expect(wrapper.emitted('delete-session')).toBeUndefined();
  });

  it('shows a waiting icon and matching confirmation while the session is waiting', async (): Promise<void> => {
    const runtimeStore = useChatTabStore();
    runtimeStore.ensureTab('chat:session-a', 'session-a');
    runtimeStore.setStatus('chat:session-a', 'waiting');
    const wrapper = mountHistory();
    await flushPromises();

    const statusIcon = wrapper.find('.session-history__content .session-history__status-icon');
    expect(wrapper.find('.session-history__actions button').exists()).toBe(true);
    expect(statusIcon.attributes('data-icon')).toBe('lucide:circle-help');
    expect(statusIcon.classes()).not.toContain('is-spinning');

    await wrapper.find('.session-history__actions button').trigger('click');
    await flushPromises();

    expect(modalDeleteMock).toHaveBeenCalledWith('确定终止并删除聊天“会话 session-a”吗？当前聊天正在等待你的操作，删除时会取消等待中的交互。删除后无法恢复。');
  });

  it('shows deletion actions while a session tab identity is being promoted', async (): Promise<void> => {
    const runtimeStore = useChatTabStore();
    runtimeStore.ensureTab('chat:session-a', 'session-a');
    runtimeStore.markPromoting(['chat:session-a']);
    const wrapper = mountHistory();
    await flushPromises();

    expect(wrapper.find('.session-history__actions button').exists()).toBe(true);
  });

  it('confirms, deletes and emits when the session is idle', async (): Promise<void> => {
    const wrapper = mountHistory();
    await flushPromises();

    expect(wrapper.find('.session-history__status-icon').exists()).toBe(false);
    await wrapper.find('.session-history__actions button').trigger('click');
    await flushPromises();

    expect(modalDeleteMock).toHaveBeenCalledWith('确定删除聊天“会话 session-a”吗？删除后无法恢复。');
    expect(chatStoreMock.deleteSession).toHaveBeenCalledWith('session-a');
    expect(wrapper.emitted('delete-session')).toEqual([['session-a']]);
  });

  it('does not render status icons for completed or error sessions', async (): Promise<void> => {
    const runtimeStore = useChatTabStore();
    runtimeStore.ensureTab('chat:session-a', 'session-a');
    runtimeStore.markCompleted('chat:session-a', false);
    const wrapper = mountHistory();
    await flushPromises();

    expect(wrapper.find('.session-history__status-icon').exists()).toBe(false);

    runtimeStore.setStatus('chat:session-a', 'error');
    await flushPromises();

    expect(wrapper.find('.session-history__status-icon').exists()).toBe(false);
  });

  it('uses the unnamed fallback after trimming a blank title', async (): Promise<void> => {
    chatStoreMock.sessions = [{ ...createSession('session-a'), title: '   ' }];
    const wrapper = mountHistory();

    await wrapper.find('.session-history__actions button').trigger('click');
    await flushPromises();

    expect(modalDeleteMock).toHaveBeenCalledWith('确定删除聊天“未命名聊天”吗？删除后无法恢复。');
  });

  it('deduplicates repeated clicks while confirmation is pending', async (): Promise<void> => {
    let resolveConfirmation: (result: [boolean, boolean]) => void = (): void => undefined;
    modalDeleteMock.mockReturnValue(
      new Promise((resolve: (result: [boolean, boolean]) => void): void => {
        resolveConfirmation = resolve;
      })
    );
    const wrapper = mountHistory();
    const deleteButton = wrapper.find('.session-history__actions button');

    await deleteButton.trigger('click');
    await deleteButton.trigger('click');

    expect(modalDeleteMock).toHaveBeenCalledOnce();
    expect(deleteButton.attributes('disabled')).toBeUndefined();
    resolveConfirmation([true, false]);
    await flushPromises();
  });

  it('shows an error and does not emit when deletion fails', async (): Promise<void> => {
    chatStoreMock.deleteSession.mockRejectedValue(new Error('终止任务失败'));
    const wrapper = mountHistory();

    await wrapper.find('.session-history__actions button').trigger('click');
    await flushPromises();

    expect(messageErrorMock).toHaveBeenCalledWith('终止任务失败');
    expect(wrapper.emitted('delete-session')).toBeUndefined();
  });
});
