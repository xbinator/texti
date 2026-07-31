/**
 * @file use-session-workspace.test.ts
 * @description BChat 会话级工作区状态与预检测试。
 */
import type { ChatSession } from 'types/chat';
import { nextTick, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionWorkspace } from '@/components/BChat/hooks/useSessionWorkspace';

/** 会话数据源与平台能力的测试替身。 */
const mocks = vi.hoisted(() => ({
  /** 按 ID 读取会话。 */
  loadSessionById: vi.fn(),
  /** 写入会话工作区。 */
  updateSessionWorkspace: vi.fn(),
  /** 清除会话工作区。 */
  clearSessionWorkspace: vi.fn(),
  /** 打开原生目录选择框。 */
  selectDirectory: vi.fn(),
  /** 查询本地路径状态。 */
  getPathStatus: vi.fn()
}));

vi.mock('@/stores/chat/session', () => ({
  useChatSessionStore: () => ({
    loadSessionById: mocks.loadSessionById,
    updateSessionWorkspace: mocks.updateSessionWorkspace,
    clearSessionWorkspace: mocks.clearSessionWorkspace
  })
}));

vi.mock('@/shared/platform', () => ({
  native: {
    selectDirectory: mocks.selectDirectory,
    getPathStatus: mocks.getPathStatus
  }
}));

/**
 * 创建最小会话夹具。
 * @param id - 会话 ID
 * @param workspaceRoot - 可选的会话覆盖目录
 * @returns 聊天会话夹具
 */
function createSession(id: string, workspaceRoot?: string): ChatSession {
  return {
    id,
    type: 'assistant',
    title: id,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
    lastMessageAt: '2026-07-31T00:00:00.000Z',
    metadata: workspaceRoot ? { workspaceRoot } : undefined
  };
}

/**
 * 等待响应式会话加载任务完成。
 * @returns 完成后的 Promise
 */
async function flushWorkspaceState(): Promise<void> {
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

describe('useSessionWorkspace', (): void => {
  beforeEach((): void => {
    mocks.loadSessionById.mockReset();
    mocks.updateSessionWorkspace.mockReset();
    mocks.clearSessionWorkspace.mockReset();
    mocks.selectDirectory.mockReset();
    mocks.getPathStatus.mockReset();
  });

  it('uses the persisted workspace override for the active session', async (): Promise<void> => {
    const activeSessionId = ref<string | null>('session-1');
    mocks.loadSessionById.mockResolvedValue(createSession('session-1', '/private/tmp/project'));

    const workspace = useSessionWorkspace({ activeSessionId, defaultWorkspaceRoot: ref('/Users/user/.tibis') });
    await flushWorkspaceState();

    expect(workspace.workspaceOverride.value).toBe('/private/tmp/project');
    expect(workspace.workspaceRoot.value).toBe('/private/tmp/project');
    expect(workspace.workspaceLabel.value).toBe('project');
  });

  it('waits for the persisted workspace before allowing a runtime', async (): Promise<void> => {
    let resolveSession: ((session: ChatSession | undefined) => void) | undefined;
    const pendingSession = new Promise<ChatSession | undefined>((resolve: (session: ChatSession | undefined) => void): void => {
      resolveSession = resolve;
    });
    const activeSessionId = ref<string | null>('session-1');
    mocks.loadSessionById.mockReturnValue(pendingSession);
    mocks.getPathStatus.mockResolvedValue({ exists: true, isFile: false, isDirectory: true });

    const workspace = useSessionWorkspace({ activeSessionId, defaultWorkspaceRoot: ref('/Users/user/.tibis') });
    const validation = workspace.assertWorkspaceAvailable();
    await Promise.resolve();
    expect(mocks.getPathStatus).not.toHaveBeenCalled();

    resolveSession?.(createSession('session-1', '/private/tmp/project'));
    await expect(validation).resolves.toBeUndefined();
    expect(mocks.getPathStatus).toHaveBeenCalledWith('/private/tmp/project');
  });

  it('blocks a runtime when the persisted workspace cannot be loaded', async (): Promise<void> => {
    const activeSessionId = ref<string |null>('session-1');
    mocks.loadSessionById.mockRejectedValue(new Error('database unavailable'));

    const workspace = useSessionWorkspace({ activeSessionId, defaultWorkspaceRoot: ref('/Users/user/.tibis') });

    await expect(workspace.assertWorkspaceAvailable()).rejects.toThrow('无法加载当前会话工作区');
  });

  it('blocks a runtime when the active session cannot be resolved', async (): Promise<void> => {
    const activeSessionId = ref<string | null>('session-1');
    mocks.loadSessionById.mockResolvedValue(undefined);

    const workspace = useSessionWorkspace({ activeSessionId, defaultWorkspaceRoot: ref('/Users/user/.tibis') });

    await expect(workspace.assertWorkspaceAvailable()).rejects.toThrow('无法加载当前会话工作区');
  });

  it('keeps a selected workspace in a draft until the first session is created', async (): Promise<void> => {
    const activeSessionId = ref<string | null>(null);
    mocks.selectDirectory.mockResolvedValue('/private/tmp/draft-project');

    const workspace = useSessionWorkspace({ activeSessionId, defaultWorkspaceRoot: ref('/Users/user/.tibis') });
    await workspace.selectWorkspace();

    expect(workspace.workspaceOverride.value).toBe('/private/tmp/draft-project');
    expect(workspace.workspaceRoot.value).toBe('/private/tmp/draft-project');
    expect(mocks.updateSessionWorkspace).not.toHaveBeenCalled();
  });

  it('clears a draft workspace and falls back to the default workspace', async (): Promise<void> => {
    const activeSessionId = ref<string | null>(null);
    mocks.selectDirectory.mockResolvedValue('/private/tmp/draft-project');

    const workspace = useSessionWorkspace({ activeSessionId, defaultWorkspaceRoot: ref('/Users/user/.tibis') });
    await workspace.selectWorkspace();
    await workspace.clearWorkspace();

    expect(workspace.workspaceOverride.value).toBeUndefined();
    expect(workspace.workspaceRoot.value).toBe('/Users/user/.tibis');
    expect(mocks.clearSessionWorkspace).not.toHaveBeenCalled();
  });

  it('persists a selected workspace for an existing session', async (): Promise<void> => {
    const activeSessionId = ref<string | null>('session-1');
    mocks.loadSessionById.mockResolvedValue(createSession('session-1'));
    mocks.selectDirectory.mockResolvedValue('/private/tmp/project');
    mocks.updateSessionWorkspace.mockResolvedValue(createSession('session-1', '/private/tmp/project'));

    const workspace = useSessionWorkspace({ activeSessionId, defaultWorkspaceRoot: ref('/Users/user/.tibis') });
    await flushWorkspaceState();
    await workspace.selectWorkspace();

    expect(mocks.updateSessionWorkspace).toHaveBeenCalledWith('session-1', '/private/tmp/project');
    expect(workspace.workspaceRoot.value).toBe('/private/tmp/project');
  });

  it('clears a persisted workspace and falls back to the default workspace', async (): Promise<void> => {
    const activeSessionId = ref<string | null>('session-1');
    mocks.loadSessionById.mockResolvedValue(createSession('session-1', '/private/tmp/project'));
    mocks.clearSessionWorkspace.mockResolvedValue(createSession('session-1'));

    const workspace = useSessionWorkspace({ activeSessionId, defaultWorkspaceRoot: ref('/Users/user/.tibis') });
    await flushWorkspaceState();
    await workspace.clearWorkspace();

    expect(mocks.clearSessionWorkspace).toHaveBeenCalledWith('session-1');
    expect(workspace.workspaceOverride.value).toBeUndefined();
    expect(workspace.workspaceRoot.value).toBe('/Users/user/.tibis');
  });

  it('preserves the current workspace when the native dialog is cancelled', async (): Promise<void> => {
    const activeSessionId = ref<string | null>('session-1');
    mocks.loadSessionById.mockResolvedValue(createSession('session-1', '/private/tmp/original'));
    mocks.selectDirectory.mockResolvedValue(null);

    const workspace = useSessionWorkspace({ activeSessionId, defaultWorkspaceRoot: ref('/Users/user/.tibis') });
    await flushWorkspaceState();
    await workspace.selectWorkspace();

    expect(workspace.workspaceRoot.value).toBe('/private/tmp/original');
    expect(mocks.updateSessionWorkspace).not.toHaveBeenCalled();
  });

  it('rejects a persisted workspace that is no longer an accessible directory', async (): Promise<void> => {
    const activeSessionId = ref<string | null>('session-1');
    mocks.loadSessionById.mockResolvedValue(createSession('session-1', '/private/tmp/missing'));
    mocks.getPathStatus.mockResolvedValue({ exists: false, isFile: false, isDirectory: false });

    const workspace = useSessionWorkspace({ activeSessionId, defaultWorkspaceRoot: ref('/Users/user/.tibis') });
    await flushWorkspaceState();

    await expect(workspace.assertWorkspaceAvailable()).rejects.toThrow('当前会话工作区不可用，请重新选择目录');
  });

  it('does not let a previous session load overwrite the current workspace', async (): Promise<void> => {
    let resolveFirstSession: ((session: ChatSession | undefined) => void) | undefined;
    const firstSession = new Promise<ChatSession | undefined>((resolve: (session: ChatSession | undefined) => void): void => {
      resolveFirstSession = resolve;
    });
    const activeSessionId = ref<string | null>('session-1');
    mocks.loadSessionById.mockReturnValueOnce(firstSession).mockResolvedValueOnce(createSession('session-2', '/private/tmp/second'));

    const workspace = useSessionWorkspace({ activeSessionId, defaultWorkspaceRoot: ref('/Users/user/.tibis') });
    activeSessionId.value = 'session-2';
    await flushWorkspaceState();
    resolveFirstSession?.(createSession('session-1', '/private/tmp/first'));
    await flushWorkspaceState();

    expect(workspace.workspaceRoot.value).toBe('/private/tmp/second');
  });
});
