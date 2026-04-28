/**
 * @file useAutoName.test.ts
 * @description 验证自动命名 Hook 的快照冻结、等待用户输入分支与异步命名行为
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAvailableServiceConfigMock = vi.fn();
const updateSessionTitleMock = vi.fn();
const invokeMock = vi.fn();

vi.mock('@/stores/service-model', () => ({
  useServiceModelStore: () => ({
    getAvailableServiceConfig: getAvailableServiceConfigMock
  })
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    updateSessionTitle: updateSessionTitleMock
  })
}));

vi.mock('@/hooks/useChat', () => ({
  useChat: () => ({
    agent: {
      invoke: invokeMock
    }
  })
}));

describe('useAutoName', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    getAvailableServiceConfigMock.mockReset();
    updateSessionTitleMock.mockReset();
    invokeMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('captures the first-round snapshot from the message argument and frozen session id', async () => {
    const { useAutoName } = await import('@/components/BChatSidebar/hooks/useAutoName');
    const { captureSnapshot } = useAutoName({
      getCurrentSessionId: () => 'session-later',
      getCurrentSession: () => undefined,
      getFirstRoundContent: (message) => ({
        userMessage: '用户首条消息',
        aiResponse: message.content
      })
    });

    const snapshot = captureSnapshot({ content: '首轮 AI 回复' }, 'session-frozen');

    expect(snapshot).toEqual({
      sessionId: 'session-frozen',
      userMessage: '用户首条消息',
      aiResponse: '首轮 AI 回复'
    });
  });

  it('returns null when the first round is still awaiting user input', async () => {
    const { useAutoName } = await import('@/components/BChatSidebar/hooks/useAutoName');
    const { captureSnapshot } = useAutoName({
      getCurrentSessionId: () => 'session-1',
      getCurrentSession: () => undefined,
      getFirstRoundContent: () => null
    });

    expect(captureSnapshot({ content: '需要用户继续回答' }, 'session-1')).toBeNull();
  });

  it('schedules auto naming and persists the generated title after loading settles', async () => {
    getAvailableServiceConfigMock.mockResolvedValue({
      providerId: 'provider-1',
      modelId: 'model-1',
      customPrompt: 'Title: {{USER_MESSAGE}} -> {{AI_RESPONSE}}'
    });
    invokeMock.mockResolvedValue([undefined, { text: '"自动命名标题"' }]);
    const refreshMock = vi.fn();
    const currentSession = { id: 'session-1', title: '旧标题' };

    const { useAutoName } = await import('@/components/BChatSidebar/hooks/useAutoName');
    const { scheduleAutoName } = useAutoName({
      getCurrentSessionId: () => 'session-other',
      getCurrentSession: () => currentSession,
      getFirstRoundContent: () => ({
        userMessage: '用户首条消息',
        aiResponse: '首轮 AI 回复'
      }),
      onTitlePersisted: refreshMock
    });

    scheduleAutoName(
      {
        sessionId: 'session-1',
        userMessage: '用户首条消息',
        aiResponse: '首轮 AI 回复'
      },
      () => false
    );

    await vi.advanceTimersByTimeAsync(300);

    expect(invokeMock).toHaveBeenCalledWith({
      providerId: 'provider-1',
      modelId: 'model-1',
      prompt: 'Title: 用户首条消息 -> 首轮 AI 回复'
    });
    expect(updateSessionTitleMock).toHaveBeenCalledWith('session-1', '自动命名标题');
    expect(currentSession.title).toBe('自动命名标题');
    expect(refreshMock).toHaveBeenCalledWith('session-1', '自动命名标题');
  });
});
