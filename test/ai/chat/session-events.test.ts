/**
 * @file session-events.test.ts
 * @description Session UI 无缓存事件总线测试。
 */
import type { ChatRuntimeConfirmationRequestEvent, ChatRuntimeMessageDeletedEvent } from 'types/chat-runtime';
import { describe, expect, it, vi } from 'vitest';
import { createChatSessionEventBus } from '@/ai/chat/sessionEvents';

/**
 * 创建 Runtime 删除消息事件。
 * @param sessionId - 会话 ID
 * @returns 删除消息事件
 */
function createDeletedEvent(sessionId: string): ChatRuntimeMessageDeletedEvent {
  return {
    runtimeId: `runtime-${sessionId}`,
    sessionId,
    turnId: `turn-${sessionId}`,
    clientId: 'bchat',
    agentId: 'primary',
    rootRuntimeId: `runtime-${sessionId}`,
    messageId: `message-${sessionId}`
  };
}

/**
 * 创建待处理工具确认事件。
 * @param sessionId - 会话 ID
 * @param suffix - confirmation 身份后缀
 * @returns Runtime confirmation 事件
 */
function createConfirmationEvent(sessionId: string, suffix = sessionId): ChatRuntimeConfirmationRequestEvent {
  return {
    runtimeId: `runtime-${sessionId}`,
    sessionId,
    turnId: `turn-${sessionId}`,
    clientId: 'bchat',
    agentId: 'primary',
    rootRuntimeId: `runtime-${sessionId}`,
    confirmationId: `confirmation-${suffix}`,
    request: {
      toolName: 'write_file',
      title: '写入文件',
      description: '是否写入？',
      riskLevel: 'write'
    }
  };
}

describe('chat session UI event bus', (): void => {
  it('routes events only to current session subscribers without replaying history', (): void => {
    const bus = createChatSessionEventBus();
    const sessionAListener = vi.fn();
    const sessionBListener = vi.fn();
    bus.emit('session-a', { type: 'messageDeleted', event: createDeletedEvent('session-a') });
    const unsubscribeA = bus.subscribe('session-a', sessionAListener);
    bus.subscribe('session-b', sessionBListener);

    expect(sessionAListener).not.toHaveBeenCalled();
    bus.emit('session-a', { type: 'messageDeleted', event: createDeletedEvent('session-a') });
    expect(sessionAListener).toHaveBeenCalledTimes(1);
    expect(sessionBListener).not.toHaveBeenCalled();

    unsubscribeA();
    bus.emit('session-a', { type: 'messageDeleted', event: createDeletedEvent('session-a') });
    expect(sessionAListener).toHaveBeenCalledTimes(1);
  });

  it('replays only a pending interaction until it is cleared', (): void => {
    const bus = createChatSessionEventBus();
    const confirmationEvent = createConfirmationEvent('session-a');
    bus.emit('session-a', { type: 'confirmationRequested', event: confirmationEvent });

    const firstListener = vi.fn();
    bus.subscribe('session-a', firstListener);
    expect(firstListener).toHaveBeenCalledWith({ type: 'confirmationRequested', event: confirmationEvent });

    bus.clearPendingInteraction('session-a', confirmationEvent.confirmationId);
    const secondListener = vi.fn();
    bus.subscribe('session-a', secondListener);
    expect(secondListener).not.toHaveBeenCalled();
  });

  it('replays every distinct pending confirmation and clears them independently', (): void => {
    const bus = createChatSessionEventBus();
    const first = createConfirmationEvent('session-a', 'first');
    const second = createConfirmationEvent('session-a', 'second');
    bus.emit('session-a', { type: 'confirmationRequested', event: first });
    bus.emit('session-a', { type: 'confirmationRequested', event: second });

    const firstListener = vi.fn();
    bus.subscribe('session-a', firstListener);
    expect(firstListener).toHaveBeenCalledWith({ type: 'confirmationRequested', event: first });
    expect(firstListener).toHaveBeenCalledWith({ type: 'confirmationRequested', event: second });

    bus.clearPendingInteraction('session-a', first.confirmationId);
    const secondListener = vi.fn();
    bus.subscribe('session-a', secondListener);
    expect(secondListener).not.toHaveBeenCalledWith({ type: 'confirmationRequested', event: first });
    expect(secondListener).toHaveBeenCalledWith({ type: 'confirmationRequested', event: second });
  });
});
