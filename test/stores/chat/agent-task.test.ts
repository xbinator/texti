/**
 * @file agent-task.test.ts
 * @description Renderer Child Task Store 的单调投影、分页恢复与并发代际测试。
 * @vitest-environment jsdom
 */
import type {
  ChatAgentGetTaskResult,
  ChatAgentHandlerResult,
  ChatAgentListTasksResult,
  ChatAgentTaskDetailSnapshot,
  ChatAgentTaskSummarySnapshot,
  ChatAgentTaskTombstoneSnapshot
} from 'types/chat-agent';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTaskIndexKey, useChatAgentTaskStore } from '@/stores/chat/agentTask';

/** 可手动完成的 Promise。 */
interface Deferred<T> {
  /** 未决 Promise。 */
  promise: Promise<T>;
  /** 完成 Promise。 */
  resolve: (value: T) => void;
}

const agentAPI = vi.hoisted(() => ({
  listTasks: vi.fn(),
  getTask: vi.fn()
}));

const loggerAPI = vi.hoisted(() => ({
  error: vi.fn()
}));

vi.mock('@/shared/platform/electron-api', () => ({
  getElectronAPI: (): Record<string, unknown> => ({
    chatAgentListTasks: agentAPI.listTasks,
    chatAgentGetTask: agentAPI.getTask
  })
}));

vi.mock('@/shared/logger', () => ({
  logger: loggerAPI
}));

/**
 * 创建可手动完成的 Promise。
 * @returns Deferred 控制器
 */
function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = (): void => undefined;
  const promise = new Promise<T>((resolve): void => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

/**
 * 创建 Task Summary。
 * @param patch - 可覆盖字段
 * @returns 完整公开 Summary
 */
function createSummary(patch: Partial<ChatAgentTaskSummarySnapshot> = {}): ChatAgentTaskSummarySnapshot {
  return {
    recordState: 'active',
    taskId: 'task-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    checkpointId: 'checkpoint-1',
    assistantMessageId: 'assistant-1',
    toolCallId: 'tool-call-1',
    agentId: 'agent-1',
    projectionSchemaVersion: 1,
    taskSequence: 1,
    task: '读取项目结构',
    mode: 'read',
    required: true,
    priority: 'normal',
    status: 'running',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:01.000Z',
    ...patch
  };
}

/**
 * 创建 Task Detail。
 * @param patch - 可覆盖字段
 * @returns 完整公开 Detail
 */
function createDetail(patch: Partial<ChatAgentTaskDetailSnapshot> = {}): ChatAgentTaskDetailSnapshot {
  return {
    ...createSummary(patch),
    acceptanceCriteria: ['列出关键目录'],
    resources: [],
    timeline: {
      entries: [],
      truncated: false
    },
    warnings: [],
    artifacts: [],
    ...patch
  };
}

/**
 * 创建 Task tombstone。
 * @param patch - 可覆盖字段
 * @returns 最小公开 tombstone
 */
function createTombstone(patch: Partial<ChatAgentTaskTombstoneSnapshot> = {}): ChatAgentTaskTombstoneSnapshot {
  return {
    recordState: 'tombstoned',
    taskId: 'task-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    checkpointId: 'checkpoint-1',
    assistantMessageId: 'assistant-1',
    toolCallId: 'tool-call-1',
    projectionSchemaVersion: 1,
    taskSequence: 3,
    updatedAt: '2026-07-28T00:00:03.000Z',
    ...patch
  };
}

/**
 * 创建成功的列表信封。
 * @param tasks - 当前页 Task
 * @param nextCursor - 下一页 cursor
 * @returns IPC 成功结果
 */
function createPage(tasks: readonly ChatAgentTaskSummarySnapshot[], nextCursor?: string): ChatAgentHandlerResult<ChatAgentListTasksResult> {
  return {
    ok: true,
    data: {
      tasks,
      ...(nextCursor ? { nextCursor } : {})
    }
  };
}

describe('useChatAgentTaskStore', (): void => {
  beforeEach((): void => {
    setActivePinia(createPinia());
    agentAPI.listTasks.mockReset();
    agentAPI.getTask.mockReset();
    loggerAPI.error.mockReset();
  });

  it('encodes every compound-index segment with its UTF-8 byte length', (): void => {
    expect(createTaskIndexKey('会话', 'a:1', '工具')).toBe('6:会话3:a:16:工具');
    expect(createTaskIndexKey('a', 'bc', 'd')).not.toBe(createTaskIndexKey('ab', 'c', 'd'));
  });

  it('keeps a newer event when an older list response arrives later', async (): Promise<void> => {
    const deferred = createDeferred<ChatAgentHandlerResult<ChatAgentListTasksResult>>();
    agentAPI.listTasks.mockReturnValue(deferred.promise);
    const store = useChatAgentTaskStore();
    const recovery = store.ensureSession('session-1');

    expect(store.applySummary(createSummary({ taskSequence: 5, summary: 'event' }))).toBe('applied');
    deferred.resolve(createPage([createSummary({ taskSequence: 3, summary: 'list' })]));
    await recovery;

    expect(store.tasksById['task-1']?.taskSequence).toBe(5);
    expect(store.tasksById['task-1']).toMatchObject({ summary: 'event' });
  });

  it('ignores duplicate and lower sequences but accepts a sequence jump', (): void => {
    const store = useChatAgentTaskStore();
    expect(store.applySummary(createSummary({ taskSequence: 4 }))).toBe('applied');
    expect(store.applySummary(createSummary({ taskSequence: 4, summary: 'duplicate' }))).toBe('stale');
    expect(store.applySummary(createSummary({ taskSequence: 2 }))).toBe('stale');
    expect(store.applySummary(createSummary({ taskSequence: 20, summary: 'jump' }))).toBe('applied');
    expect(store.tasksById['task-1']).toMatchObject({ taskSequence: 20, summary: 'jump' });
  });

  it('rejects immutable identity conflicts without moving cursor or rebuilding the index', (): void => {
    const store = useChatAgentTaskStore();
    const original = createSummary({ taskSequence: 2 });
    store.applySummary(original);

    expect(
      store.applySummary(
        createSummary({
          taskSequence: 3,
          assistantMessageId: 'assistant-conflict',
          toolCallId: 'tool-call-conflict'
        })
      )
    ).toBe('identity_conflict');
    expect(store.taskCursors['task-1']).toBe(2);
    expect(store.findTask('session-1', 'assistant-1', 'tool-call-1')).toEqual(original);
    expect(store.findTask('session-1', 'assistant-conflict', 'tool-call-conflict')).toBeUndefined();
  });

  it('caches equal-sequence detail once and invalidates it on a newer summary', (): void => {
    const store = useChatAgentTaskStore();
    store.applySummary(createSummary({ taskSequence: 2 }));

    expect(store.applyDetail(createDetail({ taskSequence: 2 }))).toBe('applied');
    expect(store.applyDetail(createDetail({ taskSequence: 2 }))).toBe('stale');
    expect(store.detailsById['task-1']?.acceptanceCriteria).toEqual(['列出关键目录']);
    expect(store.tasksById['task-1']).not.toHaveProperty('acceptanceCriteria');

    store.applySummary(createSummary({ taskSequence: 3, summary: 'newer' }));
    expect(store.detailsById['task-1']).toBeUndefined();
  });

  it('keeps tombstones and their index irreversible even against a larger live sequence', (): void => {
    const store = useChatAgentTaskStore();
    store.applyDetail(createDetail({ taskSequence: 2 }));

    expect(store.applySummary(createTombstone())).toBe('applied');
    expect(store.detailsById['task-1']).toBeUndefined();
    expect(store.taskCursors['task-1']).toBe(3);
    expect(store.findTask('session-1', 'assistant-1', 'tool-call-1')?.recordState).toBe('tombstoned');
    expect(store.applySummary(createSummary({ taskSequence: 99 }))).toBe('tombstone_conflict');
    expect(store.tasksById['task-1']?.recordState).toBe('tombstoned');
    expect(store.taskCursors['task-1']).toBe(3);
  });

  it('applies list entries monotonically without deleting omitted tasks or accepting another session', (): void => {
    const store = useChatAgentTaskStore();
    store.applySummary(createSummary({ taskId: 'task-local', taskSequence: 7 }));

    store.applySessionPage('session-1', {
      tasks: [
        createSummary({ taskId: 'task-page', toolCallId: 'tool-page' }),
        createSummary({ taskId: 'task-foreign', sessionId: 'session-2', toolCallId: 'tool-foreign' })
      ],
      nextCursor: 'cursor-2'
    });

    expect(store.tasksById['task-local']).toBeDefined();
    expect(store.tasksById['task-page']).toBeDefined();
    expect(store.tasksById['task-foreign']).toBeUndefined();
    expect(store.sessionNextCursors['session-1']).toBeUndefined();
    expect(store.staleSessions['session-1']).toBe(true);
  });

  it('preserves trusted projections and marks the session stale after list failure', async (): Promise<void> => {
    const store = useChatAgentTaskStore();
    store.applySummary(createSummary({ taskSequence: 4 }));
    agentAPI.listTasks.mockResolvedValue({ ok: false, error: 'redacted failure', code: 'task_list_failed' });

    await store.ensureSession('session-1');

    expect(store.tasksById['task-1']?.taskSequence).toBe(4);
    expect(store.staleSessions['session-1']).toBe(true);
    expect(store.loadedSessions['session-1']).not.toBe(true);
  });

  it('marks an unsupported schema incompatible and only retries it when forced', async (): Promise<void> => {
    const store = useChatAgentTaskStore();
    const incompatible = {
      ...createSummary(),
      projectionSchemaVersion: 2
    } as unknown as ChatAgentTaskSummarySnapshot;
    agentAPI.listTasks.mockResolvedValue(createPage([incompatible]));

    await store.ensureSession('session-1');
    await store.ensureSession('session-1');

    expect(store.incompatibleSessions['session-1']).toBe(true);
    expect(agentAPI.listTasks).toHaveBeenCalledOnce();
    expect(store.tasksById['task-1']).toBeUndefined();

    await store.ensureSession('session-1', { force: true });
    expect(agentAPI.listTasks).toHaveBeenCalledTimes(2);
  });

  it('shares ensure and next-page in-flight promises per session', async (): Promise<void> => {
    const firstPage = createDeferred<ChatAgentHandlerResult<ChatAgentListTasksResult>>();
    const nextPage = createDeferred<ChatAgentHandlerResult<ChatAgentListTasksResult>>();
    agentAPI.listTasks.mockReturnValueOnce(firstPage.promise).mockReturnValueOnce(nextPage.promise);
    const store = useChatAgentTaskStore();

    const firstEnsure = store.ensureSession('session-1');
    const secondEnsure = store.ensureSession('session-1');
    await Promise.resolve();
    expect(agentAPI.listTasks).toHaveBeenCalledOnce();
    firstPage.resolve(createPage([], 'cursor-2'));
    await Promise.all([firstEnsure, secondEnsure]);

    const firstNext = store.loadNextPage('session-1');
    const secondNext = store.loadNextPage('session-1');
    await Promise.resolve();
    expect(agentAPI.listTasks).toHaveBeenCalledTimes(2);
    nextPage.resolve(createPage([]));
    await Promise.all([firstNext, secondNext]);
  });

  it('lets only the newest cross-type generation update session metadata', async (): Promise<void> => {
    const ensurePage = createDeferred<ChatAgentHandlerResult<ChatAgentListTasksResult>>();
    const nextPage = createDeferred<ChatAgentHandlerResult<ChatAgentListTasksResult>>();
    agentAPI.listTasks.mockReturnValueOnce(ensurePage.promise).mockReturnValueOnce(nextPage.promise);
    const store = useChatAgentTaskStore();
    store.sessionNextCursors['session-1'] = 'cursor-old';

    const ensure = store.ensureSession('session-1', { force: true });
    await vi.waitFor((): void => expect(agentAPI.listTasks).toHaveBeenCalledOnce());
    const next = store.loadNextPage('session-1');
    nextPage.resolve({ ok: false, error: 'new failure', code: 'new_failure' });
    await next;
    ensurePage.resolve(createPage([createSummary({ taskSequence: 8 })], 'cursor-stale'));
    await ensure;

    expect(store.tasksById['task-1']?.taskSequence).toBe(8);
    expect(store.staleSessions['session-1']).toBe(true);
    expect(store.sessionNextCursors['session-1']).toBe('cursor-old');
  });

  it('isolates in-flight requests between Pinia instances', async (): Promise<void> => {
    const deferred = createDeferred<ChatAgentHandlerResult<ChatAgentListTasksResult>>();
    agentAPI.listTasks.mockReturnValue(deferred.promise);
    const firstPinia = createPinia();
    const secondPinia = createPinia();
    const first = useChatAgentTaskStore(firstPinia);
    const second = useChatAgentTaskStore(secondPinia);

    const firstRequest = first.ensureSession('session-1');
    const secondRequest = second.ensureSession('session-1');
    await Promise.resolve();
    expect(agentAPI.listTasks).toHaveBeenCalledTimes(2);
    deferred.resolve(createPage([]));
    await Promise.all([firstRequest, secondRequest]);
  });

  it('rejects a directed detail whose response identity does not match the request', async (): Promise<void> => {
    const store = useChatAgentTaskStore();
    agentAPI.getTask.mockResolvedValue({
      ok: true,
      data: createDetail({ sessionId: 'session-2' })
    } satisfies ChatAgentHandlerResult<ChatAgentGetTaskResult>);

    await expect(store.ensureTask('session-1', 'task-1')).resolves.toBeNull();
    expect(store.tasksById['task-1']).toBeUndefined();
    expect(store.detailsById['task-1']).toBeUndefined();
  });

  it('rejects a scoped response position before mutating any global projection state', async (): Promise<void> => {
    const store = useChatAgentTaskStore();
    agentAPI.getTask.mockResolvedValue({
      ok: true,
      data: createDetail({
        assistantMessageId: 'assistant-other',
        toolCallId: 'tool-other',
        task: 'SECRET_WRONG_POSITION'
      })
    } satisfies ChatAgentHandlerResult<ChatAgentGetTaskResult>);

    await expect(
      store.ensureTask('session-1', 'task-1', {
        assistantMessageId: 'assistant-1',
        toolCallId: 'tool-call-1'
      })
    ).rejects.toMatchObject({
      code: 'agent_task_projection_invalid'
    });

    expect(store.tasksById['task-1']).toBeUndefined();
    expect(store.detailsById['task-1']).toBeUndefined();
    expect(store.taskCursors['task-1']).toBeUndefined();
    expect(store.findTask('session-1', 'assistant-other', 'tool-other')).toBeUndefined();
    expect(Object.values(store.taskIdsByMessageToolCall)).not.toContain('task-1');
  });

  it('does not merge scoped and unscoped directed flights', async (): Promise<void> => {
    const unscopedResponse = createDeferred<ChatAgentHandlerResult<ChatAgentGetTaskResult>>();
    const scopedResponse = createDeferred<ChatAgentHandlerResult<ChatAgentGetTaskResult>>();
    agentAPI.getTask.mockReturnValueOnce(unscopedResponse.promise).mockReturnValueOnce(scopedResponse.promise);
    const store = useChatAgentTaskStore();
    store.applySummary(createSummary());

    const unscoped = store.ensureTask('session-1', 'task-1');
    const scoped = store.ensureTask('session-1', 'task-1', {
      assistantMessageId: 'assistant-1',
      toolCallId: 'tool-call-1'
    });
    await Promise.resolve();

    expect(agentAPI.getTask).toHaveBeenCalledTimes(2);
    unscopedResponse.resolve({ ok: true, data: createDetail() });
    scopedResponse.resolve({ ok: true, data: createDetail() });
    await Promise.all([unscoped, scoped]);
  });

  it('queues one forced refresh behind an existing ensure flight', async (): Promise<void> => {
    const initialPage = createDeferred<ChatAgentHandlerResult<ChatAgentListTasksResult>>();
    const forcedPage = createDeferred<ChatAgentHandlerResult<ChatAgentListTasksResult>>();
    agentAPI.listTasks.mockReturnValueOnce(initialPage.promise).mockReturnValueOnce(forcedPage.promise);
    const store = useChatAgentTaskStore();

    const initial = store.ensureSession('session-1');
    await Promise.resolve();
    const firstForce = store.ensureSession('session-1', { force: true });
    const secondForce = store.ensureSession('session-1', { force: true });
    expect(agentAPI.listTasks).toHaveBeenCalledOnce();

    initialPage.resolve(createPage([createSummary({ taskSequence: 1 })]));
    await initial;
    await Promise.resolve();
    await Promise.resolve();
    expect(agentAPI.listTasks).toHaveBeenCalledTimes(2);

    forcedPage.resolve(createPage([createSummary({ taskSequence: 2 })]));
    await Promise.all([firstForce, secondForce]);
    expect(store.tasksById['task-1']?.taskSequence).toBe(2);
  });

  it('prevents an older compatible list from clearing an incompatible event epoch', async (): Promise<void> => {
    const initialPage = createDeferred<ChatAgentHandlerResult<ChatAgentListTasksResult>>();
    agentAPI.listTasks.mockReturnValue(initialPage.promise);
    const store = useChatAgentTaskStore();
    const initial = store.ensureSession('session-1');
    await Promise.resolve();
    const incompatible = {
      ...createSummary({ taskSequence: 4 }),
      projectionSchemaVersion: 2
    } as unknown as ChatAgentTaskSummarySnapshot;

    expect(store.applySummary(incompatible)).toBe('schema_incompatible');
    initialPage.resolve(createPage([createSummary({ taskSequence: 3 })], 'cursor-old'));
    await initial;

    expect(store.tasksById['task-1']?.taskSequence).toBe(3);
    expect(store.incompatibleSessions['session-1']).toBe(true);
    expect(store.loadedSessions['session-1']).not.toBe(true);
    expect(store.sessionNextCursors['session-1']).toBeUndefined();
  });

  it('returns null when an in-flight Detail becomes stale behind a newer Summary', async (): Promise<void> => {
    const deferred = createDeferred<ChatAgentHandlerResult<ChatAgentGetTaskResult>>();
    agentAPI.getTask.mockReturnValue(deferred.promise);
    const store = useChatAgentTaskStore();
    store.applySummary(createSummary({ taskSequence: 2 }));
    const detailRequest = store.ensureTask('session-1', 'task-1');
    await Promise.resolve();

    store.applySummary(createSummary({ taskSequence: 3, summary: 'newer' }));
    deferred.resolve({ ok: true, data: createDetail({ taskSequence: 2 }) });

    await expect(detailRequest).resolves.toBeNull();
    expect(store.detailsById['task-1']).toBeUndefined();
    expect(store.tasksById['task-1']?.taskSequence).toBe(3);
  });

  it('does not commit page metadata when one item conflicts but still applies compatible items', async (): Promise<void> => {
    const store = useChatAgentTaskStore();
    store.applySummary(createSummary({ taskSequence: 1 }));
    agentAPI.listTasks.mockResolvedValue(
      createPage(
        [
          createSummary({ taskSequence: 2, assistantMessageId: 'assistant-conflict' }),
          createSummary({ taskId: 'task-2', toolCallId: 'tool-call-2', taskSequence: 3 })
        ],
        'cursor-conflict'
      )
    );
    agentAPI.getTask.mockResolvedValue({ ok: true, data: null });

    await store.ensureSession('session-1', { force: true });
    await Promise.resolve();

    expect(store.tasksById['task-1']?.taskSequence).toBe(1);
    expect(store.tasksById['task-2']?.taskSequence).toBe(3);
    expect(store.loadedSessions['session-1']).not.toBe(true);
    expect(store.sessionNextCursors['session-1']).toBeUndefined();
    expect(store.staleSessions['session-1']).toBe(true);
    expect(agentAPI.getTask).toHaveBeenCalledOnce();
    expect(agentAPI.getTask).toHaveBeenCalledWith({ sessionId: 'session-1', taskId: 'task-1' });
  });

  it('fails closed for tombstone, invalid and cross-Session page items with bounded directed recovery', async (): Promise<void> => {
    const store = useChatAgentTaskStore();
    store.applySummary(createTombstone({ taskId: 'task-tomb', toolCallId: 'tool-tomb', taskSequence: 3 }));
    agentAPI.listTasks.mockResolvedValue(
      createPage(
        [
          createSummary({ taskId: 'task-tomb', toolCallId: 'tool-tomb', taskSequence: 4 }),
          createSummary({ taskId: '', toolCallId: 'tool-invalid', taskSequence: 5 }),
          createSummary({ taskId: 'task-foreign', sessionId: 'session-2', toolCallId: 'tool-foreign', taskSequence: 6 }),
          createSummary({ taskId: 'task-compatible', toolCallId: 'tool-compatible', taskSequence: 7 })
        ],
        'cursor-rejected'
      )
    );
    agentAPI.getTask.mockResolvedValue({ ok: true, data: null });

    await store.ensureSession('session-1', { force: true });
    await Promise.resolve();

    expect(store.tasksById['task-tomb']?.recordState).toBe('tombstoned');
    expect(store.tasksById['task-compatible']?.taskSequence).toBe(7);
    expect(store.tasksById['task-foreign']).toBeUndefined();
    expect(store.loadedSessions['session-1']).not.toBe(true);
    expect(store.sessionNextCursors['session-1']).toBeUndefined();
    expect(store.staleSessions['session-1']).toBe(true);
    expect(agentAPI.getTask).toHaveBeenCalledTimes(2);
    expect(agentAPI.getTask).toHaveBeenCalledWith({ sessionId: 'session-1', taskId: 'task-tomb' });
    expect(agentAPI.getTask).toHaveBeenCalledWith({ sessionId: 'session-1', taskId: 'task-foreign' });
  });

  it('restores Summary, index and Detail from an equal cursor-only state', (): void => {
    const store = useChatAgentTaskStore();
    store.taskCursors['task-1'] = 7;

    expect(store.applyDetail(createDetail({ taskSequence: 7 }))).toBe('applied');
    expect(store.tasksById['task-1']).toMatchObject({ recordState: 'active', taskSequence: 7 });
    expect(store.detailsById['task-1']?.taskSequence).toBe(7);
    expect(store.findTask('session-1', 'assistant-1', 'tool-call-1')?.taskId).toBe('task-1');
  });

  it('rejects two task IDs that contend for the same compound index', (): void => {
    const store = useChatAgentTaskStore();
    store.applySummary(createSummary({ taskId: 'task-first' }));

    expect(store.applySummary(createSummary({ taskId: 'task-second', taskSequence: 2 }))).toBe('identity_conflict');
    expect(store.findTask('session-1', 'assistant-1', 'tool-call-1')?.taskId).toBe('task-first');
    expect(store.tasksById['task-second']).toBeUndefined();
  });

  it('merges concurrent directed Task requests into one IPC flight', async (): Promise<void> => {
    const deferred = createDeferred<ChatAgentHandlerResult<ChatAgentGetTaskResult>>();
    agentAPI.getTask.mockReturnValue(deferred.promise);
    const store = useChatAgentTaskStore();
    store.applySummary(createSummary());

    const first = store.ensureTask('session-1', 'task-1');
    const second = store.ensureTask('session-1', 'task-1');
    await Promise.resolve();
    expect(agentAPI.getTask).toHaveBeenCalledOnce();

    deferred.resolve({ ok: true, data: createDetail() });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult?.recordState).toBe('active');
    expect(secondResult?.recordState).toBe('active');
  });

  it('recovers a directed tombstone without inventing a live Detail', async (): Promise<void> => {
    agentAPI.getTask.mockResolvedValue({ ok: true, data: createTombstone({ taskSequence: 8 }) });
    const store = useChatAgentTaskStore();

    await expect(store.ensureTask('session-1', 'task-1')).resolves.toEqual(createTombstone({ taskSequence: 8 }));
    expect(store.tasksById['task-1']?.recordState).toBe('tombstoned');
    expect(store.detailsById['task-1']).toBeUndefined();
  });

  it('applies compatible items from a mixed-schema page without committing success metadata', async (): Promise<void> => {
    const incompatible = {
      ...createSummary({ taskId: 'task-v2', toolCallId: 'tool-v2' }),
      projectionSchemaVersion: 2
    } as unknown as ChatAgentTaskSummarySnapshot;
    agentAPI.listTasks.mockResolvedValue(
      createPage([createSummary({ taskId: 'task-compatible', toolCallId: 'tool-compatible', taskSequence: 5 }), incompatible], 'cursor-mixed')
    );
    const store = useChatAgentTaskStore();

    await store.ensureSession('session-1');

    expect(store.tasksById['task-compatible']?.taskSequence).toBe(5);
    expect(store.tasksById['task-v2']).toBeUndefined();
    expect(store.incompatibleSessions['session-1']).toBe(true);
    expect(store.loadedSessions['session-1']).not.toBe(true);
    expect(store.sessionNextCursors['session-1']).toBeUndefined();
  });

  it('keeps newer successful page metadata when an older ensure later fails', async (): Promise<void> => {
    const oldEnsure = createDeferred<ChatAgentHandlerResult<ChatAgentListTasksResult>>();
    const newPage = createDeferred<ChatAgentHandlerResult<ChatAgentListTasksResult>>();
    agentAPI.listTasks.mockReturnValueOnce(oldEnsure.promise).mockReturnValueOnce(newPage.promise);
    const store = useChatAgentTaskStore();
    store.sessionNextCursors['session-1'] = 'cursor-start';

    const ensure = store.ensureSession('session-1', { force: true });
    await vi.waitFor((): void => expect(agentAPI.listTasks).toHaveBeenCalledOnce());
    const next = store.loadNextPage('session-1');
    await Promise.resolve();
    newPage.resolve(createPage([createSummary({ taskSequence: 9 })], 'cursor-new'));
    await next;
    oldEnsure.resolve({ ok: false, error: 'old failure', code: 'old_failure' });
    await ensure;

    expect(store.loadedSessions['session-1']).toBe(true);
    expect(store.staleSessions['session-1']).toBe(false);
    expect(store.sessionNextCursors['session-1']).toBe('cursor-new');
    expect(store.tasksById['task-1']?.taskSequence).toBe(9);
  });

  it('queues one trailing force when schema invalidates an active forced request', async (): Promise<void> => {
    const activeForce = createDeferred<ChatAgentHandlerResult<ChatAgentListTasksResult>>();
    const trailingForce = createDeferred<ChatAgentHandlerResult<ChatAgentListTasksResult>>();
    agentAPI.listTasks.mockReturnValueOnce(activeForce.promise).mockReturnValueOnce(trailingForce.promise);
    const store = useChatAgentTaskStore();
    const firstForce = store.ensureSession('session-1', { force: true });
    await vi.waitFor((): void => expect(agentAPI.listTasks).toHaveBeenCalledOnce());
    const incompatible = {
      ...createSummary({ taskSequence: 4 }),
      projectionSchemaVersion: 2
    } as unknown as ChatAgentTaskSummarySnapshot;

    store.applySummary(incompatible);
    const secondForce = store.ensureSession('session-1', { force: true });
    activeForce.resolve(createPage([createSummary({ taskSequence: 3 })], 'cursor-invalidated'));
    await vi.waitFor((): void => expect(agentAPI.listTasks).toHaveBeenCalledTimes(2));
    expect(store.incompatibleSessions['session-1']).toBe(true);
    expect(store.sessionNextCursors['session-1']).toBeUndefined();

    trailingForce.resolve(createPage([createSummary({ taskSequence: 5 })], 'cursor-trailing'));
    await Promise.all([firstForce, secondForce]);
    expect(store.incompatibleSessions['session-1']).toBe(false);
    expect(store.loadedSessions['session-1']).toBe(true);
    expect(store.sessionNextCursors['session-1']).toBe('cursor-trailing');
  });

  it('does not clear a page conflict streak with a stale page item', async (): Promise<void> => {
    const store = useChatAgentTaskStore();
    store.applySummary(createSummary({ taskSequence: 5 }));
    agentAPI.listTasks
      .mockResolvedValueOnce(createPage([createSummary({ taskSequence: 6, assistantMessageId: 'assistant-conflict' })]))
      .mockResolvedValueOnce(createPage([createSummary({ taskSequence: 4 })]))
      .mockResolvedValueOnce(createPage([createSummary({ taskSequence: 7, assistantMessageId: 'assistant-conflict' })]));
    agentAPI.getTask.mockResolvedValue({ ok: true, data: null });

    await store.ensureSession('session-1', { force: true });
    await vi.waitFor((): void => expect(agentAPI.getTask).toHaveBeenCalledOnce());
    await store.ensureSession('session-1', { force: true });
    await store.ensureSession('session-1', { force: true });

    expect(agentAPI.getTask).toHaveBeenCalledOnce();
  });

  it('rejects equal cursor-only Detail when a retained index points to another immutable position', (): void => {
    const store = useChatAgentTaskStore();
    store.taskCursors['task-1'] = 7;
    store.taskIdsByMessageToolCall[createTaskIndexKey('session-1', 'assistant-old', 'tool-old')] = 'task-1';

    expect(
      store.applyDetail(
        createDetail({
          taskSequence: 7,
          assistantMessageId: 'assistant-new',
          toolCallId: 'tool-new'
        })
      )
    ).toBe('identity_conflict');
    expect(store.tasksById['task-1']).toBeUndefined();
    expect(store.detailsById['task-1']).toBeUndefined();
    expect(store.findTask('session-1', 'assistant-new', 'tool-new')).toBeUndefined();
  });

  it('consumes an unexpected directed page-recovery rejection with a stable log', async (): Promise<void> => {
    const throwingSnapshot = new Proxy(createDetail({ taskSequence: 2 }), {
      /**
       * 仅在投影判别读取阶段模拟不可预期异常。
       * @param target - 原始 Detail
       * @param property - 当前读取键
       * @param receiver - Proxy receiver
       * @returns 其他字段的原始值
       */
      get(target: ChatAgentTaskDetailSnapshot, property: string | symbol, receiver: object): unknown {
        if (property === 'recordState') throw new Error('sensitive projection failure');
        return Reflect.get(target, property, receiver);
      }
    });
    const store = useChatAgentTaskStore();
    store.applySummary(createSummary());
    agentAPI.getTask.mockResolvedValue({ ok: true, data: throwingSnapshot });

    store.applySessionPage('session-1', {
      tasks: [createSummary({ taskSequence: 2, assistantMessageId: 'assistant-conflict' })]
    });

    await vi.waitFor((): void =>
      expect(loggerAPI.error).toHaveBeenCalledWith('[chat-agent-task-page-recovery-failed] sessionId=session-1 taskId=task-1 code=projection_recovery_failed')
    );
  });
});
