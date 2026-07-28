/**
 * @file use-agent-task-events.test.ts
 * @description Renderer Child Task application event 的根级监听、校验与有界恢复测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import type {
  ChatAgentApplicationEvent,
  ChatAgentGetTaskResult,
  ChatAgentHandlerResult,
  ChatAgentListTasksResult,
  ChatAgentTaskSummarySnapshot
} from 'types/chat-agent';
import { defineComponent, effectScope, h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { mount, shallowMount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useActorSystem, useProvideActorSystem } from '@/hooks/useChat/useActorSystem';
import { useAgentTaskEvents } from '@/hooks/useChat/useAgentTaskEvents';
import { useChatAgentTaskStore } from '@/stores/chat/agentTask';

/** 可手动完成的 Promise。 */
interface Deferred<T> {
  /** 未决 Promise。 */
  promise: Promise<T>;
  /** 完成 Promise。 */
  resolve: (value: T) => void;
}

const agentAPI = vi.hoisted(() => ({
  listener: undefined as ((event: ChatAgentApplicationEvent) => void) | undefined,
  onEvent: vi.fn(),
  dispose: vi.fn(),
  listTasks: vi.fn(),
  getTask: vi.fn()
}));

const loggerAPI = vi.hoisted(() => ({
  error: vi.fn()
}));

vi.mock('@/shared/platform/electron-api', () => ({
  getElectronAPI: (): Record<string, unknown> => ({
    chatAgentOnEvent: agentAPI.onEvent,
    chatAgentListTasks: agentAPI.listTasks,
    chatAgentGetTask: agentAPI.getTask
  })
}));

vi.mock('@/shared/logger', () => ({
  logger: loggerAPI
}));

// Actor root wiring is isolated from existing Runtime/Checkpoint recovery hooks.
vi.mock('@/hooks/useChat/useRuntimeEvents', () => ({
  useRuntimeEvents: vi.fn()
}));

vi.mock('@/hooks/useChat/useAgentDelegationEvents', () => ({
  useAgentDelegationEvents: vi.fn()
}));

vi.mock('@/hooks/useChat/useRuntimeRecovery', () => ({
  useRuntimeRecovery: vi.fn()
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
 * 创建公开 Task Summary。
 * @param patch - 可覆盖字段
 * @returns 完整 Summary
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
 * 创建 Task updated event。
 * @param task - Task Summary
 * @param taskSequence - 可覆盖外层 sequence
 * @returns application event
 */
function createEvent(task: ChatAgentTaskSummarySnapshot, taskSequence = task.taskSequence): ChatAgentApplicationEvent {
  return {
    schemaVersion: 1,
    type: 'task.updated',
    task,
    taskSequence
  };
}

describe('useAgentTaskEvents', (): void => {
  beforeEach((): void => {
    setActivePinia(createPinia());
    agentAPI.listener = undefined;
    agentAPI.onEvent.mockReset();
    agentAPI.onEvent.mockImplementation((listener: (event: ChatAgentApplicationEvent) => void): (() => void) => {
      agentAPI.listener = listener;
      return agentAPI.dispose;
    });
    agentAPI.dispose.mockReset();
    agentAPI.listTasks.mockReset();
    agentAPI.listTasks.mockResolvedValue({
      ok: true,
      data: { tasks: [] }
    } satisfies ChatAgentHandlerResult<ChatAgentListTasksResult>);
    agentAPI.getTask.mockReset();
    agentAPI.getTask.mockResolvedValue({ ok: true, data: null });
    loggerAPI.error.mockReset();
  });

  it('subscribes without listing and applies only task.updated events', (): void => {
    const scope = effectScope();
    scope.run((): void => useAgentTaskEvents());

    expect(agentAPI.onEvent).toHaveBeenCalledOnce();
    expect(agentAPI.listTasks).not.toHaveBeenCalled();
    agentAPI.listener?.(createEvent(createSummary({ taskSequence: 4 })));

    expect(useChatAgentTaskStore().tasksById['task-1']?.taskSequence).toBe(4);
    scope.stop();
    expect(agentAPI.dispose).toHaveBeenCalledOnce();
  });

  it('rejects mismatched outer sequence and bounds each active Session recovery flight', async (): Promise<void> => {
    const deferred = createDeferred<ChatAgentHandlerResult<ChatAgentListTasksResult>>();
    agentAPI.listTasks.mockReturnValue(deferred.promise);
    const scope = effectScope();
    scope.run((): void => useAgentTaskEvents());
    const store = useChatAgentTaskStore();

    agentAPI.listener?.(createEvent(createSummary({ taskSequence: 2 }), 3));
    agentAPI.listener?.(createEvent(createSummary({ taskSequence: 4 }), 5));
    expect(store.tasksById['task-1']).toBeUndefined();
    await vi.waitFor((): void => expect(agentAPI.listTasks).toHaveBeenCalledOnce());

    deferred.resolve({ ok: true, data: { tasks: [] } });
    await vi.waitFor((): void => expect(store.loadedSessions['session-1']).toBe(true));
    agentAPI.listener?.(createEvent(createSummary({ taskSequence: 6 }), 7));
    await vi.waitFor((): void => expect(agentAPI.listTasks).toHaveBeenCalledTimes(2));
    expect(loggerAPI.error).toHaveBeenCalledWith('[chat-agent-task-event-sequence-mismatch] sessionId=session-1 taskId=task-1');
    scope.stop();
  });

  it('bounds directed recovery for repeated identity conflicts', async (): Promise<void> => {
    const scope = effectScope();
    scope.run((): void => useAgentTaskEvents());
    agentAPI.listener?.(createEvent(createSummary()));

    agentAPI.listener?.(
      createEvent(
        createSummary({
          taskSequence: 2,
          assistantMessageId: 'assistant-conflict'
        })
      )
    );
    agentAPI.listener?.(
      createEvent(
        createSummary({
          taskSequence: 3,
          assistantMessageId: 'assistant-conflict'
        })
      )
    );
    await vi.waitFor((): void => expect(agentAPI.getTask).toHaveBeenCalledOnce());
    expect(useChatAgentTaskStore().taskCursors['task-1']).toBe(1);
    expect(loggerAPI.error).toHaveBeenCalledWith('[chat-agent-task-identity-conflict] sessionId=session-1 taskId=task-1');
    scope.stop();
  });

  it('does not recursively recover an incompatible event schema', (): void => {
    const scope = effectScope();
    scope.run((): void => useAgentTaskEvents());
    const incompatible = {
      ...createSummary(),
      projectionSchemaVersion: 2
    } as unknown as ChatAgentTaskSummarySnapshot;

    agentAPI.listener?.(createEvent(incompatible));
    agentAPI.listener?.(createEvent(incompatible));
    expect(useChatAgentTaskStore().incompatibleSessions['session-1']).toBe(true);
    expect(agentAPI.listTasks).not.toHaveBeenCalled();
    expect(agentAPI.getTask).not.toHaveBeenCalled();
    expect(loggerAPI.error).toHaveBeenCalledWith('[chat-agent-task-schema-incompatible] sessionId=session-1 taskId=task-1');
    scope.stop();
  });

  it('registers the Task listener only at the application root', (): void => {
    const RootHarness = defineComponent({
      name: 'RootHarness',
      setup(): () => ReturnType<typeof h> {
        useProvideActorSystem();
        return (): ReturnType<typeof h> => h('div');
      }
    });
    const FallbackHarness = defineComponent({
      name: 'FallbackHarness',
      setup(): () => ReturnType<typeof h> {
        useActorSystem();
        return (): ReturnType<typeof h> => h('div');
      }
    });

    const root = shallowMount(RootHarness);
    expect(agentAPI.onEvent).toHaveBeenCalledOnce();
    const fallback = shallowMount(FallbackHarness);
    expect(agentAPI.onEvent).toHaveBeenCalledOnce();

    fallback.unmount();
    expect(agentAPI.dispose).not.toHaveBeenCalled();
    root.unmount();
    expect(agentAPI.dispose).toHaveBeenCalledOnce();
  });

  it('queues one real forced list behind an active ensure and resets recovery after a valid event', async (): Promise<void> => {
    const initialPage = createDeferred<ChatAgentHandlerResult<ChatAgentListTasksResult>>();
    const firstRecovery = createDeferred<ChatAgentHandlerResult<ChatAgentListTasksResult>>();
    const secondRecovery = createDeferred<ChatAgentHandlerResult<ChatAgentListTasksResult>>();
    agentAPI.listTasks.mockReturnValueOnce(initialPage.promise).mockReturnValueOnce(firstRecovery.promise).mockReturnValueOnce(secondRecovery.promise);
    const scope = effectScope();
    scope.run((): void => useAgentTaskEvents());
    const store = useChatAgentTaskStore();
    const initial = store.ensureSession('session-1');
    await Promise.resolve();

    agentAPI.listener?.(createEvent(createSummary({ taskSequence: 2 }), 3));
    agentAPI.listener?.(createEvent(createSummary({ taskSequence: 2 }), 3));
    initialPage.resolve({ ok: true, data: { tasks: [] } });
    await initial;
    await vi.waitFor((): void => expect(agentAPI.listTasks).toHaveBeenCalledTimes(2));

    firstRecovery.resolve({ ok: true, data: { tasks: [] } });
    await vi.waitFor((): void => expect(store.loadedSessions['session-1']).toBe(true));
    agentAPI.listener?.(createEvent(createSummary({ taskSequence: 4 })));
    agentAPI.listener?.(createEvent(createSummary({ taskSequence: 5 }), 6));
    await vi.waitFor((): void => expect(agentAPI.listTasks).toHaveBeenCalledTimes(3));

    secondRecovery.resolve({ ok: true, data: { tasks: [] } });
    await Promise.resolve();
    scope.stop();
  });

  it('starts a new bounded recovery for a different mismatch signature after the prior list settles', async (): Promise<void> => {
    const scope = effectScope();
    scope.run((): void => useAgentTaskEvents());
    const store = useChatAgentTaskStore();

    agentAPI.listener?.(createEvent(createSummary({ taskSequence: 2 }), 3));
    await vi.waitFor((): void => expect(store.loadedSessions['session-1']).toBe(true));
    expect(agentAPI.listTasks).toHaveBeenCalledOnce();

    agentAPI.listener?.(createEvent(createSummary({ taskSequence: 4 }), 5));
    await vi.waitFor((): void => expect(agentAPI.listTasks).toHaveBeenCalledTimes(2));
    scope.stop();
  });

  it('forces one validating list when a supported event reaches an incompatible Session', async (): Promise<void> => {
    const scope = effectScope();
    scope.run((): void => useAgentTaskEvents());
    const incompatible = {
      ...createSummary({ taskSequence: 2 }),
      projectionSchemaVersion: 2
    } as unknown as ChatAgentTaskSummarySnapshot;
    const store = useChatAgentTaskStore();
    expect(store.applySummary(incompatible)).toBe('schema_incompatible');

    agentAPI.listener?.(createEvent(createSummary({ taskSequence: 3 })));
    await vi.waitFor((): void => expect(store.incompatibleSessions['session-1']).toBe(false));

    expect(store.tasksById['task-1']?.taskSequence).toBe(3);
    expect(agentAPI.listTasks).toHaveBeenCalledOnce();
    scope.stop();
  });

  it('subscribes before a root child ensures its Session and keeps the listener after child unmount', async (): Promise<void> => {
    const callOrder: string[] = [];
    agentAPI.onEvent.mockImplementation((listener: (event: ChatAgentApplicationEvent) => void): (() => void) => {
      callOrder.push('subscribe');
      agentAPI.listener = listener;
      return agentAPI.dispose;
    });
    agentAPI.listTasks.mockImplementation(async (): Promise<ChatAgentHandlerResult<ChatAgentListTasksResult>> => {
      callOrder.push('list');
      return { ok: true, data: { tasks: [] } };
    });
    const ActiveChild = defineComponent({
      name: 'ActiveChild',
      setup(): () => ReturnType<typeof h> {
        useActorSystem();
        useChatAgentTaskStore().ensureSession('session-root');
        return (): ReturnType<typeof h> => h('div');
      }
    });
    const RootWithChild = defineComponent({
      name: 'RootWithChild',
      props: {
        show: {
          type: Boolean,
          required: true
        }
      },
      setup(props): () => ReturnType<typeof h> {
        useProvideActorSystem();
        return (): ReturnType<typeof h> => h('div', props.show ? [h(ActiveChild)] : []);
      }
    });

    const root = mount(RootWithChild, { props: { show: true } });
    await vi.waitFor((): void => expect(callOrder.slice(0, 2)).toEqual(['subscribe', 'list']));

    await root.setProps({ show: false });
    expect(agentAPI.dispose).not.toHaveBeenCalled();
    root.unmount();
    expect(agentAPI.dispose).toHaveBeenCalledOnce();
  });

  it('queues one trailing list when a different mismatch signature arrives during an active forced list', async (): Promise<void> => {
    const activeRecovery = createDeferred<ChatAgentHandlerResult<ChatAgentListTasksResult>>();
    const trailingRecovery = createDeferred<ChatAgentHandlerResult<ChatAgentListTasksResult>>();
    agentAPI.listTasks.mockReturnValueOnce(activeRecovery.promise).mockReturnValueOnce(trailingRecovery.promise);
    const scope = effectScope();
    scope.run((): void => useAgentTaskEvents());

    agentAPI.listener?.(createEvent(createSummary({ taskSequence: 2 }), 3));
    await vi.waitFor((): void => expect(agentAPI.listTasks).toHaveBeenCalledOnce());
    agentAPI.listener?.(createEvent(createSummary({ taskSequence: 4 }), 5));
    activeRecovery.resolve({ ok: true, data: { tasks: [] } });
    await vi.waitFor((): void => expect(agentAPI.listTasks).toHaveBeenCalledTimes(2));

    trailingRecovery.resolve({ ok: true, data: { tasks: [] } });
    await vi.waitFor((): void => expect(useChatAgentTaskStore().loadedSessions['session-1']).toBe(true));
    scope.stop();
  });

  it('does not reset directed conflict recovery after a stale trusted duplicate', async (): Promise<void> => {
    const firstRecovery = createDeferred<ChatAgentHandlerResult<ChatAgentGetTaskResult>>();
    agentAPI.getTask.mockReturnValueOnce(firstRecovery.promise).mockReturnValueOnce(
      new Promise<ChatAgentHandlerResult<ChatAgentGetTaskResult>>((): void => {
        // 第二次恢复保持未决，以便准确观察是否错误重置了预算。
      })
    );
    const scope = effectScope();
    scope.run((): void => useAgentTaskEvents());
    const store = useChatAgentTaskStore();
    agentAPI.listener?.(createEvent(createSummary({ taskSequence: 5 })));

    agentAPI.listener?.(createEvent(createSummary({ taskSequence: 6, assistantMessageId: 'assistant-conflict' })));
    const joinedRecovery = store.ensureTask('session-1', 'task-1');
    firstRecovery.resolve({ ok: true, data: null });
    await joinedRecovery;

    agentAPI.listener?.(createEvent(createSummary({ taskSequence: 5 })));
    agentAPI.listener?.(createEvent(createSummary({ taskSequence: 7, assistantMessageId: 'assistant-conflict' })));
    await Promise.resolve();

    expect(agentAPI.getTask).toHaveBeenCalledOnce();
    scope.stop();
  });

  it('does not treat a stale supported duplicate as evidence that Main schema recovered', async (): Promise<void> => {
    const scope = effectScope();
    scope.run((): void => useAgentTaskEvents());
    const store = useChatAgentTaskStore();
    store.applySummary(createSummary({ taskSequence: 5 }));
    const incompatible = {
      ...createSummary({ taskSequence: 6 }),
      projectionSchemaVersion: 2
    } as unknown as ChatAgentTaskSummarySnapshot;
    store.applySummary(incompatible);

    agentAPI.listener?.(createEvent(createSummary({ taskSequence: 5 })));
    agentAPI.listener?.(createEvent(createSummary({ taskSequence: 5 })));
    await Promise.resolve();
    await store.ensureSession('session-1');

    expect(agentAPI.listTasks).not.toHaveBeenCalled();
    expect(store.incompatibleSessions['session-1']).toBe(true);
    scope.stop();
  });
});
