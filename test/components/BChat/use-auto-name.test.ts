/**
 * @file use-auto-name.test.ts
 * @description useAutoName Hook 单元测试，覆盖快照采集、防抖调度、chat 模型复用与标题持久化。
 */
import { effectScope } from 'vue';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { AUTO_NAME_PENDING_LIMIT, AUTO_NAME_SESSION_LIMIT, useAutoName } from '@/components/BChat/hooks/useAutoName';
import { storeEvents } from '@/stores/helpers/events';

/** mock ChatRuntime 自动命名命令。 */
const mockChatRuntimeAutoName = vi.hoisted(() => vi.fn());

vi.mock('@/shared/platform/electron-api', () => ({
  getElectronAPI: vi.fn(() => ({
    chatRuntimeAutoName: mockChatRuntimeAutoName
  })),
  // 单测环境无真实 Electron，logger 走 console 分支，避免 mock 缺失导出导致 asyncTo 抛错。
  hasElectronAPI: () => false
}));

/** 固定定时器，便于精确控制防抖 */
vi.useFakeTimers();

/**
 * 构造最小 options，模拟调用方提供的上下文。
 * @param overrides - 可选覆盖项
 * @returns AutoNameOptions
 */
function createOptions(overrides?: {
  currentSession?: { id: string; title: string };
  onTitlePersisted?: (sessionId: string, title: string) => Promise<void> | void;
}) {
  return {
    getCurrentSession: () => overrides?.currentSession,
    getFirstRoundContent: (message: { content: string }) => ({
      userMessage: '用户首条消息',
      aiResponse: message.content
    }),
    onTitlePersisted: overrides?.onTitlePersisted
  };
}

describe('useAutoName', () => {
  beforeEach((): void => {
    mockChatRuntimeAutoName.mockReset();
  });

  // ─── captureSnapshot ───

  describe('captureSnapshot', () => {
    it('returns null when sessionId is null', (): void => {
      const { captureSnapshot } = useAutoName(createOptions());
      expect(captureSnapshot({ content: 'hi' }, null)).toBeNull();
    });

    it('returns null when getFirstRoundContent returns null', (): void => {
      const { captureSnapshot } = useAutoName({
        ...createOptions(),
        getFirstRoundContent: () => null
      });
      expect(captureSnapshot({ content: 'hi' }, 'session-1')).toBeNull();
    });

    it('returns snapshot with sessionId and first-round content', (): void => {
      const { captureSnapshot } = useAutoName(createOptions());
      const snap = captureSnapshot({ content: 'AI回复内容' }, 'session-1');
      expect(snap).toEqual({
        sessionId: 'session-1',
        userMessage: '用户首条消息',
        aiResponse: 'AI回复内容'
      });
    });
  });

  // ─── scheduleAutoName → doAutoName ───

  describe('doAutoName (via scheduleAutoName)', () => {
    it('requests main process ChatRuntime autoname with the frozen snapshot', async (): Promise<void> => {
      mockChatRuntimeAutoName.mockResolvedValue({ ok: true, data: { status: 'success', title: '聊天话题' } });

      const { captureSnapshot, scheduleAutoName } = useAutoName(createOptions());
      const snap = captureSnapshot({ content: 'AI回复' }, 'session-1')!;
      scheduleAutoName(snap, () => false);

      await vi.advanceTimersByTimeAsync(300);

      expect(mockChatRuntimeAutoName).toHaveBeenCalledWith({
        sessionId: 'session-1',
        userMessage: '用户首条消息',
        aiResponse: 'AI回复'
      });
    });

    it('skips UI updates when main process skips naming', async (): Promise<void> => {
      const currentSession = { id: 'session-1', title: '旧标题' };
      mockChatRuntimeAutoName.mockResolvedValue({ ok: true, data: { status: 'skipped', reason: 'no_model_config' } });

      const { captureSnapshot, scheduleAutoName } = useAutoName(createOptions({ currentSession }));
      const snap = captureSnapshot({ content: 'AI回复' }, 'session-1')!;
      scheduleAutoName(snap, () => false);

      await vi.advanceTimersByTimeAsync(300);

      expect(currentSession.title).toBe('旧标题');
    });

    it('updates current session UI after successful naming', async (): Promise<void> => {
      mockChatRuntimeAutoName.mockResolvedValue({ ok: true, data: { status: 'success', title: 'Vue组件设计' } });

      const currentSession = { id: 'session-1', title: '旧标题' };
      const { captureSnapshot, scheduleAutoName } = useAutoName(createOptions({ currentSession }));
      const snap = captureSnapshot({ content: 'AI回复' }, 'session-1')!;
      scheduleAutoName(snap, () => false);

      await vi.advanceTimersByTimeAsync(300);

      expect(currentSession.title).toBe('Vue组件设计');
    });

    it('does not update UI when current session differs', async (): Promise<void> => {
      mockChatRuntimeAutoName.mockResolvedValue({ ok: true, data: { status: 'success', title: '其他话题' } });

      const currentSession = { id: 'session-other', title: '旧标题' };
      const { captureSnapshot, scheduleAutoName } = useAutoName(createOptions({ currentSession }));
      const snap = captureSnapshot({ content: 'AI回复' }, 'session-1')!;
      scheduleAutoName(snap, () => false);

      await vi.advanceTimersByTimeAsync(300);

      expect(currentSession.title).toBe('旧标题');
    });

    it('skips UI updates when main process fails naming', async (): Promise<void> => {
      const currentSession = { id: 'session-1', title: '旧标题' };
      mockChatRuntimeAutoName.mockResolvedValue({ ok: true, data: { status: 'failed', errorMessage: '网络错误' } });

      const { captureSnapshot, scheduleAutoName } = useAutoName(createOptions({ currentSession }));
      const snap = captureSnapshot({ content: 'AI回复' }, 'session-1')!;
      scheduleAutoName(snap, () => false);

      await vi.advanceTimersByTimeAsync(300);

      expect(currentSession.title).toBe('旧标题');
    });

    it('does not rename the same session twice', async (): Promise<void> => {
      mockChatRuntimeAutoName.mockResolvedValue({ ok: true, data: { status: 'success', title: '首次标题' } });

      const { captureSnapshot, scheduleAutoName } = useAutoName(createOptions());

      const snap1 = captureSnapshot({ content: 'AI回复' }, 'session-1')!;
      scheduleAutoName(snap1, () => false);
      await vi.advanceTimersByTimeAsync(300);

      expect(mockChatRuntimeAutoName).toHaveBeenCalledTimes(1);

      const snap2 = captureSnapshot({ content: 'AI回复2' }, 'session-1')!;
      scheduleAutoName(snap2, () => false);
      await vi.advanceTimersByTimeAsync(300);

      expect(mockChatRuntimeAutoName).toHaveBeenCalledTimes(1);
    });

    it('bounds completed Session retention and evicts the oldest identity', async (): Promise<void> => {
      mockChatRuntimeAutoName.mockResolvedValue({ ok: true, data: { status: 'success', title: '压力标题' } });
      const { captureSnapshot, scheduleAutoName } = useAutoName(createOptions());

      for (let index = 0; index <= AUTO_NAME_SESSION_LIMIT; index += 1) {
        const snapshot = captureSnapshot({ content: `AI回复-${index}` }, `session-${index}`);
        if (!snapshot) throw new Error('auto_name_snapshot_missing');
        scheduleAutoName(snapshot, () => false);
        // eslint-disable-next-line no-await-in-loop -- 每轮需完成命名才能压力验证已完成会话留存上限。
        await vi.advanceTimersByTimeAsync(300);
      }

      const oldestSnapshot = captureSnapshot({ content: '重新命名' }, 'session-0');
      if (!oldestSnapshot) throw new Error('oldest_auto_name_snapshot_missing');
      scheduleAutoName(oldestSnapshot, () => false);
      await vi.advanceTimersByTimeAsync(300);

      expect(mockChatRuntimeAutoName).toHaveBeenCalledTimes(AUTO_NAME_SESSION_LIMIT + 2);
    });

    it('calls onTitlePersisted after successful naming', async (): Promise<void> => {
      mockChatRuntimeAutoName.mockResolvedValue({ ok: true, data: { status: 'success', title: '持久化测试' } });

      const onTitlePersisted = vi.fn();
      const { captureSnapshot, scheduleAutoName } = useAutoName(createOptions({ onTitlePersisted }));
      const snap = captureSnapshot({ content: 'AI回复' }, 'session-1')!;
      scheduleAutoName(snap, () => false);

      await vi.advanceTimersByTimeAsync(300);

      expect(onTitlePersisted).toHaveBeenCalledWith('session-1', '持久化测试');
    });

    it('publishes the persisted title independently of the mounted BChat page', async (): Promise<void> => {
      mockChatRuntimeAutoName.mockResolvedValue({ ok: true, data: { status: 'success', title: '全局标题' } });
      const listener = vi.fn();
      const dispose = storeEvents.onChatSessionTitleUpdated(listener);
      const { captureSnapshot, scheduleAutoName } = useAutoName(createOptions());
      const snap = captureSnapshot({ content: 'AI回复' }, 'session-1')!;

      scheduleAutoName(snap, () => false);
      await vi.advanceTimersByTimeAsync(300);

      expect(listener).toHaveBeenCalledWith({ sessionId: 'session-1', title: '全局标题' });
      dispose();
    });

    it('marks session named even when onTitlePersisted throws', async (): Promise<void> => {
      mockChatRuntimeAutoName.mockResolvedValue({ ok: true, data: { status: 'success', title: '异常回调' } });

      const onTitlePersisted = vi.fn().mockRejectedValue(new Error('回调异常'));
      const { captureSnapshot, scheduleAutoName } = useAutoName(createOptions({ onTitlePersisted }));
      const snap = captureSnapshot({ content: 'AI回复' }, 'session-1')!;
      scheduleAutoName(snap, () => false);

      await vi.advanceTimersByTimeAsync(300);

      const snap2 = captureSnapshot({ content: 'AI回复2' }, 'session-1')!;
      scheduleAutoName(snap2, () => false);
      await vi.advanceTimersByTimeAsync(300);

      expect(mockChatRuntimeAutoName).toHaveBeenCalledTimes(1);
    });
  });

  // ─── 防抖调度 ───

  describe('debounce scheduling', () => {
    it('bounds simultaneously pending Session timers', (): void => {
      const { captureSnapshot, scheduleAutoName } = useAutoName(createOptions());

      for (let index = 0; index <= AUTO_NAME_PENDING_LIMIT; index += 1) {
        const snapshot = captureSnapshot({ content: `AI回复-${index}` }, `pending-session-${index}`);
        if (!snapshot) throw new Error('pending_auto_name_snapshot_missing');
        scheduleAutoName(snapshot, () => true);
      }

      expect(vi.getTimerCount()).toBe(AUTO_NAME_PENDING_LIMIT);
      vi.clearAllTimers();
    });

    it('cancels pending naming tasks when the owning scope is disposed', async (): Promise<void> => {
      const scope = effectScope();
      const autoName = scope.run(() => useAutoName(createOptions()));
      if (!autoName) throw new Error('auto_name_scope_missing');
      const snapshot = autoName.captureSnapshot({ content: 'AI回复' }, 'session-1');
      if (!snapshot) throw new Error('auto_name_snapshot_missing');
      autoName.scheduleAutoName(snapshot, () => true);

      scope.stop();
      await vi.advanceTimersByTimeAsync(900);

      expect(mockChatRuntimeAutoName).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('delays naming by 300ms', async (): Promise<void> => {
      mockChatRuntimeAutoName.mockResolvedValue({ ok: true, data: { status: 'success', title: '延迟标题' } });

      const { captureSnapshot, scheduleAutoName } = useAutoName(createOptions());
      const snap = captureSnapshot({ content: 'AI回复' }, 'session-1')!;
      scheduleAutoName(snap, () => false);

      await vi.advanceTimersByTimeAsync(299);
      expect(mockChatRuntimeAutoName).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(mockChatRuntimeAutoName).toHaveBeenCalledTimes(1);
    });

    it('resets debounce timer when scheduling again for the same session', async (): Promise<void> => {
      mockChatRuntimeAutoName.mockResolvedValue({ ok: true, data: { status: 'success', title: '最终标题' } });

      const { captureSnapshot, scheduleAutoName } = useAutoName(createOptions());

      const snap1 = captureSnapshot({ content: 'AI回复1' }, 'session-1')!;
      scheduleAutoName(snap1, () => false);
      await vi.advanceTimersByTimeAsync(200);

      const snap2 = captureSnapshot({ content: 'AI回复2' }, 'session-1')!;
      scheduleAutoName(snap2, () => false);
      await vi.advanceTimersByTimeAsync(200);

      expect(mockChatRuntimeAutoName).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(100);
      expect(mockChatRuntimeAutoName).toHaveBeenCalledTimes(1);
    });

    it('reschedules when isLoading is true at debounce expiry', async (): Promise<void> => {
      mockChatRuntimeAutoName.mockResolvedValue({ ok: true, data: { status: 'success', title: '加载后标题' } });

      const { captureSnapshot, scheduleAutoName } = useAutoName(createOptions());
      const isLoading: Mock<() => boolean> = vi.fn().mockReturnValue(true);

      const snap = captureSnapshot({ content: 'AI回复' }, 'session-1')!;
      scheduleAutoName(snap, isLoading);

      await vi.advanceTimersByTimeAsync(300);
      expect(mockChatRuntimeAutoName).not.toHaveBeenCalled();

      isLoading.mockReturnValue(false);
      await vi.advanceTimersByTimeAsync(300);
      expect(mockChatRuntimeAutoName).toHaveBeenCalledTimes(1);
    });

    it('handles independent sessions concurrently', async (): Promise<void> => {
      mockChatRuntimeAutoName.mockResolvedValue({ ok: true, data: { status: 'success', title: '并发标题' } });

      const { captureSnapshot, scheduleAutoName } = useAutoName(createOptions());

      const snapA = captureSnapshot({ content: 'A回复' }, 'session-A')!;
      const snapB = captureSnapshot({ content: 'B回复' }, 'session-B')!;
      scheduleAutoName(snapA, () => false);
      scheduleAutoName(snapB, () => false);

      await vi.advanceTimersByTimeAsync(300);

      expect(mockChatRuntimeAutoName).toHaveBeenCalledTimes(2);
    });
  });
});
