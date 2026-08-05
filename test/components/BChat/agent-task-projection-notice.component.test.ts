/**
 * @file agent-task-projection-notice.component.test.ts
 * @description 验证 Session 级 Child Task 投影提示和显式恢复入口。
 * @vitest-environment jsdom
 */
import type { ChatAgentHandlerResult, ChatAgentListTasksResult } from 'types/chat-agent';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentTaskProjectionNotice from '@/components/BChat/components/AgentTaskProjectionNotice.vue';
import { useChatAgentTaskStore } from '@/stores/chat/agentTask';

const agentAPI = vi.hoisted(() => ({
  listTasks: vi.fn()
}));

vi.mock('@/shared/platform/electron-api', () => ({
  getElectronAPI: (): Record<string, unknown> => ({
    chatAgentListTasks: agentAPI.listTasks
  })
}));

vi.mock('@/shared/logger', () => ({
  logger: {
    error: vi.fn()
  }
}));

/**
 * 创建空列表成功响应。
 * @returns Main handler 成功信封
 */
function createPage(): ChatAgentHandlerResult<ChatAgentListTasksResult> {
  return {
    ok: true,
    data: {
      tasks: []
    }
  };
}

describe('AgentTaskProjectionNotice', (): void => {
  beforeEach((): void => {
    setActivePinia(createPinia());
    agentAPI.listTasks.mockReset();
  });

  it('keeps trusted cards and exposes one explicit retry for a stale Session', async (): Promise<void> => {
    const store = useChatAgentTaskStore();
    store.staleSessions['session-1'] = true;
    agentAPI.listTasks.mockResolvedValue(createPage());
    const wrapper: VueWrapper = mount(AgentTaskProjectionNotice, {
      props: {
        sessionId: 'session-1'
      }
    });

    expect(wrapper.text()).toContain('agent_task_projection_stale');
    await wrapper.get('[data-action="retry-agent-tasks"]').trigger('click');
    await flushPromises();

    expect(agentAPI.listTasks).toHaveBeenCalledWith({ sessionId: 'session-1', limit: 50 });
    expect(wrapper.find('[data-agent-task-projection-notice]').exists()).toBe(false);
  });

  it('uses the incompatible notice and retries only after an explicit click', async (): Promise<void> => {
    const store = useChatAgentTaskStore();
    store.incompatibleSessions['session-1'] = true;
    agentAPI.listTasks.mockResolvedValue(createPage());
    const wrapper: VueWrapper = mount(AgentTaskProjectionNotice, {
      props: {
        sessionId: 'session-1'
      }
    });

    expect(wrapper.text()).toContain('agent_task_projection_incompatible');
    expect(agentAPI.listTasks).not.toHaveBeenCalled();

    await wrapper.get('[data-action="retry-agent-tasks"]').trigger('click');
    await flushPromises();
    expect(agentAPI.listTasks).toHaveBeenCalledOnce();
  });

  it('does not optimistically clear the notice or expose a raw retry error', async (): Promise<void> => {
    const store = useChatAgentTaskStore();
    store.staleSessions['session-1'] = true;
    agentAPI.listTasks.mockResolvedValue({
      ok: false,
      code: 'TASK_LIST_FAILED',
      error: 'SECRET_MAIN_ERROR'
    });
    const wrapper: VueWrapper = mount(AgentTaskProjectionNotice, {
      props: {
        sessionId: 'session-1'
      }
    });

    await wrapper.get('[data-action="retry-agent-tasks"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('agent_task_projection_stale');
    expect(wrapper.text()).toContain('agent_task_projection_retry_failed');
    expect(wrapper.html()).not.toContain('SECRET_MAIN_ERROR');
  });

  it('ignores a completed retry after the visible Session changes', async (): Promise<void> => {
    const store = useChatAgentTaskStore();
    store.staleSessions['session-1'] = true;
    store.staleSessions['session-2'] = true;
    let resolveRequest: ((result: ChatAgentHandlerResult<ChatAgentListTasksResult>) => void) | undefined;
    agentAPI.listTasks.mockReturnValue(
      new Promise<ChatAgentHandlerResult<ChatAgentListTasksResult>>((resolve): void => {
        resolveRequest = resolve;
      })
    );
    const wrapper: VueWrapper = mount(AgentTaskProjectionNotice, {
      props: {
        sessionId: 'session-1'
      }
    });

    await wrapper.get('[data-action="retry-agent-tasks"]').trigger('click');
    await wrapper.setProps({ sessionId: 'session-2' });
    resolveRequest?.(createPage());
    await flushPromises();

    expect(wrapper.text()).toContain('agent_task_projection_stale');
    expect(wrapper.text()).not.toContain('agent_task_projection_retry_failed');
  });
});
