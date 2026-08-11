/**
 * @file use-runtime-events.test.ts
 * @description 应用级 ChatRuntime 事件路由 hook 测试。
 * @vitest-environment jsdom
 */
import type { AIToolContext, AIToolExecutor } from 'types/ai';
import type { ChatAgentCheckpointSnapshot } from 'types/chat-agent';
import type {
  ChatRuntimeCompleteEvent,
  ChatRuntimeConfirmationRequestEvent,
  ChatRuntimeContextUsageEvent,
  ChatRuntimeErrorEvent,
  ChatRuntimeMessageDeletedEvent,
  ChatRuntimeMessageDeltaEvent,
  ChatRuntimeMessageEvent,
  ChatRuntimeToolCancelledEvent,
  ChatRuntimeToolRequestEvent
} from 'types/chat-runtime';
import type { ElectronShellCommandOutputChunk, ElectronShellRunEventEnvelope } from 'types/electron-api';
import { effectScope, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatActorSystem } from '@/ai/chat/actorSystem';
import { createShellCommandId } from '@/ai/tools/shellCommandId';
import { createChatConfirmationController } from '@/components/BChat/utils/confirmationController';
import { useRuntimeEvents } from '@/hooks/useChat/useRuntimeEvents';
import { useChatConfirmationQueueStore } from '@/stores/chat/confirmationQueue';
import { useChatPermissionStore } from '@/stores/chat/permission';
import { useChatTabStore } from '@/stores/chat/tab';
import { useTabsStore } from '@/stores/workspace/tabs';

const runtimeListeners = vi.hoisted(() => ({
  messageCreated: undefined as ((event: ChatRuntimeMessageEvent) => void) | undefined,
  messageUpdated: undefined as ((event: ChatRuntimeMessageEvent) => void) | undefined,
  messageDelta: undefined as ((event: ChatRuntimeMessageDeltaEvent) => void) | undefined,
  messageDeleted: undefined as ((event: ChatRuntimeMessageDeletedEvent) => void) | undefined,
  contextUsage: undefined as ((event: ChatRuntimeContextUsageEvent) => void) | undefined,
  confirmation: undefined as ((event: ChatRuntimeConfirmationRequestEvent) => void) | undefined,
  toolRequest: undefined as ((event: ChatRuntimeToolRequestEvent) => void) | undefined,
  toolCancelled: undefined as ((event: ChatRuntimeToolCancelledEvent) => void) | undefined,
  shellOutput: undefined as ((event: ElectronShellCommandOutputChunk) => void) | undefined,
  shellRunEvent: undefined as ((event: ElectronShellRunEventEnvelope) => void) | undefined,
  complete: undefined as ((event: ChatRuntimeCompleteEvent) => void) | undefined,
  error: undefined as ((event: ChatRuntimeErrorEvent) => void) | undefined
}));

const runtimeCommands = vi.hoisted(() => ({
  submitConfirmation: vi.fn(),
  submitToolActivity: vi.fn(),
  submitToolResult: vi.fn()
}));

/** 测试中的 preload 能力开关。 */
const preloadCapabilities = vi.hoisted(() => ({
  /** 是否暴露普通 Shell 管道输出监听器。 */
  shellOutput: true
}));

vi.mock('@/shared/platform/electron-api', () => ({
  getElectronAPI: vi.fn(() => ({
    chatRuntimeOnMessageCreated: vi.fn((listener: (event: ChatRuntimeMessageEvent) => void): (() => void) => {
      runtimeListeners.messageCreated = listener;
      return vi.fn();
    }),
    chatRuntimeOnMessageUpdated: vi.fn((listener: (event: ChatRuntimeMessageEvent) => void): (() => void) => {
      runtimeListeners.messageUpdated = listener;
      return vi.fn();
    }),
    chatRuntimeOnMessageDelta: vi.fn((listener: (event: ChatRuntimeMessageDeltaEvent) => void): (() => void) => {
      runtimeListeners.messageDelta = listener;
      return vi.fn();
    }),
    chatRuntimeOnMessageDeleted: vi.fn((listener: (event: ChatRuntimeMessageDeletedEvent) => void): (() => void) => {
      runtimeListeners.messageDeleted = listener;
      return vi.fn();
    }),
    chatRuntimeOnContextUsageUpdated: vi.fn((listener: (event: ChatRuntimeContextUsageEvent) => void): (() => void) => {
      runtimeListeners.contextUsage = listener;
      return vi.fn();
    }),
    chatRuntimeOnToolRequest: vi.fn((listener: (event: ChatRuntimeToolRequestEvent) => void): (() => void) => {
      runtimeListeners.toolRequest = listener;
      return vi.fn();
    }),
    chatRuntimeOnToolCancelled: vi.fn((listener: (event: ChatRuntimeToolCancelledEvent) => void): (() => void) => {
      runtimeListeners.toolCancelled = listener;
      return vi.fn();
    }),
    ...(preloadCapabilities.shellOutput
      ? {
          onShellCommandOutput: vi.fn((listener: (event: ElectronShellCommandOutputChunk) => void): (() => void) => {
            runtimeListeners.shellOutput = listener;
            return vi.fn();
          })
        }
      : {}),
    onShellRunEvent: vi.fn((listener: (event: ElectronShellRunEventEnvelope) => void): (() => void) => {
      runtimeListeners.shellRunEvent = listener;
      return vi.fn();
    }),
    chatRuntimeOnConfirmationRequested: vi.fn((listener: (event: ChatRuntimeConfirmationRequestEvent) => void): (() => void) => {
      runtimeListeners.confirmation = listener;
      return vi.fn();
    }),
    chatRuntimeSubmitConfirmation: runtimeCommands.submitConfirmation,
    chatRuntimeSubmitToolActivity: runtimeCommands.submitToolActivity,
    chatRuntimeSubmitToolResult: runtimeCommands.submitToolResult,
    chatRuntimeOnBridgeRequested: vi.fn((): (() => void) => vi.fn()),
    chatRuntimeOnComplete: vi.fn((listener: (event: ChatRuntimeCompleteEvent) => void): (() => void) => {
      runtimeListeners.complete = listener;
      return vi.fn();
    }),
    chatRuntimeOnError: vi.fn((listener: (event: ChatRuntimeErrorEvent) => void): (() => void) => {
      runtimeListeners.error = listener;
      return vi.fn();
    })
  }))
}));

/**
 * 创建 Runtime 事件基础字段。
 * @returns Runtime 事件基础字段
 */
function createEventBase(): {
  runtimeId: string;
  sessionId: string;
  turnId: string;
  clientId: string;
  agentId: string;
  rootRuntimeId: string;
} {
  return {
    runtimeId: 'runtime-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    clientId: 'bchat',
    agentId: 'primary',
    rootRuntimeId: 'runtime-1'
  };
}

describe('useRuntimeEvents', (): void => {
  beforeEach((): void => {
    setActivePinia(createPinia());
    preloadCapabilities.shellOutput = true;
    runtimeCommands.submitConfirmation.mockReset();
    runtimeCommands.submitConfirmation.mockResolvedValue({ ok: true });
    runtimeCommands.submitToolActivity.mockReset();
    runtimeCommands.submitToolActivity.mockResolvedValue({ ok: true });
    runtimeCommands.submitToolResult.mockReset();
    runtimeCommands.submitToolResult.mockResolvedValue({ ok: true });
    for (const key of Object.keys(runtimeListeners) as Array<keyof typeof runtimeListeners>) {
      runtimeListeners[key] = undefined;
    }
  });

  it('routes ordinary Shell pipe output by Runtime and reports cumulative progress', async (): Promise<void> => {
    const pendingResolvers: Array<() => void> = [];
    const tool: AIToolExecutor = {
      definition: {
        name: 'run_shell_command',
        description: 'test pipe shell',
        source: 'builtin',
        parameters: { type: 'object', properties: {} },
        riskLevel: 'dangerous',
        requiresActiveDocument: false
      },
      execute: vi.fn(
        (): Promise<{ toolName: string; status: 'success'; data: Record<string, never> }> =>
          new Promise((resolve) => {
            pendingResolvers.push((): void => resolve({ toolName: 'run_shell_command', status: 'success', data: {} }));
          })
      )
    };
    const system = createChatActorSystem();
    system.start();
    const visibleA = vi.fn();
    const visibleB = vi.fn();

    // 两个 Session 故意复用 toolCallId，用于验证编码 commandId 的隔离作用。
    for (const route of [
      { sessionId: 'session-a', runtimeId: 'runtime-a', visible: visibleA },
      { sessionId: 'session-b', runtimeId: 'runtime-b', visible: visibleB }
    ]) {
      const session = system.ensureSession(route.sessionId);
      session.send({ type: 'session.submit', input: { messageId: `user-${route.runtimeId}`, createdAt: 'now', content: 'hello', parts: [] } });
      session.send({ type: 'session.prepared' });
      const turnId = session.getSnapshot().context.turnRef?.getSnapshot().context.turnId;
      system.registerRuntime(
        {
          sessionId: route.sessionId,
          turnId: turnId as string,
          agentId: 'primary',
          runtimeId: route.runtimeId,
          rootRuntimeId: route.runtimeId
        },
        { tools: [tool], getToolContext: () => undefined, handleBridgeRequest: async (): Promise<unknown> => undefined }
      );
      system.send({ type: 'runtime.event', runtimeId: route.runtimeId, event: { type: 'runtime.started', runtimeId: route.runtimeId } });
      system.subscribeSessionEvents(route.sessionId, route.visible);
    }

    const scope = effectScope();
    scope.run((): void => useRuntimeEvents(system));
    runtimeListeners.toolRequest?.({
      ...createEventBase(),
      runtimeId: 'runtime-a',
      sessionId: 'session-a',
      rootRuntimeId: 'runtime-a',
      toolCallId: 'same-call',
      toolName: 'run_shell_command',
      input: { interactionMode: 'none' }
    });
    runtimeListeners.toolRequest?.({
      ...createEventBase(),
      runtimeId: 'runtime-b',
      sessionId: 'session-b',
      rootRuntimeId: 'runtime-b',
      toolCallId: 'same-call',
      toolName: 'run_shell_command',
      input: { interactionMode: 'none' }
    });
    await Promise.resolve();

    runtimeListeners.shellOutput?.({
      commandId: createShellCommandId('runtime-a', 'same-call'),
      stream: 'stdout',
      text: 'out-a',
      sequence: 1,
      createdAt: 'now'
    });
    runtimeListeners.shellOutput?.({
      commandId: createShellCommandId('runtime-b', 'same-call'),
      stream: 'stderr',
      text: 'err-b',
      sequence: 1,
      createdAt: 'now'
    });
    runtimeListeners.shellOutput?.({
      commandId: createShellCommandId('runtime-a', 'same-call'),
      stream: 'stderr',
      text: 'err-a',
      sequence: 2,
      createdAt: 'now'
    });
    runtimeListeners.shellOutput?.({
      commandId: createShellCommandId('unknown-runtime', 'same-call'),
      stream: 'stdout',
      text: 'ignored',
      sequence: 1,
      createdAt: 'now'
    });
    await Promise.resolve();
    await Promise.resolve();

    await vi.waitFor((): void => {
      expect(visibleA).toHaveBeenCalled();
      expect(visibleB).toHaveBeenCalled();
    });

    expect(visibleA).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'shellCommandOutput',
        chunk: expect.objectContaining({ commandId: 'same-call', stream: 'stdout', text: 'out-a' })
      })
    );
    expect(visibleA).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'shellCommandOutput',
        chunk: expect.objectContaining({ commandId: 'same-call', stream: 'stderr', text: 'err-a' })
      })
    );
    expect(visibleA).not.toHaveBeenCalledWith(expect.objectContaining({ chunk: expect.objectContaining({ text: 'err-b' }) }));
    expect(visibleB).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'shellCommandOutput',
        chunk: expect.objectContaining({ commandId: 'same-call', stream: 'stderr', text: 'err-b' })
      })
    );
    expect(visibleB).not.toHaveBeenCalledWith(expect.objectContaining({ chunk: expect.objectContaining({ text: 'out-a' }) }));
    await vi.waitFor((): void => {
      expect(runtimeCommands.submitToolActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          runtimeId: 'runtime-a',
          toolCallId: 'same-call',
          activity: { kind: 'progress', progress: { phase: 'shell_output', completed: 10, message: 'err-a' } }
        })
      );
    });

    const progressCount = runtimeCommands.submitToolActivity.mock.calls.filter(
      ([input]): boolean => input.runtimeId === 'runtime-a' && input.activity.kind === 'progress'
    ).length;
    runtimeListeners.shellRunEvent?.({
      commandId: createShellCommandId('runtime-a', 'same-call'),
      sequence: 1,
      createdAt: 'now',
      event: { type: 'terminal_update', content: 'out-aerr-a' }
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(
      runtimeCommands.submitToolActivity.mock.calls.filter(([input]): boolean => input.runtimeId === 'runtime-a' && input.activity.kind === 'progress')
    ).toHaveLength(progressCount);

    const visibleACallCount = visibleA.mock.calls.length;
    system.unregisterRuntime('runtime-a');
    runtimeListeners.shellOutput?.({
      commandId: createShellCommandId('runtime-a', 'same-call'),
      stream: 'stdout',
      text: 'unmanaged',
      sequence: 3,
      createdAt: 'now'
    });
    expect(visibleA).toHaveBeenCalledTimes(visibleACallCount);

    pendingResolvers.forEach((resolvePending: () => void): void => resolvePending());
    await Promise.resolve();
    await Promise.resolve();
    scope.stop();
    system.stop();
  });

  it('initializes without the optional Shell pipe output preload bridge', (): void => {
    preloadCapabilities.shellOutput = false;
    const system = createChatActorSystem();
    system.start();
    const scope = effectScope();

    expect((): void => {
      scope.run((): void => useRuntimeEvents(system));
    }).not.toThrow();

    expect(runtimeListeners.shellOutput).toBeUndefined();
    scope.stop();
    system.stop();
  });

  it('routes message deltas only to the addressed managed Runtime session', (): void => {
    const system = createChatActorSystem();
    system.start();
    const session = system.ensureSession('session-1');
    session.send({ type: 'session.submit', input: { messageId: 'user-1', createdAt: 'now', content: 'hello', parts: [] } });
    session.send({ type: 'session.prepared' });
    const turnId = session.getSnapshot().context.turnRef?.getSnapshot().context.turnId as string;
    system.registerRuntime(
      { sessionId: 'session-1', turnId, agentId: 'primary', runtimeId: 'runtime-1', rootRuntimeId: 'runtime-1' },
      { tools: [], getToolContext: () => undefined, handleBridgeRequest: async (): Promise<unknown> => undefined }
    );
    system.send({ type: 'runtime.event', runtimeId: 'runtime-1', event: { type: 'runtime.started', runtimeId: 'runtime-1' } });
    const visibleEvents = vi.fn();
    system.subscribeSessionEvents('session-1', visibleEvents);
    const scope = effectScope();
    scope.run((): void => useRuntimeEvents(system));
    const delta: ChatRuntimeMessageDeltaEvent = {
      ...createEventBase(),
      messageId: 'assistant-1',
      baseRevision: 0,
      revision: 1,
      mutations: [{ kind: 'append-text', partId: 'text-1', text: 'delta' }]
    };

    runtimeListeners.messageDelta?.(delta);
    runtimeListeners.messageDelta?.({ ...delta, runtimeId: 'unknown-runtime', rootRuntimeId: 'unknown-runtime' });

    expect(visibleEvents).toHaveBeenCalledOnce();
    expect(visibleEvents).toHaveBeenCalledWith({ type: 'messageDelta', event: delta });
    scope.stop();
    system.stop();
  });

  it('auto-approves remembered confirmation grants without moving the Session to waiting', async (): Promise<void> => {
    const system = createChatActorSystem();
    system.start();
    const session = system.ensureSession('session-1');
    session.send({ type: 'session.submit', input: { messageId: 'user-1', createdAt: '2026-07-11T00:00:00.000Z', content: 'hello', parts: [] } });
    session.send({ type: 'session.prepared' });
    const turn = session.getSnapshot().context.turnRef;
    system.registerRuntime(
      {
        sessionId: 'session-1',
        turnId: turn?.getSnapshot().context.turnId as string,
        agentId: 'primary',
        runtimeId: 'runtime-1',
        rootRuntimeId: 'runtime-1'
      },
      { tools: [], getToolContext: () => undefined, handleBridgeRequest: async (): Promise<unknown> => undefined }
    );
    system.send({ type: 'runtime.event', runtimeId: 'runtime-1', event: { type: 'runtime.started', runtimeId: 'runtime-1' } });
    useChatPermissionStore().grantToolPermission('write_file', 'session');
    const visibleEvents = vi.fn();
    system.subscribeSessionEvents('session-1', visibleEvents);
    const scope = effectScope();
    scope.run((): void => useRuntimeEvents(system));

    runtimeListeners.confirmation?.({
      ...createEventBase(),
      confirmationId: 'confirmation-remembered',
      request: { toolName: 'write_file', title: '写入文件', description: '是否写入？', riskLevel: 'write', allowRemember: true }
    });
    await Promise.resolve();

    expect(runtimeCommands.submitConfirmation).toHaveBeenCalledWith({
      runtimeId: 'runtime-1',
      confirmationId: 'confirmation-remembered',
      decision: { approved: true }
    });
    expect(visibleEvents).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'confirmationRequested' }));
    expect(session.getSnapshot().matches('running')).toBe(true);
    scope.stop();
    system.stop();
  });

  it('falls back to a visible confirmation when remembered approval submission fails', async (): Promise<void> => {
    runtimeCommands.submitConfirmation.mockResolvedValueOnce({ ok: false, error: 'temporary IPC failure', code: 'IPC_FAILED' });
    const system = createChatActorSystem();
    system.start();
    const session = system.ensureSession('session-1');
    session.send({ type: 'session.submit', input: { messageId: 'user-1', createdAt: '2026-07-11T00:00:00.000Z', content: 'hello', parts: [] } });
    session.send({ type: 'session.prepared' });
    const turnId = session.getSnapshot().context.turnRef?.getSnapshot().context.turnId;
    system.registerRuntime(
      { sessionId: 'session-1', turnId: turnId as string, agentId: 'primary', runtimeId: 'runtime-1', rootRuntimeId: 'runtime-1' },
      { tools: [], getToolContext: (): undefined => undefined, handleBridgeRequest: async (): Promise<unknown> => undefined }
    );
    system.send({ type: 'runtime.event', runtimeId: 'runtime-1', event: { type: 'runtime.started', runtimeId: 'runtime-1' } });
    useChatPermissionStore().grantToolPermission('write_file', 'session');
    useChatTabStore().ensureTab('chat:session-1', 'session-1');
    const visibleEvents = vi.fn();
    system.subscribeSessionEvents('session-1', visibleEvents);
    const scope = effectScope();
    scope.run((): void => useRuntimeEvents(system));

    runtimeListeners.confirmation?.({
      ...createEventBase(),
      confirmationId: 'confirmation-retry',
      request: { toolName: 'write_file', title: '写入文件', description: '是否写入？', riskLevel: 'write', allowRemember: true }
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(visibleEvents).toHaveBeenCalledWith(expect.objectContaining({ type: 'confirmationRequested' }));
    expect(session.getSnapshot().matches('waitingForUser')).toBe(true);
    expect(useChatTabStore().getStatus('chat:session-1')).toBe('waiting');
    scope.stop();
    system.stop();
  });

  it('publishes visible events and completes the addressed background Agent', (): void => {
    const system = createChatActorSystem();
    system.start();
    const session = system.ensureSession('session-1');
    session.send({
      type: 'session.submit',
      input: {
        messageId: 'user-1',
        createdAt: '2026-07-11T00:00:00.000Z',
        content: 'hello',
        parts: []
      }
    });
    session.send({ type: 'session.prepared' });
    const turn = session.getSnapshot().context.turnRef;
    const agent = turn?.getSnapshot().context.primaryAgentRef;
    const turnId = turn?.getSnapshot().context.turnId;
    system.registerRuntime(
      { sessionId: 'session-1', turnId: turnId as string, agentId: 'primary', runtimeId: 'runtime-1', rootRuntimeId: 'runtime-1' },
      { tools: [], getToolContext: () => undefined, handleBridgeRequest: async (): Promise<unknown> => undefined }
    );
    system.send({ type: 'runtime.event', runtimeId: 'runtime-1', event: { type: 'runtime.started', runtimeId: 'runtime-1' } });
    const visibleEvents = vi.fn();
    system.subscribeSessionEvents('session-1', visibleEvents);
    const runtimeStore = useChatTabStore();
    useTabsStore().tabs = [{ id: 'chat:session-1', path: '/chat/session-1', title: '会话 1', cacheKey: 'chat:session-1' }];
    runtimeStore.ensureTab('chat:session-1', 'session-1');
    const completionStatuses: string[] = [];
    system.subscribeSessionEvents('session-1', (event): void => {
      if (event.type !== 'runtimeCompleted') return;
      completionStatuses.push(runtimeStore.getStatus('chat:session-1'));
      runtimeStore.markCompleted('chat:session-1', true);
    });
    const scope = effectScope();
    scope.run((): void => {
      useRuntimeEvents(system);
    });

    runtimeListeners.messageDeleted?.({ ...createEventBase(), messageId: 'assistant-1' });
    expect(visibleEvents).toHaveBeenCalledWith(expect.objectContaining({ type: 'messageDeleted', event: expect.objectContaining({ sessionId: 'session-1' }) }));
    runtimeListeners.contextUsage?.({ ...createEventBase(), snapshot: { usedTokens: 54_700, contextWindow: 1_000_000 } });
    expect(visibleEvents).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'contextUsageUpdated', event: expect.objectContaining({ snapshot: { usedTokens: 54_700, contextWindow: 1_000_000 } }) })
    );
    runtimeListeners.confirmation?.({
      ...createEventBase(),
      confirmationId: 'confirmation-visible',
      request: { toolName: 'write_file', title: '写入文件', description: '是否写入？', riskLevel: 'write' }
    });
    expect(visibleEvents).toHaveBeenCalledWith(expect.objectContaining({ type: 'confirmationRequested' }));
    expect(useChatTabStore().getStatus('chat:session-1')).toBe('waiting');
    runtimeListeners.complete?.({ ...createEventBase(), reason: 'completed' });

    expect(agent?.getSnapshot().matches('completed')).toBe(true);
    expect(session.getSnapshot().matches('idle')).toBe(true);
    expect(system.getRuntimeCapabilities('runtime-1')).toBeUndefined();
    expect(completionStatuses).toEqual(['completed']);
    expect(runtimeStore.getStatus('chat:session-1')).toBe('idle');
    scope.stop();
    system.stop();
  });

  it('moves a background Session to waiting and replays its confirmation on subscribe', (): void => {
    const system = createChatActorSystem();
    system.start();
    const session = system.ensureSession('session-1');
    session.send({
      type: 'session.submit',
      input: { messageId: 'user-1', createdAt: '2026-07-11T00:00:00.000Z', content: 'hello', parts: [] }
    });
    session.send({ type: 'session.prepared' });
    const turn = session.getSnapshot().context.turnRef;
    const turnId = turn?.getSnapshot().context.turnId;
    system.registerRuntime(
      { sessionId: 'session-1', turnId: turnId as string, agentId: 'primary', runtimeId: 'runtime-1', rootRuntimeId: 'runtime-1' },
      { tools: [], getToolContext: () => undefined, handleBridgeRequest: async (): Promise<unknown> => undefined }
    );
    system.send({ type: 'runtime.event', runtimeId: 'runtime-1', event: { type: 'runtime.started', runtimeId: 'runtime-1' } });
    const scope = effectScope();
    scope.run((): void => useRuntimeEvents(system));

    runtimeListeners.confirmation?.({
      ...createEventBase(),
      confirmationId: 'confirmation-1',
      request: { toolName: 'write_file', title: '写入文件', description: '是否写入？', riskLevel: 'write' }
    });

    expect(session.getSnapshot().matches('waitingForUser')).toBe(true);
    const visibleEvents = vi.fn();
    system.subscribeSessionEvents('session-1', visibleEvents);
    expect(visibleEvents).toHaveBeenCalledWith(expect.objectContaining({ type: 'confirmationRequested' }));
    scope.stop();
    system.stop();
  });

  it('clears cached confirmations when their Runtime terminates', (): void => {
    const system = createChatActorSystem();
    system.start();
    const session = system.ensureSession('session-1');
    session.send({ type: 'session.submit', input: { messageId: 'user-1', createdAt: 'now', content: 'hello', parts: [] } });
    session.send({ type: 'session.prepared' });
    const turnId = session.getSnapshot().context.turnRef?.getSnapshot().context.turnId;
    system.registerRuntime(
      { sessionId: 'session-1', turnId: turnId as string, agentId: 'primary', runtimeId: 'runtime-1', rootRuntimeId: 'runtime-1' },
      { tools: [], getToolContext: (): undefined => undefined, handleBridgeRequest: async (): Promise<unknown> => undefined }
    );
    system.send({ type: 'runtime.event', runtimeId: 'runtime-1', event: { type: 'runtime.started', runtimeId: 'runtime-1' } });
    const scope = effectScope();
    scope.run((): void => useRuntimeEvents(system));

    runtimeListeners.confirmation?.({
      ...createEventBase(),
      confirmationId: 'confirmation-stale',
      request: { toolName: 'write_file', title: '写入文件', description: '是否写入？', riskLevel: 'write' }
    });
    runtimeListeners.error?.({ ...createEventBase(), error: { code: 'REQUEST_FAILED', message: 'failed' } });
    const visibleEvents = vi.fn();
    system.subscribeSessionEvents('session-1', visibleEvents);

    expect(visibleEvents).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'confirmationRequested' }));
    scope.stop();
    system.stop();
  });

  it('expires only the cancelled tool flight and clears remaining flights on Runtime error', async (): Promise<void> => {
    const system = createChatActorSystem();
    system.start();
    const session = system.ensureSession('session-1');
    session.send({ type: 'session.submit', input: { messageId: 'user-1', createdAt: 'now', content: 'hello', parts: [] } });
    session.send({ type: 'session.prepared' });
    const turnId = session.getSnapshot().context.turnRef?.getSnapshot().context.turnId;
    system.registerRuntime(
      { sessionId: 'session-1', turnId: turnId as string, agentId: 'primary', runtimeId: 'runtime-1', rootRuntimeId: 'runtime-1' },
      { tools: [], getToolContext: () => undefined, handleBridgeRequest: async (): Promise<unknown> => undefined }
    );
    system.send({ type: 'runtime.event', runtimeId: 'runtime-1', event: { type: 'runtime.started', runtimeId: 'runtime-1' } });
    const controller = createChatConfirmationController(ref('session-1'));
    const firstDecision = controller
      .createAdapter({ sessionId: 'session-1', runtimeId: 'runtime-1', toolCallId: 'tool-call-1' })
      .confirm({ toolName: 'write_file', title: '写入一', description: '确认一', riskLevel: 'write' });
    const secondDecision = controller
      .createAdapter({ sessionId: 'session-1', runtimeId: 'runtime-1', toolCallId: 'tool-call-2' })
      .confirm({ toolName: 'write_file', title: '写入二', description: '确认二', riskLevel: 'write' });
    const scope = effectScope();
    scope.run((): void => useRuntimeEvents(system));

    runtimeListeners.toolCancelled?.({ ...createEventBase(), toolCallId: 'tool-call-1' });
    await expect(firstDecision).resolves.toEqual({ approved: false });
    expect(useChatConfirmationQueueStore().pending).toHaveLength(1);

    runtimeListeners.error?.({ ...createEventBase(), error: { code: 'REQUEST_FAILED', message: 'failed' } });
    await expect(secondDecision).resolves.toEqual({ approved: false });
    expect(useChatConfirmationQueueStore().pending).toHaveLength(0);
    scope.stop();
    system.stop();
  });

  it.each(['complete', 'error'] as const)('removes a detached Runtime record on %s', (terminalEvent): void => {
    const system = createChatActorSystem();
    system.start();
    const session = system.ensureSession('session-1');
    session.send({ type: 'session.submit', input: { messageId: 'user-1', createdAt: 'now', content: 'hello', parts: [] } });
    session.send({ type: 'session.prepared' });
    const turnId = session.getSnapshot().context.turnRef?.getSnapshot().context.turnId;
    system.registerRuntime(
      { sessionId: 'session-1', turnId: turnId as string, agentId: 'primary', runtimeId: 'runtime-1', rootRuntimeId: 'runtime-1' },
      { tools: [], getToolContext: () => undefined, handleBridgeRequest: async (): Promise<unknown> => undefined }
    );
    system.send({ type: 'runtime.event', runtimeId: 'runtime-1', event: { type: 'runtime.started', runtimeId: 'runtime-1' } });
    const runtimeStore = useChatTabStore();
    runtimeStore.ensureTab('chat:session-1', 'session-1');
    runtimeStore.setStatus('chat:session-1', 'running');
    const scope = effectScope();
    scope.run((): void => useRuntimeEvents(system));

    if (terminalEvent === 'complete') runtimeListeners.complete?.({ ...createEventBase(), reason: 'completed' });
    else runtimeListeners.error?.({ ...createEventBase(), error: { code: 'REQUEST_FAILED', message: 'failed' } });

    expect(runtimeStore.records['chat:session-1']).toBeUndefined();
    scope.stop();
    system.stop();
  });

  it('keeps the Turn waiting when Runtime completion explicitly requests user input', (): void => {
    const system = createChatActorSystem();
    system.start();
    const session = system.ensureSession('session-1');
    session.send({
      type: 'session.submit',
      input: { messageId: 'user-1', createdAt: '2026-07-13T00:00:00.000Z', content: 'hello', parts: [] }
    });
    session.send({ type: 'session.prepared' });
    const turn = session.getSnapshot().context.turnRef;
    const agent = turn?.getSnapshot().context.primaryAgentRef;
    system.registerRuntime(
      {
        sessionId: 'session-1',
        turnId: turn?.getSnapshot().context.turnId as string,
        agentId: 'primary',
        runtimeId: 'runtime-1',
        rootRuntimeId: 'runtime-1'
      },
      { tools: [], getToolContext: () => undefined, handleBridgeRequest: async (): Promise<unknown> => undefined }
    );
    system.send({ type: 'runtime.event', runtimeId: 'runtime-1', event: { type: 'runtime.started', runtimeId: 'runtime-1' } });
    const visibleEvents = vi.fn();
    system.subscribeSessionEvents('session-1', visibleEvents);
    const scope = effectScope();
    scope.run((): void => useRuntimeEvents(system));

    runtimeListeners.complete?.({
      ...createEventBase(),
      reason: 'awaiting_user_input',
      interaction: {
        type: 'userChoice',
        status: 'pending',
        sessionId: 'session-1',
        messageId: 'assistant-1',
        runtimeId: 'runtime-1',
        agentId: 'primary',
        toolCallId: 'tool-call-question',
        questionId: 'question-1'
      }
    });

    expect(session.getSnapshot().matches('waitingForUser')).toBe(true);
    expect(session.getSnapshot().context.pendingInteraction).toMatchObject({ questionId: 'question-1', status: 'pending' });
    expect(agent?.getSnapshot().matches('waiting')).toBe(true);
    expect(visibleEvents).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'runtimeCompleted' }));
    expect(system.getRuntimeCapabilities('runtime-1')).toBeUndefined();
    expect(useChatTabStore().records['chat:session-1']).toBeUndefined();
    scope.stop();
    system.stop();
  });

  it('projects waiting_children without completing the Session or publishing runtimeCompleted', (): void => {
    const system = createChatActorSystem();
    system.start();
    const session = system.ensureSession('session-1');
    session.send({
      type: 'session.submit',
      input: { messageId: 'user-1', createdAt: '2026-07-24T00:00:00.000Z', content: 'delegate', parts: [] }
    });
    session.send({ type: 'session.prepared' });
    const turn = session.getSnapshot().context.turnRef;
    const agent = turn?.getSnapshot().context.primaryAgentRef;
    system.registerRuntime(
      {
        sessionId: 'session-1',
        turnId: turn?.getSnapshot().context.turnId as string,
        agentId: 'primary',
        runtimeId: 'runtime-1',
        rootRuntimeId: 'runtime-1'
      },
      { tools: [], getToolContext: () => undefined, handleBridgeRequest: async (): Promise<unknown> => undefined }
    );
    system.send({ type: 'runtime.event', runtimeId: 'runtime-1', event: { type: 'runtime.started', runtimeId: 'runtime-1' } });
    const visibleEvents = vi.fn();
    system.subscribeSessionEvents('session-1', visibleEvents);
    const runtimeStore = useChatTabStore();
    runtimeStore.ensureTab('chat:session-1', 'session-1');
    const scope = effectScope();
    scope.run((): void => useRuntimeEvents(system));

    runtimeListeners.complete?.({ ...createEventBase(), reason: 'waiting_children', checkpointId: 'checkpoint-1' });

    expect(agent?.getSnapshot().matches('waitingChildren')).toBe(true);
    expect(turn?.getSnapshot().matches('waitingChildren')).toBe(true);
    expect(session.getSnapshot().matches('waitingChildren')).toBe(true);
    expect(runtimeStore.getStatus('chat:session-1')).toBe('waiting');
    expect(visibleEvents).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'runtimeCompleted' }));
    expect(system.getRuntimeCapabilities('runtime-1')).toBeUndefined();
    scope.stop();
    system.stop();
  });

  it('ignores events for runtimes that were not registered by the Actor system', (): void => {
    const system = createChatActorSystem();
    system.start();
    const visibleEvents = vi.fn();
    system.subscribeSessionEvents('session-1', visibleEvents);
    const scope = effectScope();
    scope.run((): void => {
      useRuntimeEvents(system);
    });

    runtimeListeners.messageDeleted?.({ ...createEventBase(), messageId: 'assistant-1' });

    expect(visibleEvents).not.toHaveBeenCalled();
    scope.stop();
    system.stop();
  });

  it('accepts only a lineage-matching Main continuation assistant update after Runtime A is unregistered', (): void => {
    const system = createChatActorSystem();
    system.start();
    const checkpoint: ChatAgentCheckpointSnapshot = {
      checkpointId: 'checkpoint-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      primaryAgentId: 'primary',
      rootRuntimeId: 'runtime-a',
      sourceRuntimeId: 'runtime-a',
      status: 'waiting_children',
      version: 1,
      checkpointSequence: 3,
      createdAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T00:00:01.000Z'
    };
    system.recoverDelegation(checkpoint);
    const visibleEvents = vi.fn();
    system.subscribeSessionEvents('session-1', visibleEvents);
    const scope = effectScope();
    scope.run((): void => useRuntimeEvents(system));

    const assistant = {
      id: 'assistant-1',
      sessionId: 'session-1',
      role: 'assistant' as const,
      content: 'cancelled',
      parts: [],
      createdAt: '2026-07-24T00:00:02.000Z',
      runtimeId: 'runtime-a',
      loading: false,
      finished: true
    };
    runtimeListeners.messageUpdated?.({
      ...createEventBase(),
      runtimeId: 'runtime-a',
      rootRuntimeId: 'runtime-a',
      clientId: 'agent-continuation',
      turnId: 'turn-other',
      message: assistant
    });
    expect(visibleEvents).not.toHaveBeenCalled();

    runtimeListeners.messageUpdated?.({
      ...createEventBase(),
      runtimeId: 'runtime-a',
      rootRuntimeId: 'runtime-a',
      clientId: 'agent-continuation',
      message: assistant
    });

    expect(visibleEvents).toHaveBeenCalledWith({
      type: 'messageUpdated',
      event: expect.objectContaining({
        runtimeId: 'runtime-a',
        sessionId: 'session-1',
        turnId: 'turn-1',
        clientId: 'agent-continuation',
        message: expect.objectContaining({ id: 'assistant-1', loading: false, finished: true })
      })
    });
    scope.stop();
    system.stop();
  });

  it('reports started, progress, and heartbeat in order before clearing the renderer activity timer', async (): Promise<void> => {
    vi.useFakeTimers();
    let resolveTool: ((result: { toolName: string; status: 'success'; data: { ok: boolean } }) => void) | undefined;
    const toolResult = new Promise<{ toolName: string; status: 'success'; data: { ok: boolean } }>((resolve) => {
      resolveTool = resolve;
    });
    const tool: AIToolExecutor = {
      definition: {
        name: 'long_renderer_tool',
        description: 'long renderer tool',
        source: 'builtin',
        parameters: { type: 'object', properties: {} },
        riskLevel: 'read',
        requiresActiveDocument: false
      },
      execute: vi.fn(async (_input: unknown, context?: AIToolContext) => {
        context?.activity?.progress({ phase: 'reading', completed: 2, total: 4, message: '读取到第二项' });
        return toolResult;
      })
    };
    const toolContext: AIToolContext = {
      document: {
        id: 'document-1',
        title: 'Document',
        path: null,
        getContent: (): string => ''
      },
      editor: {
        getSelection: (): null => null,
        insertAtCursor: async (): Promise<void> => undefined,
        replaceSelection: async (): Promise<void> => undefined,
        replaceDocument: async (): Promise<void> => undefined
      }
    };
    const system = createChatActorSystem();
    system.start();
    const session = system.ensureSession('session-1');
    session.send({ type: 'session.submit', input: { messageId: 'user-1', createdAt: 'now', content: 'hello', parts: [] } });
    session.send({ type: 'session.prepared' });
    const turnId = session.getSnapshot().context.turnRef?.getSnapshot().context.turnId;
    system.registerRuntime(
      { sessionId: 'session-1', turnId: turnId as string, agentId: 'primary', runtimeId: 'runtime-1', rootRuntimeId: 'runtime-1' },
      { tools: [tool], getToolContext: (): AIToolContext => toolContext, handleBridgeRequest: async (): Promise<unknown> => undefined }
    );
    system.send({ type: 'runtime.event', runtimeId: 'runtime-1', event: { type: 'runtime.started', runtimeId: 'runtime-1' } });
    const scope = effectScope();
    scope.run((): void => useRuntimeEvents(system));

    try {
      runtimeListeners.toolRequest?.({
        ...createEventBase(),
        toolCallId: 'tool-call-long',
        toolName: 'long_renderer_tool',
        input: {}
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(runtimeCommands.submitToolActivity).toHaveBeenNthCalledWith(1, {
        runtimeId: 'runtime-1',
        toolCallId: 'tool-call-long',
        sequence: 1,
        occurredAt: expect.any(Number),
        activity: { kind: 'started' }
      });
      expect(runtimeCommands.submitToolActivity).toHaveBeenNthCalledWith(2, {
        runtimeId: 'runtime-1',
        toolCallId: 'tool-call-long',
        sequence: 2,
        occurredAt: expect.any(Number),
        activity: { kind: 'progress', progress: { phase: 'reading', completed: 2, total: 4, message: '读取到第二项' } }
      });

      await vi.advanceTimersByTimeAsync(15_000);
      expect(runtimeCommands.submitToolActivity).toHaveBeenNthCalledWith(3, {
        runtimeId: 'runtime-1',
        toolCallId: 'tool-call-long',
        sequence: 3,
        occurredAt: expect.any(Number),
        activity: { kind: 'heartbeat' }
      });

      runtimeListeners.toolCancelled?.({
        ...createEventBase(),
        toolCallId: 'tool-call-long'
      });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(runtimeCommands.submitToolActivity).toHaveBeenCalledTimes(3);

      resolveTool?.({ toolName: 'long_renderer_tool', status: 'success', data: { ok: true } });
      await vi.advanceTimersByTimeAsync(0);
      expect(runtimeCommands.submitToolResult).toHaveBeenCalledWith(
        expect.objectContaining({ runtimeId: 'runtime-1', toolCallId: 'tool-call-long', result: expect.objectContaining({ status: 'success' }) })
      );
    } finally {
      scope.stop();
      system.stop();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('bounds alternating renderer activity while activity IPC is backpressured', async (): Promise<void> => {
    let releaseProgress: (() => void) | undefined;
    const blockedProgress = new Promise<void>((resolve): void => {
      releaseProgress = resolve;
    });
    let startControlFlood: (() => void) | undefined;
    const controlFloodGate = new Promise<void>((resolve): void => {
      startControlFlood = resolve;
    });
    let releaseControl: (() => void) | undefined;
    const blockedControl = new Promise<void>((resolve): void => {
      releaseControl = resolve;
    });
    let progressBlocked = false;
    let controlBlocked = false;
    runtimeCommands.submitToolActivity.mockImplementation(async (input): Promise<{ ok: true }> => {
      if (!progressBlocked && input.activity.kind === 'progress') {
        progressBlocked = true;
        await blockedProgress;
      }
      if (!controlBlocked && input.activity.kind === 'waiting_user') {
        controlBlocked = true;
        await blockedControl;
      }
      return { ok: true };
    });
    const tool: AIToolExecutor = {
      definition: {
        name: 'burst_renderer_tool',
        description: 'burst renderer tool',
        source: 'builtin',
        parameters: { type: 'object', properties: {} },
        riskLevel: 'read',
        requiresActiveDocument: false
      },
      execute: vi.fn(async (_input: unknown, context?: AIToolContext) => {
        for (let index = 0; index < 100; index += 1) {
          context?.activity?.progress({ phase: 'burst', completed: index, total: 100 });
          context?.activity?.heartbeat();
        }
        await controlFloodGate;
        for (let index = 0; index < 100; index += 1) {
          context?.activity?.waitUser(`prompt-${index}`);
          context?.activity?.resume();
        }
        return { toolName: 'burst_renderer_tool', status: 'success' as const, data: { ok: true } };
      })
    };
    const system = createChatActorSystem();
    system.start();
    const session = system.ensureSession('session-1');
    session.send({ type: 'session.submit', input: { messageId: 'user-1', createdAt: 'now', content: 'hello', parts: [] } });
    session.send({ type: 'session.prepared' });
    const turnId = session.getSnapshot().context.turnRef?.getSnapshot().context.turnId;
    system.registerRuntime(
      { sessionId: 'session-1', turnId: turnId as string, agentId: 'primary', runtimeId: 'runtime-1', rootRuntimeId: 'runtime-1' },
      {
        tools: [tool],
        getToolContext: (): AIToolContext => ({
          document: { id: 'document-burst', title: 'Burst', path: null, getContent: (): string => '' },
          editor: {
            getSelection: (): null => null,
            insertAtCursor: async (): Promise<void> => undefined,
            replaceSelection: async (): Promise<void> => undefined,
            replaceDocument: async (): Promise<void> => undefined
          }
        }),
        handleBridgeRequest: async (): Promise<unknown> => undefined
      }
    );
    system.send({ type: 'runtime.event', runtimeId: 'runtime-1', event: { type: 'runtime.started', runtimeId: 'runtime-1' } });
    const scope = effectScope();
    scope.run((): void => useRuntimeEvents(system));

    try {
      runtimeListeners.toolRequest?.({
        ...createEventBase(),
        toolCallId: 'tool-call-burst',
        toolName: 'burst_renderer_tool',
        input: {}
      });
      await vi.waitFor((): void => {
        expect(runtimeCommands.submitToolActivity).toHaveBeenCalledTimes(2);
      });
      releaseProgress?.();
      await vi.waitFor((): void => {
        expect(runtimeCommands.submitToolActivity).toHaveBeenCalledTimes(4);
      });
      startControlFlood?.();
      await vi.waitFor((): void => {
        expect(runtimeCommands.submitToolActivity).toHaveBeenCalledTimes(5);
      });
      releaseControl?.();
      await vi.waitFor((): void => {
        expect(runtimeCommands.submitToolResult).toHaveBeenCalledOnce();
      });

      const progressInputs = runtimeCommands.submitToolActivity.mock.calls.map(([input]) => input).filter((input) => input.activity.kind === 'progress');
      expect(runtimeCommands.submitToolActivity).toHaveBeenCalledTimes(6);
      expect(runtimeCommands.submitToolActivity).toHaveBeenLastCalledWith(expect.objectContaining({ activity: { kind: 'resumed' } }));
      expect(progressInputs).toHaveLength(2);
      expect(progressInputs.at(-1)).toMatchObject({ activity: { progress: { completed: 99 } } });
    } finally {
      scope.stop();
      system.stop();
    }
  });

  it('isolates identical Shell toolCallIds across concurrent runtimes', async (): Promise<void> => {
    const pendingResolvers: Array<() => void> = [];
    const tool: AIToolExecutor = {
      definition: {
        name: 'run_shell_command',
        description: 'test shell',
        source: 'builtin',
        parameters: { type: 'object', properties: {} },
        riskLevel: 'dangerous',
        requiresActiveDocument: false
      },
      execute: vi.fn(
        (): Promise<{ toolName: string; status: 'success'; data: Record<string, never> }> =>
          new Promise((resolve) => {
            pendingResolvers.push((): void => resolve({ toolName: 'run_shell_command', status: 'success', data: {} }));
          })
      )
    };
    const system = createChatActorSystem();
    system.start();
    const visibleA = vi.fn();
    const visibleB = vi.fn();

    // 两个 Session 同时注册独立 Runtime，并故意使用相同的 toolCallId。
    for (const route of [
      { sessionId: 'session-a', runtimeId: 'runtime-a', visible: visibleA },
      { sessionId: 'session-b', runtimeId: 'runtime-b', visible: visibleB }
    ]) {
      const session = system.ensureSession(route.sessionId);
      session.send({ type: 'session.submit', input: { messageId: `user-${route.runtimeId}`, createdAt: 'now', content: 'hello', parts: [] } });
      session.send({ type: 'session.prepared' });
      const turnId = session.getSnapshot().context.turnRef?.getSnapshot().context.turnId;
      system.registerRuntime(
        {
          sessionId: route.sessionId,
          turnId: turnId as string,
          agentId: 'primary',
          runtimeId: route.runtimeId,
          rootRuntimeId: route.runtimeId
        },
        { tools: [tool], getToolContext: () => undefined, handleBridgeRequest: async (): Promise<unknown> => undefined }
      );
      system.send({ type: 'runtime.event', runtimeId: route.runtimeId, event: { type: 'runtime.started', runtimeId: route.runtimeId } });
      system.subscribeSessionEvents(route.sessionId, route.visible);
    }

    const scope = effectScope();
    scope.run((): void => useRuntimeEvents(system));
    runtimeListeners.toolRequest?.({
      ...createEventBase(),
      runtimeId: 'runtime-a',
      sessionId: 'session-a',
      rootRuntimeId: 'runtime-a',
      toolCallId: 'same-call',
      toolName: 'run_shell_command',
      input: { interactionMode: 'auto-default' }
    });
    runtimeListeners.toolRequest?.({
      ...createEventBase(),
      runtimeId: 'runtime-b',
      sessionId: 'session-b',
      rootRuntimeId: 'runtime-b',
      toolCallId: 'same-call',
      toolName: 'run_shell_command',
      input: { interactionMode: 'auto-default' }
    });
    await Promise.resolve();

    runtimeListeners.shellRunEvent?.({
      commandId: createShellCommandId('runtime-a', 'same-call'),
      sequence: 1,
      createdAt: 'now',
      event: { type: 'terminal_update', content: 'screen-a' }
    });
    runtimeListeners.shellRunEvent?.({
      commandId: createShellCommandId('runtime-b', 'same-call'),
      sequence: 1,
      createdAt: 'now',
      event: { type: 'terminal_update', content: 'screen-b' }
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(runtimeCommands.submitToolActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeId: 'runtime-a',
        toolCallId: 'same-call',
        sequence: 2,
        activity: { kind: 'progress', progress: { phase: 'shell_output', completed: 8, message: 'screen-a' } }
      })
    );
    const activityCallCount = runtimeCommands.submitToolActivity.mock.calls.length;
    runtimeListeners.shellRunEvent?.({
      commandId: createShellCommandId('runtime-a', 'same-call'),
      sequence: 2,
      createdAt: 'now',
      event: { type: 'terminal_update', content: 'screen-a' }
    });
    await Promise.resolve();
    expect(runtimeCommands.submitToolActivity).toHaveBeenCalledTimes(activityCallCount);

    expect(visibleA).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'shellRunEvent',
        event: expect.objectContaining({ commandId: 'same-call', event: { type: 'terminal_update', content: 'screen-a' } })
      })
    );
    expect(visibleA).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: expect.objectContaining({ event: expect.objectContaining({ content: 'screen-b' }) }) })
    );
    expect(visibleB).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'shellRunEvent',
        event: expect.objectContaining({ commandId: 'same-call', event: { type: 'terminal_update', content: 'screen-b' } })
      })
    );

    pendingResolvers.forEach((resolvePending: () => void): void => resolvePending());
    await Promise.resolve();
    await Promise.resolve();
    runtimeListeners.shellRunEvent?.({
      commandId: createShellCommandId('runtime-a', 'same-call'),
      sequence: 2,
      createdAt: 'now',
      event: { type: 'terminal_update', content: 'late-screen-a' }
    });
    expect(visibleA).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'shellRunEvent', event: expect.objectContaining({ event: { type: 'terminal_update', content: 'late-screen-a' } }) })
    );
    runtimeListeners.shellRunEvent?.({
      commandId: createShellCommandId('runtime-a', 'same-call'),
      sequence: 3,
      createdAt: 'now',
      event: {
        type: 'finished',
        result: {
          commandId: createShellCommandId('runtime-a', 'same-call'),
          shell: 'bash',
          command: 'echo ok',
          cwd: '/workspace',
          exitCode: 0,
          signal: null,
          durationMs: 1,
          timedOut: false,
          truncated: false,
          outputMode: 'pty',
          terminalOutput: 'done',
          termination: { kind: 'exit', exitCode: 0 }
        }
      }
    });
    runtimeListeners.shellRunEvent?.({
      commandId: createShellCommandId('runtime-a', 'same-call'),
      sequence: 4,
      createdAt: 'now',
      event: { type: 'terminal_update', content: 'after-finished' }
    });
    expect(visibleA).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: expect.objectContaining({ event: expect.objectContaining({ content: 'after-finished' }) }) })
    );
    scope.stop();
    system.stop();
  });
});
