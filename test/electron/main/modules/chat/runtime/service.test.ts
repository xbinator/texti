/**
 * @file service.test.ts
 * @description ChatRuntime 主进程服务骨架测试。
 */
import type { ChatAgentPrimaryContinuationInput } from '../../../../../../electron/main/modules/chat/agents/service.mjs';
import type { AgentCheckpointRecord } from '../../../../../../electron/main/modules/chat/agents/types.mjs';
import type {
  CompactionExecuteInput,
  CompactionExecuteResult,
  CompactionExecutor
} from '../../../../../../electron/main/modules/chat/runtime/compaction/executor.mjs';
import type { ChatModelResolution } from '../../../../../../electron/main/modules/chat/runtime/model/resolver.mjs';
import type {
  ChatRuntimeDelegationPrepareAck,
  ChatRuntimeDeferredToolCall,
  ChatRuntimeDelegationPrepareInput,
  ChatRuntimeDelegationPreparer,
  ChatRuntimeStreamExecutor
} from '../../../../../../electron/main/modules/chat/runtime/types.mjs';
import type { AICreateOptions, AIInvokeResult, AIRequestOptions, AIServiceError, AIStreamResult } from 'types/ai';
import type { ChatMessageCompactionPart, ChatMessagePart, ChatMessageRecord, StructuredContextSummary } from 'types/chat';
import type {
  ChatRuntimeCompactInput,
  ChatRuntimeContinueInput,
  ChatRuntimeEventMap,
  ChatRuntimeModelSelection,
  ChatRuntimeSendInput
} from 'types/chat-runtime';
import { describe, expect, it, vi } from 'vitest';
import { hashAgentPayload } from '../../../../../../electron/main/modules/chat/agents/contracts.mjs';
import { createRuntimeLockRegistry } from '../../../../../../electron/main/modules/chat/runtime/infrastructure/locks.mjs';
import { createChatRuntimeService } from '../../../../../../electron/main/modules/chat/runtime/service.mjs';
import { chatSessionManager } from '../../../../../../electron/main/modules/chat/service.mjs';

/** 默认 Runtime emitter 测试用窗口最小能力。 */
interface RuntimeTestWindow {
  /** Renderer IPC 发送能力。 */
  webContents: {
    /** WebContents 是否已经销毁。 */
    isDestroyed: () => boolean;
    /** 发送 Runtime 事件。 */
    send: (name: string, payload: unknown) => void;
  };
}

/** 默认 Runtime emitter 使用的 Electron 窗口列表替身。 */
const getAllWindowsMock = vi.hoisted(() => vi.fn<() => RuntimeTestWindow[]>(() => []));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: getAllWindowsMock }
}));

/** 已捕获的 runtime 事件，保留事件名与载荷之间的判别关系。 */
type CapturedRuntimeEvent = {
  [TName in keyof ChatRuntimeEventMap]: {
    /** 事件名。 */
    name: TName;
    /** 与事件名严格对应的载荷。 */
    payload: ChatRuntimeEventMap[TName];
  };
}[keyof ChatRuntimeEventMap];

/** Runtime 输入夹具序号，确保同一测试内 ID 不冲突。 */
let runtimeInputSequence = 0;

/**
 * 创建发送入参测试夹具。
 * @param overrides - 需要覆盖的发送字段
 * @returns runtime send 输入
 */
function createInput(overrides: Partial<ChatRuntimeSendInput> = {}): ChatRuntimeSendInput {
  const runtimeId = overrides.runtimeId ?? `runtime-test-${++runtimeInputSequence}`;
  return {
    ...overrides,
    runtimeId,
    sessionId: overrides.sessionId ?? 'session-1',
    turnId: overrides.turnId ?? `turn-${runtimeId}`,
    clientId: overrides.clientId ?? 'client-1',
    agentId: overrides.agentId ?? 'primary',
    rootRuntimeId: overrides.rootRuntimeId ?? runtimeId,
    content: overrides.content ?? 'hello'
  };
}

/**
 * 创建续轮入参测试夹具。
 * @param overrides - 需要覆盖的续轮字段
 * @returns runtime continue 输入
 */
function createContinueInput(overrides: Partial<ChatRuntimeContinueInput> = {}): ChatRuntimeContinueInput {
  const runtimeId = overrides.runtimeId ?? `runtime-continue-test-${++runtimeInputSequence}`;
  return {
    ...overrides,
    runtimeId,
    sessionId: overrides.sessionId ?? 'session-1',
    turnId: overrides.turnId ?? `turn-${runtimeId}`,
    clientId: overrides.clientId ?? 'client-1',
    agentId: overrides.agentId ?? 'primary',
    rootRuntimeId: overrides.rootRuntimeId ?? runtimeId,
    messages: overrides.messages ?? []
  };
}

/**
 * 创建聊天消息记录测试夹具。
 * @param id - 消息 ID
 * @param role - 消息角色
 * @param content - 文本内容
 * @param createdAt - 创建时间
 * @returns 聊天消息记录
 */
function createMessageRecord(id: string, role: ChatMessageRecord['role'], content: string, createdAt: string): ChatMessageRecord {
  return {
    id,
    sessionId: 'session-1',
    role,
    content,
    parts: content ? [{ id: 'part0076', type: 'text', text: content }] : [],
    createdAt,
    finished: true
  };
}

/**
 * 创建等待用户回答的 Question 工具片段。
 * @returns 等待用户输入的工具片段
 */
function createAwaitingUserChoicePart(): ChatMessagePart {
  return {
    id: 'part-awaiting-question',
    type: 'tool',
    toolCallId: 'tool-call-question',
    toolName: 'question',
    status: 'done',
    input: { question: '继续吗？' },
    result: {
      toolName: 'question',
      status: 'awaiting_user_input',
      data: {
        questionId: 'question-1',
        toolCallId: 'tool-call-question',
        question: '继续吗？',
        mode: 'single',
        options: [{ label: '继续', value: 'yes' }]
      }
    }
  };
}

/**
 * 创建收集 runtime 事件的 emitter。
 * @returns 事件列表与 emitter
 */
function createEventCollector(): {
  events: CapturedRuntimeEvent[];
  emit: <TName extends keyof ChatRuntimeEventMap>(name: TName, payload: ChatRuntimeEventMap[TName]) => void;
} {
  const events: CapturedRuntimeEvent[] = [];

  return {
    events,
    emit: <TName extends keyof ChatRuntimeEventMap>(name: TName, payload: ChatRuntimeEventMap[TName]): void => {
      events.push({ name, payload } as CapturedRuntimeEvent);
    }
  };
}

/**
 * 创建测试用 no-op 消息写入器。
 * @returns no-op 消息写入器
 */
function createNoopMessageWriter(): { addMessage: () => void; updateMessage: () => void } {
  return {
    addMessage: (): void => undefined,
    updateMessage: (): void => undefined
  };
}

/**
 * 创建测试用 no-op 消息读取器。
 * @returns no-op 消息读取器
 */
function createNoopMessageReader(): { getMessages: () => [] } {
  return {
    getMessages: (): [] => []
  };
}

/**
 * 创建测试用 no-op 流式执行器。
 * @returns no-op 流式执行器
 */
function createNoopStreamExecutor(): ChatRuntimeStreamExecutor {
  return async (): Promise<{}> => ({});
}

/**
 * 创建测试用合法延迟工具调用。
 * @returns 延迟工具调用
 */
function createDeferredToolCall(): ChatRuntimeDeferredToolCall {
  return {
    toolCallId: 'delegate-call-1',
    toolName: 'delegate_task',
    input: {
      task: '浏览上下文',
      acceptanceCriteria: ['返回摘要'],
      mode: 'read',
      resources: [{ kind: 'file', reference: 'CONTEXT.md' }],
      requestedTools: ['read_file'],
      required: true,
      priority: 'normal'
    },
    argumentsHash: 'a'.repeat(64)
  };
}

/**
 * 创建返回委派 suspension 的流执行器替身。
 * @returns 仅向普通持久化边界暴露过滤快照的流执行器
 */
function createSuspendingExecutor(): ChatRuntimeStreamExecutor {
  return async ({ assistantMessage }, updateAssistant): Promise<ReturnType<ChatRuntimeStreamExecutor> extends Promise<infer TResult> ? TResult : never> => {
    assistantMessage.parts.push({
      id: 'delegate-part-1',
      type: 'tool',
      toolCallId: 'delegate-call-1',
      toolName: 'delegate_task',
      status: 'executing',
      input: createDeferredToolCall().input
    });
    await updateAssistant({ ...structuredClone(assistantMessage), parts: [] });
    return {
      shouldContinue: false,
      suspension: { toolCalls: [createDeferredToolCall()] }
    };
  };
}

/**
 * 创建可手动完成的 Promise。
 * @returns Promise 与完成函数
 */
function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

/**
 * 等待后台 runtime microtask 完成。
 */
async function flushRuntimeTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * 等待后台 runtime 微任务推进到指定断言成立。
 * @param predicate - 等待条件
 */
async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 20 && !predicate(); index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

/**
 * 创建压缩测试使用的当前模型解析结果。
 * @returns 当前模型解析结果
 */
function createModelResolution(): ChatModelResolution {
  return {
    createOptions: {
      providerId: 'provider-1',
      providerName: 'Provider',
      providerType: 'openai',
      apiKey: 'secret',
      baseUrl: 'https://example.com'
    },
    modelId: 'model-1'
  };
}

/**
 * 创建引用指定 Part 的合法压缩摘要。
 * @param sourcePartId - 摘要证据 Part
 * @returns 结构化摘要
 */
function createCompactionSummary(sourcePartId: string): StructuredContextSummary {
  return {
    schemaVersion: 1,
    objectives: [],
    facts: [{ id: 'fact-1', type: 'decision', content: '保留历史决定', sourcePartIds: [sourcePartId] }],
    artifacts: [],
    completedActions: [],
    pendingActions: [],
    openQuestions: [],
    failures: []
  };
}

describe('chat runtime service shell', (): void => {
  it('continues broadcasting when one renderer window cannot receive an event', async (): Promise<void> => {
    const failedSend = vi.fn((): never => {
      throw new Error('renderer window unavailable');
    });
    const healthySend = vi.fn();
    const destroyedSend = vi.fn();
    getAllWindowsMock.mockReturnValue([
      { webContents: { isDestroyed: (): boolean => false, send: failedSend } },
      { webContents: { isDestroyed: (): boolean => false, send: healthySend } },
      { webContents: { isDestroyed: (): boolean => true, send: destroyedSend } }
    ]);
    const service = createChatRuntimeService({
      messageWriter: createNoopMessageWriter(),
      messageReader: createNoopMessageReader(),
      streamExecutor: createNoopStreamExecutor(),
      keepRuntimeOpenForTest: true
    });

    try {
      const result = await service.send(createInput({ content: 'broadcast safely' }));

      expect(failedSend).toHaveBeenCalled();
      expect(healthySend).toHaveBeenCalledWith('chat:runtime:message-created', expect.any(Object));
      expect(destroyedSend).not.toHaveBeenCalled();
      await service.abort({ runtimeId: result.runtimeId });
    } finally {
      getAllWindowsMock.mockReturnValue([]);
    }
  });

  it('rejects renderer-supplied deferred tools and internal lineage before taking locks or writing messages', async (): Promise<void> => {
    const addMessage = vi.fn();
    const prepareDelegation = vi.fn();
    const streamExecutor = vi.fn(createNoopStreamExecutor());
    const locks = createRuntimeLockRegistry();
    const service = createChatRuntimeService({
      locks,
      emit: vi.fn(),
      messageWriter: { addMessage, updateMessage: vi.fn() },
      messageReader: createNoopMessageReader(),
      streamExecutor,
      prepareDelegation
    });
    const delegateTool = {
      name: 'delegate_task',
      description: 'must remain internal',
      parameters: { type: 'object' as const, properties: {} }
    };

    await expect(service.send(createInput({ tools: [delegateTool] }))).rejects.toMatchObject({
      code: 'RUNTIME_INPUT_DENIED'
    });
    await expect(service.continue(createContinueInput({ tools: [delegateTool] }))).rejects.toMatchObject({
      code: 'RUNTIME_INPUT_DENIED'
    });
    await expect(
      service.compact({
        ...createInput({
          runtimeId: 'runtime-compact-denied',
          turnId: 'turn-compact-denied',
          rootRuntimeId: 'runtime-compact-denied'
        }),
        tools: [delegateTool]
      })
    ).rejects.toMatchObject({
      code: 'RUNTIME_INPUT_DENIED'
    });
    await expect(
      service.submitUserChoice({
        ...createInput({
          runtimeId: 'runtime-choice-denied',
          turnId: 'turn-choice-denied',
          rootRuntimeId: 'runtime-choice-denied'
        }),
        tools: [delegateTool],
        answer: {
          questionId: 'question-denied',
          toolCallId: 'call-denied',
          answers: []
        }
      })
    ).rejects.toMatchObject({
      code: 'RUNTIME_INPUT_DENIED'
    });
    await expect(
      service.send(
        createInput({
          runtimeId: 'runtime-forged-child',
          turnId: 'turn-forged-child',
          rootRuntimeId: 'runtime-forged-child',
          agentId: 'child-forged',
          parentAgentId: 'primary',
          parentRuntimeId: 'runtime-parent'
        })
      )
    ).rejects.toMatchObject({
      code: 'RUNTIME_INPUT_DENIED'
    });

    expect(addMessage).not.toHaveBeenCalled();
    expect(prepareDelegation).not.toHaveBeenCalled();
    expect(streamExecutor).not.toHaveBeenCalled();
    expect(locks.getWritingOwner('session-1')).toBeUndefined();
  });

  it('uses one normalized configured timeout for the renderer request controller and stream executor', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const collector = createEventCollector();
      let streamCall = 0;
      const service = createChatRuntimeService({
        emit: collector.emit,
        messageWriter: createNoopMessageWriter(),
        messageReader: createNoopMessageReader(),
        rendererToolTimeoutMs: 45_000,
        resolveModel: async (): Promise<ChatModelResolution> => ({
          createOptions: {
            providerId: 'provider-1',
            providerName: 'Provider',
            providerType: 'openai',
            apiKey: 'test-key',
            baseUrl: 'https://example.com'
          },
          modelId: 'model-1'
        }),
        streamText: async () => {
          streamCall += 1;
          /**
           * 创建首轮 renderer 工具调用与次轮最终文本。
           * @returns 确定性 Provider chunk 流
           */
          async function* createStream(): AsyncGenerator<unknown> {
            if (streamCall === 1) {
              yield {
                type: 'tool-call',
                toolCallId: 'renderer-call-1',
                toolName: 'renderer_custom_tool',
                input: {}
              };
              yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
              return;
            }
            yield { type: 'text-delta', textDelta: 'done' };
            yield { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
          }

          return [undefined, { stream: createStream() as unknown as AIStreamResult['stream'] }];
        }
      });
      const start = await service.send(
        createInput({
          tools: [
            {
              name: 'renderer_custom_tool',
              description: 'Read document',
              parameters: { type: 'object', properties: {} }
            }
          ]
        })
      );
      await flushUntil(() => collector.events.some((event): boolean => event.name === 'chat:runtime:tool-request'));

      await vi.advanceTimersByTimeAsync(30_000);
      expect(service.listRecoverySnapshots()[0]?.pendingRequests).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(15_000);
      await flushUntil(() => service.getActiveRuntime(start.runtimeId) === undefined);

      expect(service.listRecoverySnapshots()).toEqual([]);
      expect(
        collector.events.some(
          (event): boolean =>
            event.name === 'chat:runtime:tool-cancelled' && event.payload.runtimeId === start.runtimeId && event.payload.toolCallId === 'renderer-call-1'
        )
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves the public default renderer tool timeout at 30 seconds', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const collector = createEventCollector();
      let streamCall = 0;
      const service = createChatRuntimeService({
        emit: collector.emit,
        messageWriter: createNoopMessageWriter(),
        messageReader: createNoopMessageReader(),
        resolveModel: async (): Promise<ChatModelResolution> => ({
          createOptions: {
            providerId: 'provider-1',
            providerName: 'Provider',
            providerType: 'openai',
            apiKey: 'test-key',
            baseUrl: 'https://example.com'
          },
          modelId: 'model-1'
        }),
        streamText: async () => {
          streamCall += 1;
          /**
           * 创建首轮 renderer 工具调用与次轮最终文本。
           * @returns 确定性 Provider chunk 流
           */
          async function* createStream(): AsyncGenerator<unknown> {
            if (streamCall === 1) {
              yield {
                type: 'tool-call',
                toolCallId: 'renderer-default-timeout',
                toolName: 'renderer_custom_tool',
                input: {}
              };
              yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
              return;
            }
            yield { type: 'text-delta', text: 'done' };
            yield { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
          }

          return [undefined, { stream: createStream() as unknown as AIStreamResult['stream'] }];
        }
      });
      const start = await service.send(
        createInput({
          tools: [
            {
              name: 'renderer_custom_tool',
              description: 'Renderer custom tool',
              parameters: { type: 'object', properties: {} }
            }
          ]
        })
      );
      await flushUntil(() => collector.events.some((event): boolean => event.name === 'chat:runtime:tool-request'));

      await vi.advanceTimersByTimeAsync(29_999);
      expect(service.listRecoverySnapshots()[0]?.pendingRequests).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1);
      await flushUntil(() => service.getActiveRuntime(start.runtimeId) === undefined);

      expect(
        collector.events.filter(
          (event): boolean =>
            event.name === 'chat:runtime:tool-cancelled' &&
            event.payload.runtimeId === start.runtimeId &&
            event.payload.toolCallId === 'renderer-default-timeout'
        )
      ).toHaveLength(1);
      expect(service.listRecoverySnapshots()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps deferred parts private when delegation prepare fails', async (): Promise<void> => {
    const collector = createEventCollector();
    const persistedUpdates: ChatMessageRecord[] = [];
    let stagedAssistant: ChatMessageRecord | undefined;
    const storePrepareDelegation = vi.fn((persistAssistant: () => undefined): void => {
      persistAssistant();
      stagedAssistant = undefined;
      throw new Error('prepare failed');
    });
    const prepareDelegation = vi.fn((input: ChatRuntimeDelegationPrepareInput): ChatRuntimeDelegationPrepareAck => {
      storePrepareDelegation((): undefined => {
        stagedAssistant = structuredClone(input.assistantMessage);
        return undefined;
      });
      return { prepared: true };
    });
    const service = createChatRuntimeService({
      emit: collector.emit,
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (message): void => {
          persistedUpdates.push(structuredClone(message));
        }
      },
      streamExecutor: createSuspendingExecutor(),
      prepareDelegation
    });

    await service.send(createInput({ content: 'delegate safely' }));
    await vi.waitFor((): void => {
      expect(collector.events.some((event): boolean => event.name === 'chat:runtime:error')).toBe(true);
    });

    expect(prepareDelegation).toHaveBeenCalledOnce();
    expect(storePrepareDelegation).toHaveBeenCalledOnce();
    expect(stagedAssistant).toBeUndefined();
    expect(
      persistedUpdates.every((message): boolean => message.parts.every((part): boolean => part.type !== 'tool' || part.toolCallId !== 'delegate-call-1'))
    ).toBe(true);
  });

  it('fails closed without a configured delegation prepare boundary', async (): Promise<void> => {
    const collector = createEventCollector();
    const persistedUpdates: ChatMessageRecord[] = [];
    const service = createChatRuntimeService({
      emit: collector.emit,
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (message): void => {
          persistedUpdates.push(structuredClone(message));
        }
      },
      streamExecutor: createSuspendingExecutor()
    });

    await service.send(createInput({ content: 'delegate without coordinator' }));
    await vi.waitFor((): void => {
      expect(collector.events.some((event): boolean => event.name === 'chat:runtime:error')).toBe(true);
    });

    expect(
      persistedUpdates.every((message): boolean => message.parts.every((part): boolean => part.type !== 'tool' || part.toolCallId !== 'delegate-call-1'))
    ).toBe(true);
    expect(collector.events).toContainEqual({
      name: 'chat:runtime:error',
      payload: expect.objectContaining({
        error: expect.objectContaining({ message: '委派协调器尚未配置' })
      })
    });
  });

  it('fails closed when delegation prepare returns an inexact acknowledgement', async (): Promise<void> => {
    const collector = createEventCollector();
    const invalidPreparer = vi.fn(() => ({ prepared: true, checkpointId: 'unexpected-field' }));
    const prepareDelegation = invalidPreparer as unknown as ChatRuntimeDelegationPreparer;
    const service = createChatRuntimeService({
      emit: collector.emit,
      messageReader: createNoopMessageReader(),
      messageWriter: createNoopMessageWriter(),
      streamExecutor: createSuspendingExecutor(),
      prepareDelegation
    });

    await service.send(createInput({ content: 'delegate with invalid ack' }));
    await vi.waitFor((): void => {
      expect(collector.events.some((event): boolean => event.name === 'chat:runtime:error')).toBe(true);
    });

    expect(collector.events).toContainEqual({
      name: 'chat:runtime:error',
      payload: expect.objectContaining({
        error: expect.objectContaining({ code: 'DELEGATION_PREPARE_ACK_INVALID' })
      })
    });
  });

  it('fails closed when delegation prepare returns a Promise', async (): Promise<void> => {
    const collector = createEventCollector();
    const asyncPreparer = vi.fn(async (): Promise<{ prepared: true }> => ({ prepared: true }));
    const prepareDelegation = asyncPreparer as unknown as ChatRuntimeDelegationPreparer;
    const service = createChatRuntimeService({
      emit: collector.emit,
      messageReader: createNoopMessageReader(),
      messageWriter: createNoopMessageWriter(),
      streamExecutor: createSuspendingExecutor(),
      prepareDelegation
    });

    await service.send(createInput({ content: 'delegate with async prepare' }));
    await vi.waitFor((): void => {
      expect(collector.events.some((event): boolean => event.name === 'chat:runtime:error')).toBe(true);
    });

    expect(collector.events).toContainEqual({
      name: 'chat:runtime:error',
      payload: expect.objectContaining({
        error: expect.objectContaining({ code: 'DELEGATION_PREPARE_ASYNC' })
      })
    });
  });

  it('fails closed when delegation prepare returns a custom thenable', async (): Promise<void> => {
    const collector = createEventCollector();
    const thenablePreparer = vi.fn(() => ({
      prepared: true,
      then: (): void => undefined
    }));
    const prepareDelegation = thenablePreparer as unknown as ChatRuntimeDelegationPreparer;
    const service = createChatRuntimeService({
      emit: collector.emit,
      messageReader: createNoopMessageReader(),
      messageWriter: createNoopMessageWriter(),
      streamExecutor: createSuspendingExecutor(),
      prepareDelegation
    });

    await service.send(createInput({ content: 'delegate with thenable prepare' }));
    await vi.waitFor((): void => {
      expect(collector.events.some((event): boolean => event.name === 'chat:runtime:error')).toBe(true);
    });

    expect(collector.events).toContainEqual({
      name: 'chat:runtime:error',
      payload: expect.objectContaining({
        error: expect.objectContaining({ code: 'DELEGATION_PREPARE_ASYNC' })
      })
    });
  });

  it('attaches a rejection sink before rejecting an async delegation prepare', async (): Promise<void> => {
    const collector = createEventCollector();
    let rejectAck: (reason?: unknown) => void = (): void => undefined;
    const rejectedAck = new Promise<{ prepared: true }>((_resolve, reject) => {
      rejectAck = reject;
    });
    const catchSpy = vi.spyOn(rejectedAck, 'catch');
    const asyncPreparer = vi.fn(() => rejectedAck);
    const prepareDelegation = asyncPreparer as unknown as ChatRuntimeDelegationPreparer;
    const service = createChatRuntimeService({
      emit: collector.emit,
      messageReader: createNoopMessageReader(),
      messageWriter: createNoopMessageWriter(),
      streamExecutor: createSuspendingExecutor(),
      prepareDelegation
    });

    await service.send(createInput({ content: 'delegate with rejected async prepare' }));
    await vi.waitFor((): void => {
      expect(collector.events.some((event): boolean => event.name === 'chat:runtime:error')).toBe(true);
    });
    const sinkAttached = catchSpy.mock.calls.length > 0;
    if (!sinkAttached) {
      // RED 阶段也先挂测试清理器，避免故意触发的 rejection 污染 Vitest 进程。
      rejectedAck.catch((): void => undefined);
    }
    rejectAck(new Error('prepare rejected after fail-closed'));
    await flushRuntimeTasks();

    expect(sinkAttached).toBe(true);
    expect(collector.events).toContainEqual({
      name: 'chat:runtime:error',
      payload: expect.objectContaining({
        error: expect.objectContaining({ code: 'DELEGATION_PREPARE_ASYNC' })
      })
    });
  });

  it('consumes a rejecting custom thenable before failing closed', async (): Promise<void> => {
    const collector = createEventCollector();
    let thenInvoked = false;
    const rejectingThenable = {
      then: (_resolve: (value: unknown) => void, reject: (reason?: unknown) => void): void => {
        thenInvoked = true;
        reject(new Error('custom thenable rejected'));
      }
    };
    const thenablePreparer = vi.fn(() => rejectingThenable);
    const prepareDelegation = thenablePreparer as unknown as ChatRuntimeDelegationPreparer;
    const service = createChatRuntimeService({
      emit: collector.emit,
      messageReader: createNoopMessageReader(),
      messageWriter: createNoopMessageWriter(),
      streamExecutor: createSuspendingExecutor(),
      prepareDelegation
    });

    await service.send(createInput({ content: 'delegate with rejecting thenable' }));
    await vi.waitFor((): void => {
      expect(collector.events.some((event): boolean => event.name === 'chat:runtime:error')).toBe(true);
    });
    await flushRuntimeTasks();

    expect(thenInvoked).toBe(true);
    expect(collector.events).toContainEqual({
      name: 'chat:runtime:error',
      payload: expect.objectContaining({
        error: expect.objectContaining({ code: 'DELEGATION_PREPARE_ASYNC' })
      })
    });
  });

  it('normalizes throwing then accessors and calls as async prepare failures', async (): Promise<void> => {
    const cases: Array<{ label: string; value: object; wasInvoked: () => boolean }> = [];
    let getterInvoked = false;
    let callInvoked = false;
    cases.push({
      label: 'getter',
      value: Object.defineProperty({}, 'then', {
        get: (): never => {
          getterInvoked = true;
          throw new Error('malicious then getter');
        }
      }),
      wasInvoked: (): boolean => getterInvoked
    });
    cases.push({
      label: 'call',
      value: {
        then: (): never => {
          callInvoked = true;
          throw new Error('malicious then call');
        }
      },
      wasInvoked: (): boolean => callInvoked
    });

    for (const testCase of cases) {
      const collector = createEventCollector();
      const thenablePreparer = vi.fn(() => testCase.value);
      const prepareDelegation = thenablePreparer as unknown as ChatRuntimeDelegationPreparer;
      const service = createChatRuntimeService({
        emit: collector.emit,
        messageReader: createNoopMessageReader(),
        messageWriter: createNoopMessageWriter(),
        streamExecutor: createSuspendingExecutor(),
        prepareDelegation
      });

      // eslint-disable-next-line no-await-in-loop
      await service.send(createInput({ content: `delegate with malicious then ${testCase.label}` }));
      // eslint-disable-next-line no-await-in-loop
      await vi.waitFor((): void => {
        expect(collector.events.some((event): boolean => event.name === 'chat:runtime:error')).toBe(true);
      });
      // eslint-disable-next-line no-await-in-loop
      await flushRuntimeTasks();

      expect(testCase.wasInvoked()).toBe(true);
      expect(collector.events).toContainEqual({
        name: 'chat:runtime:error',
        payload: expect.objectContaining({
          error: expect.objectContaining({ code: 'DELEGATION_PREPARE_ASYNC' })
        })
      });
    }
  });

  it('finalizes only the last persisted safe snapshot after a deferred provider failure', async (): Promise<void> => {
    const collector = createEventCollector();
    const persistedUpdates: ChatMessageRecord[] = [];
    const prepareDelegation = vi.fn();
    const streamExecutor: ChatRuntimeStreamExecutor = async ({ assistantMessage }, updateAssistant) => {
      assistantMessage.parts.push({
        id: 'delegate-part-1',
        type: 'tool',
        toolCallId: 'delegate-call-1',
        toolName: 'delegate_task',
        status: 'inputting',
        input: null,
        inputText: '{"task":"'
      });
      await updateAssistant({ ...structuredClone(assistantMessage), parts: [] });
      throw new Error('provider failed after deferred start');
    };
    const service = createChatRuntimeService({
      emit: collector.emit,
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (message): void => {
          persistedUpdates.push(structuredClone(message));
        }
      },
      streamExecutor,
      prepareDelegation
    });

    await service.send(createInput({ content: 'delegate then fail' }));
    await vi.waitFor((): void => {
      expect(collector.events.some((event): boolean => event.name === 'chat:runtime:error')).toBe(true);
    });

    const updatedMessages = collector.events.flatMap((event): ChatMessageRecord[] =>
      event.name === 'chat:runtime:message-updated' ? [structuredClone(event.payload.message)] : []
    );
    expect(prepareDelegation).not.toHaveBeenCalled();
    expect([...persistedUpdates, ...updatedMessages]).not.toHaveLength(0);
    expect(
      [...persistedUpdates, ...updatedMessages].every((message): boolean =>
        message.parts.every((part): boolean => part.type !== 'tool' || part.toolCallId !== 'delegate-call-1')
      )
    ).toBe(true);
  });

  it('aborts from the last persisted safe snapshot while a deferred update is pending', async (): Promise<void> => {
    const collector = createEventCollector();
    const persistedUpdates: ChatMessageRecord[] = [];
    const pendingUpdate = createDeferred();
    const updateStarted = createDeferred();
    const prepareDelegation = vi.fn();
    let updateCount = 0;
    const streamExecutor: ChatRuntimeStreamExecutor = async ({ assistantMessage }, updateAssistant) => {
      assistantMessage.content = 'analysis';
      assistantMessage.parts.push({ id: 'analysis-part', type: 'text', text: 'analysis' });
      await updateAssistant(structuredClone(assistantMessage));
      assistantMessage.parts.push({
        id: 'delegate-part-1',
        type: 'tool',
        toolCallId: 'delegate-call-1',
        toolName: 'delegate_task',
        status: 'inputting',
        input: null,
        inputText: '{"task":"'
      });
      await updateAssistant({ ...structuredClone(assistantMessage), parts: [structuredClone(assistantMessage.parts[0])] });
      throw new Error('stream aborted');
    };
    const service = createChatRuntimeService({
      emit: collector.emit,
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: async (message): Promise<void> => {
          persistedUpdates.push(structuredClone(message));
          updateCount += 1;
          if (updateCount === 2) {
            updateStarted.resolve();
            await pendingUpdate.promise;
          }
        },
        deleteMessage: vi.fn()
      },
      streamExecutor,
      streamAbort: (): void => undefined,
      prepareDelegation
    });
    const input = createInput({ content: 'delegate then abort' });

    await service.send(input);
    await updateStarted.promise;
    const abortResult = await service.abort({ runtimeId: input.runtimeId });
    pendingUpdate.resolve();
    await flushRuntimeTasks();

    const updatedMessages = collector.events.flatMap((event): ChatMessageRecord[] =>
      event.name === 'chat:runtime:message-updated' ? [structuredClone(event.payload.message)] : []
    );
    expect(prepareDelegation).not.toHaveBeenCalled();
    expect(abortResult.assistantMessage).toMatchObject({
      content: 'analysis',
      finished: true
    });
    expect(
      [...persistedUpdates, ...updatedMessages, ...(abortResult.assistantMessage ? [abortResult.assistantMessage] : [])].every((message): boolean =>
        message.parts.every((part): boolean => part.type !== 'tool' || part.toolCallId !== 'delegate-call-1')
      )
    ).toBe(true);
  });

  it('makes the full assistant and delegation facts visible at one prepare boundary', async (): Promise<void> => {
    const persistedUpdates: ChatMessageRecord[] = [];
    let visibleTransaction:
      | {
          assistant: ChatMessageRecord;
          taskIds: string[];
          checkpointId: string;
          outboxIds: string[];
        }
      | undefined;
    let stagedAssistant: ChatMessageRecord | undefined;
    const storePrepareDelegation = vi.fn((persistAssistant: () => undefined): void => {
      persistAssistant();
      if (!stagedAssistant) throw new Error('assistant callback did not run synchronously');
      visibleTransaction = {
        assistant: stagedAssistant,
        taskIds: ['task-1'],
        checkpointId: 'checkpoint-1',
        outboxIds: ['outbox-1']
      };
    });
    const prepareDelegation = vi.fn((input: ChatRuntimeDelegationPrepareInput): ChatRuntimeDelegationPrepareAck => {
      storePrepareDelegation((): undefined => {
        stagedAssistant = structuredClone(input.assistantMessage);
        return undefined;
      });
      return { prepared: true };
    });
    const service = createChatRuntimeService({
      emit: vi.fn(),
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (message): void => {
          persistedUpdates.push(structuredClone(message));
        }
      },
      streamExecutor: createSuspendingExecutor(),
      prepareDelegation
    });

    await service.send(createInput({ content: 'delegate safely' }));
    await vi.waitFor((): void => {
      expect(prepareDelegation).toHaveBeenCalledOnce();
    });

    expect(
      persistedUpdates.every((message): boolean => message.parts.every((part): boolean => part.type !== 'tool' || part.toolCallId !== 'delegate-call-1'))
    ).toBe(true);
    expect(storePrepareDelegation).toHaveBeenCalledOnce();
    expect(visibleTransaction).toMatchObject({
      assistant: {
        parts: [
          expect.objectContaining({
            type: 'tool',
            toolCallId: 'delegate-call-1',
            status: 'executing'
          })
        ]
      },
      taskIds: ['task-1'],
      checkpointId: 'checkpoint-1',
      outboxIds: ['outbox-1']
    });
  });

  it('completes Runtime A as waiting_children after synchronous prepare and preserves the resolved model', async (): Promise<void> => {
    const collector = createEventCollector();
    const locks = createRuntimeLockRegistry();
    const waitingMessageLockOwners: Array<string | undefined> = [];
    const emit = vi.fn(<TName extends keyof ChatRuntimeEventMap>(name: TName, payload: ChatRuntimeEventMap[TName]): void => {
      if (name === 'chat:runtime:message-updated') {
        const messageEvent = payload as ChatRuntimeEventMap['chat:runtime:message-updated'];
        if (messageEvent.message.parts.some((part: ChatMessagePart): boolean => part.type === 'tool' && part.toolCallId === 'delegate-call-1')) {
          waitingMessageLockOwners.push(locks.getWritingOwner(messageEvent.sessionId));
        }
      }
      collector.emit(name, payload);
    });
    const prepareDelegation = vi.fn((input: ChatRuntimeDelegationPrepareInput): ChatRuntimeDelegationPrepareAck => {
      if (!input.checkpointId) throw new Error('Checkpoint ID must be allocated before prepare');
      return { prepared: true };
    });
    const streamExecutor: ChatRuntimeStreamExecutor = async ({ runtime, assistantMessage }, updateAssistant) => {
      runtime.resolvedModel = createModelResolution();
      assistantMessage.parts.push({
        id: 'delegate-part-1',
        type: 'tool',
        toolCallId: 'delegate-call-1',
        toolName: 'delegate_task',
        status: 'executing',
        input: createDeferredToolCall().input
      });
      await updateAssistant({ ...structuredClone(assistantMessage), parts: [] });
      return {
        shouldContinue: false,
        suspension: { toolCalls: [createDeferredToolCall()] }
      };
    };
    const service = createChatRuntimeService({
      emit,
      locks,
      messageReader: createNoopMessageReader(),
      messageWriter: createNoopMessageWriter(),
      streamExecutor,
      prepareDelegation
    });
    const input = createInput({
      runtimeId: 'runtime-waiting-children',
      sessionId: 'session-waiting-children',
      agentId: 'primary',
      rootRuntimeId: 'runtime-waiting-children'
    });

    await service.startTrustedPrimary(input);
    await vi.waitFor((): void => {
      expect(collector.events.some((event): boolean => event.name === 'chat:runtime:complete')).toBe(true);
    });

    const prepared = prepareDelegation.mock.calls[0]?.[0];
    if (!prepared) throw new Error('Delegation prepare must run before Runtime A completes');
    expect(prepared).toMatchObject({
      checkpointId: expect.stringMatching(/^checkpoint-/),
      runtime: {
        runtimeId: input.runtimeId,
        resolvedModel: {
          createOptions: { providerId: 'provider-1' },
          modelId: 'model-1'
        }
      }
    });
    expect(collector.events).toContainEqual({
      name: 'chat:runtime:complete',
      payload: expect.objectContaining({
        runtimeId: input.runtimeId,
        reason: 'waiting_children',
        checkpointId: prepared?.checkpointId
      })
    });
    const waitingMessageEvent = collector.events.findLast(
      (event): boolean =>
        event.name === 'chat:runtime:message-updated' &&
        event.payload.runtimeId === input.runtimeId &&
        event.payload.message.parts.some((part): boolean => part.type === 'tool' && part.toolCallId === 'delegate-call-1')
    );
    expect(waitingMessageEvent).toMatchObject({
      name: 'chat:runtime:message-updated',
      payload: {
        message: {
          loading: true,
          finished: false,
          parts: [expect.objectContaining({ toolCallId: 'delegate-call-1', status: 'executing' })]
        }
      }
    });
    expect(waitingMessageLockOwners).toEqual([undefined]);
    expect(prepareDelegation.mock.invocationCallOrder[0]).toBeLessThan(emit.mock.invocationCallOrder.at(-1) ?? Number.MAX_SAFE_INTEGER);
    expect(collector.events.some((event): boolean => event.name === 'chat:runtime:tool-request')).toBe(false);
    expect(service.getActiveRuntime(input.runtimeId)).toBeUndefined();
    expect(locks.getWritingOwner('session-waiting-children')).toBeUndefined();
  });

  it('uses the runtime id allocated by the renderer', async (): Promise<void> => {
    const service = createChatRuntimeService({
      emit: vi.fn(),
      messageWriter: createNoopMessageWriter(),
      messageReader: createNoopMessageReader(),
      streamExecutor: createNoopStreamExecutor(),
      keepRuntimeOpenForTest: true
    });
    const input = {
      ...createInput(),
      runtimeId: 'runtime-renderer-owned',
      rootRuntimeId: 'runtime-renderer-owned'
    } as ChatRuntimeSendInput;

    const result = await service.send(input);

    expect(result.runtimeId).toBe('runtime-renderer-owned');
    expect(service.getActiveRuntime('runtime-renderer-owned')).toBeDefined();
  });

  it('rejects a normal Runtime writer with TURN_WAITING_CHILDREN while a shared fence exists', async (): Promise<void> => {
    const locks = createRuntimeLockRegistry();
    const fence = locks.acquireContinuationFence({
      scope: 'session:session-fenced/history',
      checkpointId: 'checkpoint-fenced'
    });
    if (!fence) throw new Error('Test continuation fence must be acquired');
    const service = createChatRuntimeService({
      locks,
      emit: vi.fn(),
      messageWriter: createNoopMessageWriter(),
      messageReader: createNoopMessageReader(),
      streamExecutor: createNoopStreamExecutor()
    });

    await expect(service.send(createInput({ sessionId: 'session-fenced' }))).rejects.toMatchObject({
      code: 'TURN_WAITING_CHILDREN'
    });
    expect(service.getActiveRuntime('session-fenced')).toBeUndefined();
    fence.release();
  });

  it('auto-names a session through the main process model path', async (): Promise<void> => {
    const updateSessionTitle = vi.fn();
    const generateText = vi.fn().mockResolvedValue([undefined, { text: '"运行时标题"', totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }]);
    const service = createChatRuntimeService({
      emit: vi.fn(),
      messageWriter: createNoopMessageWriter(),
      messageReader: createNoopMessageReader(),
      streamExecutor: createNoopStreamExecutor(),
      autoNameResolveModel: async () => ({
        createOptions: {
          providerId: 'provider-1',
          providerName: 'Provider',
          apiKey: 'key',
          baseUrl: 'https://example.com',
          providerType: 'openai'
        },
        modelId: 'model-1'
      }),
      autoNameGenerateText: generateText,
      autoNameUpdateSessionTitle: updateSessionTitle
    });

    const result = await service.autoName({
      sessionId: 'session-1',
      userMessage: '用户问题',
      aiResponse: 'AI回答'
    });

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'provider-1' }),
      expect.objectContaining({
        modelId: 'model-1',
        prompt: expect.stringContaining('用户问题')
      })
    );
    expect(generateText.mock.calls[0][1].prompt).toContain('AI回答');
    expect(updateSessionTitle).toHaveBeenCalledWith('session-1', '运行时标题');
    expect(result).toEqual({ status: 'success', title: '运行时标题' });
  });

  it('skips auto-name when no model config is available', async (): Promise<void> => {
    const generateText = vi.fn();
    const updateSessionTitle = vi.fn();
    const service = createChatRuntimeService({
      emit: vi.fn(),
      messageWriter: createNoopMessageWriter(),
      messageReader: createNoopMessageReader(),
      streamExecutor: createNoopStreamExecutor(),
      autoNameResolveModel: async () => null,
      autoNameGenerateText: generateText,
      autoNameUpdateSessionTitle: updateSessionTitle
    });

    await expect(service.autoName({ sessionId: 'session-1', userMessage: '用户问题', aiResponse: 'AI回答' })).resolves.toEqual({
      status: 'skipped',
      reason: 'no_model_config'
    });
    expect(generateText).not.toHaveBeenCalled();
    expect(updateSessionTitle).not.toHaveBeenCalled();
  });

  it('returns failed auto-name result when generation fails', async (): Promise<void> => {
    const error: AIServiceError = { code: 'REQUEST_FAILED', message: 'network failed' };
    const service = createChatRuntimeService({
      emit: vi.fn(),
      messageWriter: createNoopMessageWriter(),
      messageReader: createNoopMessageReader(),
      streamExecutor: createNoopStreamExecutor(),
      autoNameResolveModel: async () => ({
        createOptions: {
          providerId: 'provider-1',
          providerName: 'Provider',
          apiKey: 'key',
          baseUrl: 'https://example.com',
          providerType: 'openai'
        },
        modelId: 'model-1'
      }),
      autoNameGenerateText: async () => [error],
      autoNameUpdateSessionTitle: vi.fn()
    });

    await expect(service.autoName({ sessionId: 'session-1', userMessage: '用户问题', aiResponse: 'AI回答' })).resolves.toEqual({
      status: 'failed',
      errorMessage: 'network failed'
    });
  });

  it('passes workspaceRoot into active runtimes for main-process file tools', async (): Promise<void> => {
    const streamExecutor = vi.fn<ChatRuntimeStreamExecutor>(async () => ({}));
    const service = createChatRuntimeService({
      emit: vi.fn(),
      messageWriter: createNoopMessageWriter(),
      messageReader: createNoopMessageReader(),
      streamExecutor
    });

    await service.send(createInput({ content: 'read file', workspaceRoot: '/workspace' }));
    await flushRuntimeTasks();

    expect(streamExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({ workspaceRoot: '/workspace' })
      }),
      expect.any(Function)
    );
  });

  it('reads the full session history at runtime start', async (): Promise<void> => {
    const getAllMessages = vi.spyOn(chatSessionManager, 'getAllMessages').mockReturnValue([]);
    const getMessages = vi.spyOn(chatSessionManager, 'getMessages').mockReturnValue([]);
    try {
      const streamExecutor = vi.fn<ChatRuntimeStreamExecutor>(async () => ({}));
      const service = createChatRuntimeService({
        emit: vi.fn(),
        messageWriter: createNoopMessageWriter(),
        streamExecutor
      });

      await service.send(createInput({ content: 'read full history' }));
      await vi.waitFor((): void => {
        expect(streamExecutor).toHaveBeenCalledOnce();
      });

      expect(getAllMessages).toHaveBeenCalledWith('session-1');
      expect(getMessages).not.toHaveBeenCalled();
    } finally {
      getAllMessages.mockRestore();
      getMessages.mockRestore();
    }
  });

  it('starts a runtime and emits a complete event for the shell implementation', async (): Promise<void> => {
    const collector = createEventCollector();
    const service = createChatRuntimeService({
      emit: collector.emit,
      messageWriter: createNoopMessageWriter(),
      messageReader: createNoopMessageReader(),
      streamExecutor: createNoopStreamExecutor()
    });

    const result = await service.send(createInput());
    await flushRuntimeTasks();

    expect(result.runtimeId).toMatch(/^runtime-/);
    expect(result.sessionId).toBe('session-1');
    expect(collector.events).toContainEqual({
      name: 'chat:runtime:complete',
      payload: expect.objectContaining({
        runtimeId: result.runtimeId,
        sessionId: 'session-1',
        clientId: 'client-1',
        agentId: 'primary'
      })
    });
  });

  it('emits projected context usage before and after the model response', async (): Promise<void> => {
    const collector = createEventCollector();
    const service = createChatRuntimeService({
      emit: collector.emit,
      messageWriter: createNoopMessageWriter(),
      messageReader: createNoopMessageReader(),
      streamExecutor: createNoopStreamExecutor(),
      resolveModel: async () => null
    });

    await service.send(
      createInput({
        content: 'measure this context',
        contextWindow: 1_000_000,
        system: 'system context'
      })
    );
    await flushRuntimeTasks();

    const usageEvents = collector.events.filter((event): boolean => event.name === 'chat:runtime:context-usage-updated');
    expect(usageEvents).toHaveLength(2);
    expect(usageEvents[0]?.payload).toMatchObject({
      sessionId: 'session-1',
      snapshot: {
        usedTokens: expect.any(Number),
        contextWindow: 1_000_000
      }
    });
    const firstUsage = usageEvents[0]?.payload as ChatRuntimeEventMap['chat:runtime:context-usage-updated'];
    expect(firstUsage.snapshot.usedTokens).toBeGreaterThan(0);
  });

  it('estimates persisted context usage for an idle session', async (): Promise<void> => {
    const service = createChatRuntimeService({
      emit: vi.fn(),
      messageReader: {
        getMessages: (): ChatMessageRecord[] => [createMessageRecord('user-existing', 'user', 'persisted context', '2026-07-16T00:00:00.000Z')]
      }
    });

    const snapshot = await service.estimateContext({
      sessionId: 'session-1',
      contextWindow: 1_000_000
    });

    expect(snapshot.contextWindow).toBe(1_000_000);
    expect(snapshot.usedTokens).toBeGreaterThan(0);
  });

  it('persists and emits user and assistant shell messages when sending', async (): Promise<void> => {
    const collector = createEventCollector();
    const addedMessages: ChatMessageRecord[] = [];
    const updatedMessages: ChatMessageRecord[] = [];
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (role) => `${role}-message-1`,
      now: () => '2026-06-19T00:00:00.000Z',
      streamExecutor: createNoopStreamExecutor(),
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (message) => {
          addedMessages.push({ ...message, parts: [...message.parts] });
        },
        updateMessage: (message) => {
          updatedMessages.push({ ...message, parts: [...message.parts] });
        }
      }
    });

    const result = await service.send(createInput({ content: 'hello runtime' }));
    await flushRuntimeTasks();

    expect(addedMessages).toHaveLength(2);
    expect(addedMessages[0]).toMatchObject({
      id: 'user-message-1',
      sessionId: 'session-1',
      role: 'user',
      content: 'hello runtime',
      parts: [{ type: 'text', text: 'hello runtime' }],
      runtimeId: result.runtimeId,
      agentId: 'primary',
      createdAt: '2026-06-19T00:00:00.000Z',
      finished: true
    });
    expect(addedMessages[1]).toMatchObject({
      id: 'assistant-message-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: '',
      parts: [],
      runtimeId: result.runtimeId,
      agentId: 'primary',
      createdAt: '2026-06-19T00:00:00.000Z',
      loading: true,
      finished: false
    });
    expect(updatedMessages.at(-1)).toMatchObject({
      id: 'assistant-message-1',
      loading: false,
      finished: true
    });
    const createdMessageIds = collector.events.flatMap((event) => {
      if (event.name !== 'chat:runtime:message-created') return [];

      return [(event.payload as ChatRuntimeEventMap['chat:runtime:message-created']).message.id];
    });
    expect(createdMessageIds).toEqual(['user-message-1', 'assistant-message-1']);
  });

  it('materializes file input parts before persisting user messages', async (): Promise<void> => {
    const persistedMessages: ChatMessageRecord[] = [];
    const materializedParts: ChatMessagePart[] = [
      { id: 'part0077', type: 'text', text: 'fix ' },
      {
        type: 'file',
        id: 'file-part-1',
        filename: 'foo.ts',
        mime: 'text/plain',
        url: 'file:///workspace/src/foo.ts',
        path: 'src/foo.ts',
        sourceText: { start: 4, end: 19, value: '{{@src/foo.ts}}' },
        snapshot: {
          content: 'editor content',
          startLine: 1,
          endLine: 1,
          totalLines: 1,
          contentHash: 'hash-1',
          capturedAt: '2026-06-20T00:00:00.000Z'
        }
      }
    ];
    const materializeFileParts = vi.fn().mockResolvedValue(materializedParts);
    const service = createChatRuntimeService({
      emit: vi.fn(),
      messageWriter: {
        addMessage: (message) => {
          persistedMessages.push(message);
        },
        updateMessage: vi.fn(),
        deleteMessage: vi.fn()
      },
      messageReader: createNoopMessageReader(),
      streamExecutor: createNoopStreamExecutor(),
      materializeFileParts,
      now: () => '2026-06-20T00:00:00.000Z'
    });

    await service.send(
      createInput({
        content: 'fix {{@src/foo.ts}}',
        workspaceRoot: '/workspace',
        parts: [
          { id: 'part0078', type: 'text', text: 'fix ' },
          {
            type: 'file',
            id: 'file-part-1',
            filename: 'foo.ts',
            mime: 'text/plain',
            url: 'file:///workspace/src/foo.ts',
            path: 'src/foo.ts',
            sourceText: { start: 4, end: 19, value: '{{@src/foo.ts}}' }
          }
        ]
      })
    );

    expect(materializeFileParts).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: expect.arrayContaining([expect.objectContaining({ type: 'file', path: 'src/foo.ts' })])
      })
    );
    expect(persistedMessages[0].parts[1]).toMatchObject({
      type: 'file',
      snapshot: expect.objectContaining({ startLine: 1, endLine: expect.any(Number) })
    });
  });

  it('uses renderer supplied user message identity when provided', async (): Promise<void> => {
    const collector = createEventCollector();
    const persistedMessages: Array<ChatRuntimeEventMap['chat:runtime:message-created']['message']> = [];
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (role) => `${role}-generated-message`,
      now: () => '2026-06-19T00:00:00.000Z',
      streamExecutor: createNoopStreamExecutor(),
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (message) => {
          persistedMessages.push(message);
        },
        updateMessage: (): void => undefined
      }
    });

    await service.send(
      createInput({
        userMessageId: 'renderer-user-message',
        userMessageCreatedAt: '2026-06-19T01:00:00.000Z'
      })
    );

    expect(persistedMessages[0]).toMatchObject({
      id: 'renderer-user-message',
      createdAt: '2026-06-19T01:00:00.000Z'
    });
    expect(persistedMessages[1]).toMatchObject({
      id: 'assistant-generated-message',
      createdAt: '2026-06-19T01:00:00.000Z'
    });
  });

  it('updates and completes assistant message through the runtime stream executor', async (): Promise<void> => {
    const collector = createEventCollector();
    const persistedMessages: Array<ChatRuntimeEventMap['chat:runtime:message-created']['message']> = [];
    const updatedMessages: Array<ChatRuntimeEventMap['chat:runtime:message-updated']['message']> = [];
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (role) => `${role}-message-1`,
      now: () => '2026-06-19T00:00:00.000Z',
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (message) => {
          persistedMessages.push({ ...message, parts: [...message.parts] });
        },
        updateMessage: (message) => {
          updatedMessages.push({ ...message, parts: [...message.parts] });
        }
      },
      streamExecutor: async ({ assistantMessage }, updateAssistant) => {
        assistantMessage.content = 'hello from model';
        assistantMessage.parts = [{ id: 'part0079', type: 'text', text: 'hello from model' }];
        assistantMessage.loading = false;
        assistantMessage.finished = true;
        assistantMessage.usage = { inputTokens: 3, outputTokens: 4, totalTokens: 7 };
        await updateAssistant(assistantMessage);

        return { totalUsage: assistantMessage.usage };
      }
    });

    const result = await service.send(createInput({ content: 'hello runtime' }));
    await flushRuntimeTasks();

    expect(persistedMessages).toHaveLength(2);
    expect(updatedMessages).toHaveLength(1);
    expect(updatedMessages[0]).toMatchObject({
      id: 'assistant-message-1',
      runtimeId: result.runtimeId,
      content: 'hello from model',
      parts: [{ type: 'text', text: 'hello from model' }],
      loading: false,
      finished: true,
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 }
    });
    expect(collector.events).toContainEqual({
      name: 'chat:runtime:message-updated',
      payload: expect.objectContaining({
        runtimeId: result.runtimeId,
        message: expect.objectContaining({
          id: 'assistant-message-1',
          content: 'hello from model'
        })
      })
    });
    const completeEvent = collector.events.find((event) => event.name === 'chat:runtime:complete' && event.payload.runtimeId === result.runtimeId);
    expect(completeEvent?.payload).toMatchObject({
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 }
    });
  });

  it('submits renderer message parts into the active assistant message', async (): Promise<void> => {
    const collector = createEventCollector();
    const streamDeferred = createDeferred();
    const updatedMessages: Array<ChatRuntimeEventMap['chat:runtime:message-updated']['message']> = [];
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (role) => `${role}-message-1`,
      now: () => '2026-06-19T00:00:00.000Z',
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (message) => {
          updatedMessages.push({ ...message, parts: [...message.parts] });
        }
      },
      streamExecutor: async ({ assistantMessage }, updateAssistant) => {
        assistantMessage.parts.push({
          id: 'part-open-widget',
          type: 'tool',
          toolCallId: 'tool-call-widget',
          toolName: 'open_widget',
          status: 'done',
          input: { id: 'weather' },
          result: {
            toolName: 'open_widget',
            status: 'success',
            data: {
              sessionId: 'widget-weather-tool-call-widget',
              widgetId: 'weather',
              value: {},
              execution: { status: 'success', output: undefined }
            }
          }
        });
        await updateAssistant(structuredClone(assistantMessage));
        await streamDeferred.promise;
        assistantMessage.content = '继续输出';
        assistantMessage.parts.push({ id: 'part-stream-text', type: 'text', text: '继续输出' });
        return {};
      }
    });

    const result = await service.send(createInput({ content: 'hello runtime' }));
    await flushRuntimeTasks();

    await service.submitMessagePart({
      runtimeId: result.runtimeId,
      messageId: 'assistant-message-1',
      part: {
        id: 'part-open-widget',
        type: 'tool',
        toolCallId: 'tool-call-widget',
        toolName: 'open_widget',
        status: 'done',
        input: { id: 'weather' },
        result: {
          toolName: 'open_widget',
          status: 'success',
          data: {
            sessionId: 'widget-weather-tool-call-widget',
            widgetId: 'weather',
            value: {},
            renderContext: {
              input: { city: '上海' },
              output: undefined,
              data: { weather: { temperature: 29 } },
              isMounted: true
            },
            execution: { status: 'success', output: undefined }
          }
        }
      }
    });
    streamDeferred.resolve();
    await flushRuntimeTasks();

    const submittedMessage = updatedMessages.find((message): boolean => {
      const part = message.parts[0];
      if (part?.type !== 'tool' || part.result?.status !== 'success' || typeof part.result.data !== 'object' || part.result.data === null) {
        return false;
      }
      const { renderContext } = part.result.data as { renderContext?: unknown };
      return typeof renderContext === 'object' && renderContext !== null && (renderContext as { isMounted?: unknown }).isMounted === true;
    });
    expect(submittedMessage).toMatchObject({
      id: 'assistant-message-1',
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-widget',
          result: {
            data: {
              renderContext: {
                data: { weather: { temperature: 29 } },
                isMounted: true
              }
            }
          }
        }
      ]
    });
    expect(updatedMessages.at(-1)?.parts).toEqual([
      expect.objectContaining({
        type: 'tool',
        toolCallId: 'tool-call-widget',
        result: expect.objectContaining({
          data: expect.objectContaining({
            renderContext: expect.objectContaining({
              isMounted: true
            })
          })
        })
      }),
      expect.objectContaining({ type: 'text', text: '继续输出' })
    ]);
    expect(collector.events).toContainEqual(
      expect.objectContaining({
        name: 'chat:runtime:message-updated',
        payload: expect.objectContaining({
          runtimeId: result.runtimeId,
          message: expect.objectContaining({
            parts: expect.arrayContaining([
              expect.objectContaining({
                type: 'tool',
                toolCallId: 'tool-call-widget'
              })
            ])
          })
        })
      })
    );
  });

  it('merges renderer part updates through the safe snapshot without leaking hidden deferred parts', async (): Promise<void> => {
    const collector = createEventCollector();
    const hiddenReady = createDeferred();
    const inspectWorking = createDeferred();
    const workingInspected = createDeferred();
    const holdStream = createDeferred();
    const persistedUpdates: ChatMessageRecord[] = [];
    let workingVisibleText: string | undefined;
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (role) => `${role}-message-safe-part`,
      now: () => '2026-06-19T00:00:00.000Z',
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (message): void => {
          persistedUpdates.push(structuredClone(message));
        }
      },
      streamExecutor: async ({ assistantMessage }, updateAssistant) => {
        const visiblePart: ChatMessagePart = { id: 'visible-part', type: 'text', text: 'initial' };
        assistantMessage.parts.push(visiblePart);
        await updateAssistant(structuredClone(assistantMessage));
        assistantMessage.parts.push({
          id: 'hidden-delegate-part',
          type: 'tool',
          toolCallId: 'delegate-call-hidden',
          toolName: 'delegate_task',
          status: 'inputting',
          input: null,
          inputText: '{"task":"secret'
        });
        await updateAssistant({
          ...structuredClone(assistantMessage),
          parts: [structuredClone(visiblePart)]
        });
        hiddenReady.resolve();
        await inspectWorking.promise;
        const currentVisiblePart = assistantMessage.parts.find((part): boolean => part.id === 'visible-part');
        workingVisibleText = currentVisiblePart?.type === 'text' ? currentVisiblePart.text : undefined;
        workingInspected.resolve();
        await holdStream.promise;
        return {};
      }
    });

    const result = await service.send(createInput({ content: 'update visible part safely' }));
    await hiddenReady.promise;

    await service.submitMessagePart({
      runtimeId: result.runtimeId,
      messageId: 'assistant-message-safe-part',
      part: { id: 'visible-part', type: 'text', text: 'renderer updated' }
    });
    inspectWorking.resolve();
    await workingInspected.promise;

    await expect(
      service.submitMessagePart({
        runtimeId: result.runtimeId,
        messageId: 'assistant-message-safe-part',
        part: {
          id: 'hidden-delegate-part',
          type: 'tool',
          toolCallId: 'delegate-call-hidden',
          toolName: 'delegate_task',
          status: 'inputting',
          input: null,
          inputText: '{"task":"changed'
        }
      })
    ).rejects.toMatchObject({ code: 'MESSAGE_PART_NOT_ACTIVE' });
    expect(workingVisibleText).toBe('renderer updated');
    expect(
      persistedUpdates.every((message): boolean => message.parts.every((part): boolean => part.type !== 'tool' || part.toolCallId !== 'delegate-call-hidden'))
    ).toBe(true);
    const updatedEvents = collector.events.filter((event) => event.name === 'chat:runtime:message-updated');
    expect(
      updatedEvents.every((event): boolean =>
        event.payload.message.parts.every((part): boolean => part.type !== 'tool' || part.toolCallId !== 'delegate-call-hidden')
      )
    ).toBe(true);

    await service.abort({ runtimeId: result.runtimeId });
    holdStream.resolve();
    await flushRuntimeTasks();
  });

  it('returns the runtime start result before the stream executor finishes', async (): Promise<void> => {
    const collector = createEventCollector();
    const streamDeferred = createDeferred();
    const service = createChatRuntimeService({
      emit: collector.emit,
      messageWriter: createNoopMessageWriter(),
      messageReader: createNoopMessageReader(),
      streamExecutor: async () => {
        await streamDeferred.promise;
        return {};
      }
    });

    const result = await Promise.race([
      service.send(createInput()),
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), 10);
      })
    ]);

    expect(result).not.toBe('timeout');
    if (result === 'timeout') return;
    expect(service.getActiveRuntime(result.runtimeId)?.status).toBe('running');

    streamDeferred.resolve();
    await Promise.resolve();
  });

  it('passes persisted session messages into the stream executor', async (): Promise<void> => {
    const collector = createEventCollector();
    const sourceMessagesByExecutor: Array<ChatRuntimeEventMap['chat:runtime:message-created']['message']> = [];
    const service = createChatRuntimeService({
      emit: collector.emit,
      messageWriter: createNoopMessageWriter(),
      messageReader: {
        getMessages: () => [
          {
            id: 'prior-user',
            sessionId: 'session-1',
            role: 'user',
            content: 'prior question',
            parts: [{ id: 'part0081', type: 'text', text: 'prior question' }],
            createdAt: '2026-06-19T00:00:00.000Z'
          }
        ]
      },
      streamExecutor: async ({ sourceMessages }) => {
        sourceMessagesByExecutor.push(...(sourceMessages ?? []));
        return {};
      }
    });

    await service.send(createInput({ content: 'current question' }));
    await flushRuntimeTasks();

    expect(sourceMessagesByExecutor).toEqual([
      expect.objectContaining({ id: 'prior-user', content: 'prior question' }),
      expect.objectContaining({ role: 'user', content: 'current question' })
    ]);
  });

  it('continues the runtime stream after renderer tool results are written', async (): Promise<void> => {
    const collector = createEventCollector();
    const streamExecutor = vi.fn<ChatRuntimeStreamExecutor>(async ({ assistantMessage }, updateAssistant) => {
      if (streamExecutor.mock.calls.length === 1) {
        assistantMessage.parts = [
          {
            id: 'part0086',
            type: 'tool',
            toolCallId: 'tool-call-1',
            toolName: 'read_file',
            status: 'done',
            input: { path: 'src/index.ts' },
            result: { toolName: 'read_file', status: 'success', data: { content: 'ok' } }
          }
        ];
        await updateAssistant(assistantMessage);
        return { shouldContinue: true };
      }

      assistantMessage.content = 'final answer';
      assistantMessage.parts = [...assistantMessage.parts, { id: 'part0087', type: 'text', text: 'final answer' }];
      assistantMessage.loading = false;
      assistantMessage.finished = true;
      await updateAssistant(assistantMessage);
      return {};
    });
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (role) => `${role}-message-1`,
      now: () => '2026-06-19T00:00:00.000Z',
      messageReader: createNoopMessageReader(),
      messageWriter: createNoopMessageWriter(),
      streamExecutor
    });

    const result = await service.send(createInput({ content: 'inspect file' }));
    await flushRuntimeTasks();

    expect(result.runtimeId).toMatch(/^runtime-/);
    expect(streamExecutor).toHaveBeenCalledTimes(2);
    expect(streamExecutor.mock.calls[1]?.[0].sourceMessages?.map((message) => message.id)).toEqual(['user-message-1', 'assistant-message-1']);
    expect(collector.events).toContainEqual(
      expect.objectContaining({
        name: 'chat:runtime:complete',
        payload: expect.objectContaining({ runtimeId: result.runtimeId })
      })
    );
  });

  it('projects WebView history before the next same-turn model request', async (): Promise<void> => {
    let projectedAssistant: ChatMessageRecord | undefined;
    const streamExecutor = vi.fn<ChatRuntimeStreamExecutor>(async ({ assistantMessage, sourceMessages }, updateAssistant) => {
      if (streamExecutor.mock.calls.length === 1) {
        assistantMessage.parts = [
          {
            id: 'webview-read-old',
            type: 'tool',
            toolCallId: 'webview-call-old',
            toolName: 'read_current_webpage',
            status: 'done',
            input: {},
            rendererHistory: { mode: 'latest-only', placeholder: '历史网页快照已裁剪，请重新读取当前网页。' },
            result: {
              toolName: 'read_current_webpage',
              status: 'success',
              data: {
                url: 'https://example.com/old',
                title: 'Old',
                summary: 'OLD_DOM_SENTINEL',
                header: 'Old header',
                content: 'OLD_DOM_SENTINEL',
                footer: 'Old footer',
                text: 'Old text',
                selectedText: '',
                headings: [],
                links: [],
                truncated: {},
                snapshotId: 'webview-snapshot-OLD_SNAPSHOT_SENTINEL',
                capturedAt: 1
              }
            }
          },
          {
            id: 'webview-operate',
            type: 'tool',
            toolCallId: 'webview-call-operate',
            toolName: 'operate_current_webpage',
            status: 'done',
            input: {
              snapshotId: 'webview-snapshot-OLD_SNAPSHOT_SENTINEL',
              step: {
                evaluation: '[2]<button>旧页面按钮</button>',
                memory: '稳定事实：商品价格 ¥820',
                nextGoal: '读取更新后的页面'
              },
              action: { type: 'click', index: 2 }
            },
            rendererHistory: {
              mode: 'keep',
              redactInputPaths: ['snapshotId', 'step', 'action.text', 'action.url', 'action.optionText']
            },
            result: { toolName: 'operate_current_webpage', status: 'success', data: { ok: true, action: 'click' } }
          },
          {
            id: 'webview-read-current',
            type: 'tool',
            toolCallId: 'webview-call-current',
            toolName: 'read_current_webpage',
            status: 'done',
            input: {},
            rendererHistory: { mode: 'latest-only', placeholder: '历史网页快照已裁剪，请重新读取当前网页。' },
            result: {
              toolName: 'read_current_webpage',
              status: 'success',
              data: {
                url: 'https://example.com/current',
                title: 'Current',
                summary: 'CURRENT_DOM_SENTINEL',
                header: 'Current header',
                content: 'CURRENT_DOM_SENTINEL',
                footer: 'Current footer',
                text: 'Current text',
                selectedText: '',
                headings: [],
                links: [],
                truncated: {},
                snapshotId: 'webview-snapshot-CURRENT_SNAPSHOT_SENTINEL',
                capturedAt: 2
              }
            }
          }
        ];
        await updateAssistant(assistantMessage);
        return { shouldContinue: true };
      }

      projectedAssistant = sourceMessages?.find((message) => message.id === assistantMessage.id);
      return {};
    });
    const service = createChatRuntimeService({
      emit: vi.fn(),
      createMessageId: (role) => `${role}-message-webview-round`,
      now: () => '2026-08-03T00:00:00.000Z',
      messageReader: createNoopMessageReader(),
      messageWriter: createNoopMessageWriter(),
      streamExecutor
    });

    await service.send(createInput({ content: '检查网页' }));
    await flushRuntimeTasks();

    expect(streamExecutor).toHaveBeenCalledTimes(2);
    const serialized = JSON.stringify(projectedAssistant);
    expect(serialized).not.toContain('OLD_DOM_SENTINEL');
    expect(serialized).not.toContain('OLD_SNAPSHOT_SENTINEL');
    expect(serialized).not.toContain('<button>');
    expect(serialized).not.toContain('稳定事实：商品价格 ¥820');
    expect(serialized).toContain('CURRENT_DOM_SENTINEL');
    expect(serialized).toContain('CURRENT_SNAPSHOT_SENTINEL');
    expect(projectedAssistant?.parts[0]).toMatchObject({ result: { data: { pruned: true } } });
    expect(projectedAssistant?.parts[1]).toMatchObject({ input: { action: { type: 'click', index: 2 } } });
  });

  it('continues after more than 300 seconds without a task-wide Runtime deadline', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const collector = createEventCollector();
      let service: ReturnType<typeof createChatRuntimeService>;
      const streamExecutor = vi.fn<ChatRuntimeStreamExecutor>(async ({ runtime, assistantMessage }, updateAssistant) => {
        if (streamExecutor.mock.calls.length === 1) {
          assistantMessage.parts = [
            {
              id: 'part-confirmation-wait',
              type: 'tool',
              toolCallId: 'tool-call-confirmation-wait',
              toolName: 'write_file',
              status: 'done',
              input: { path: 'src/index.ts', content: 'ok' },
              result: { toolName: 'write_file', status: 'success', data: { path: 'src/index.ts', content: 'ok', created: true } }
            }
          ];
          await updateAssistant(assistantMessage);
          await service.requestConfirmation({
            runtimeId: runtime.runtimeId,
            toolCallId: 'tool-call-confirmation-wait',
            confirmationId: 'confirmation-wait',
            request: {
              toolCallId: 'tool-call-confirmation-wait',
              toolName: 'write_file',
              title: '写入文件',
              description: '是否写入 src/index.ts？',
              riskLevel: 'write'
            }
          });
          return { shouldContinue: true };
        }

        assistantMessage.content = 'final answer';
        assistantMessage.parts = [...assistantMessage.parts, { id: 'part-after-confirmation-wait', type: 'text', text: 'final answer' }];
        assistantMessage.loading = false;
        assistantMessage.finished = true;
        await updateAssistant(assistantMessage);
        return {};
      });
      service = createChatRuntimeService({
        emit: collector.emit,
        createMessageId: (role) => `${role}-message-confirmation-wait`,
        now: () => '2026-07-19T00:00:00.000Z',
        messageReader: createNoopMessageReader(),
        messageWriter: createNoopMessageWriter(),
        streamExecutor
      });

      const result = await service.send(createInput({ content: 'write file after long confirmation' }));
      /** 判断当前 runtime 是否已经完成。 */
      const didComplete = (): boolean =>
        collector.events.some((event): boolean => event.name === 'chat:runtime:complete' && event.payload.runtimeId === result.runtimeId);
      await flushUntil(() => streamExecutor.mock.calls.length === 1);
      expect(streamExecutor).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(301_000);
      service.submitConfirmation({
        runtimeId: result.runtimeId,
        confirmationId: 'confirmation-wait',
        decision: { approved: true }
      });
      await flushUntil(() => streamExecutor.mock.calls.length === 2);
      await flushUntil(didComplete);

      expect(streamExecutor).toHaveBeenCalledTimes(2);
      expect(streamExecutor.mock.calls[1]?.[0]).not.toHaveProperty('totalTimeoutMs');
      expect(didComplete()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps explicit Skill context across tool continuation rounds without persisting its content', async (): Promise<void> => {
    const collector = createEventCollector();
    const addedMessages: ChatMessageRecord[] = [];
    const sourceTexts: string[] = [];
    const skillContent = `Use deterministic weather instructions. ${'x'.repeat(4_000)}`;
    const streamExecutor = vi.fn<ChatRuntimeStreamExecutor>(async ({ assistantMessage, sourceMessages }, updateAssistant) => {
      const selectedUser = sourceMessages?.find((message) => message.id === 'user-message-skill');
      sourceTexts.push(
        selectedUser?.parts
          .filter((part): part is Extract<ChatMessagePart, { type: 'text' }> => part.type === 'text')
          .map((part) => part.text)
          .join('') ?? ''
      );

      if (streamExecutor.mock.calls.length === 1) {
        assistantMessage.parts = [
          {
            id: 'skill-round-tool',
            type: 'tool',
            toolCallId: 'skill-round-tool-call',
            toolName: 'read_file',
            status: 'done',
            input: { path: 'src/index.ts' },
            result: { toolName: 'read_file', status: 'success', data: { content: 'ok' } }
          }
        ];
        await updateAssistant(assistantMessage);
        return { shouldContinue: true };
      }

      assistantMessage.content = 'done';
      assistantMessage.parts.push({ id: 'skill-round-final', type: 'text', text: 'done' });
      assistantMessage.loading = false;
      assistantMessage.finished = true;
      await updateAssistant(assistantMessage);
      return {};
    });
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (role) => `${role}-message-skill`,
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (message): void => {
          addedMessages.push(structuredClone(message));
        },
        updateMessage: (): void => undefined
      },
      streamExecutor
    });

    await service.send(
      createInput({
        content: '$weather 查询上海',
        contextWindow: 100_000,
        userMessageId: 'user-message-skill',
        parts: [
          {
            id: 'skill-reference-weather',
            type: 'skill_reference',
            name: 'weather',
            sourceText: { start: 0, end: 12, value: '{{$weather}}' }
          },
          { id: 'skill-request-text', type: 'text', text: ' 查询上海' }
        ],
        runtimeContext: {
          skill: {
            targetMessageId: 'user-message-skill',
            snapshots: [
              {
                name: 'weather',
                content: skillContent,
                contentHash: 'weather-hash',
                filePath: '/skills/weather/SKILL.md'
              }
            ]
          }
        }
      })
    );
    await flushRuntimeTasks();

    expect(streamExecutor).toHaveBeenCalledTimes(2);
    expect(sourceTexts).toHaveLength(2);
    expect(sourceTexts.every((text: string): boolean => text.includes('Use deterministic weather instructions.'))).toBe(true);
    expect(JSON.stringify(addedMessages)).not.toContain(skillContent);
    expect(addedMessages[0]?.parts).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'skill_reference', name: 'weather' })]));
    const usageEvents = collector.events.filter((event): boolean => event.name === 'chat:runtime:context-usage-updated');
    const requestUsage = usageEvents.at(-2)?.payload as ChatRuntimeEventMap['chat:runtime:context-usage-updated'];
    const finalUsage = usageEvents.at(-1)?.payload as ChatRuntimeEventMap['chat:runtime:context-usage-updated'];
    expect(usageEvents.length).toBeGreaterThanOrEqual(3);
    expect(requestUsage.snapshot.usedTokens).toBeGreaterThan(finalUsage.snapshot.usedTokens);
  });

  it('keeps assistant message unfinished when the stream pauses for user choice', async (): Promise<void> => {
    const collector = createEventCollector();
    const updatedMessages: ChatMessageRecord[] = [];
    let isRuntimeActiveWhenQuestionPublished: boolean | undefined;
    let service: ReturnType<typeof createChatRuntimeService>;

    /** 捕获事件并记录 Question 首次发布时旧 Runtime 是否仍占用会话。 */
    function emit<TName extends keyof ChatRuntimeEventMap>(name: TName, payload: ChatRuntimeEventMap[TName]): void {
      if (name === 'chat:runtime:message-updated') {
        const event = payload as ChatRuntimeEventMap['chat:runtime:message-updated'];
        const isAwaitingUserInput = event.message.parts.some((part) => part.type === 'tool' && part.result?.status === 'awaiting_user_input');
        if (isAwaitingUserInput) isRuntimeActiveWhenQuestionPublished = service.getActiveRuntime(event.runtimeId) !== undefined;
      }
      collector.emit(name, payload);
    }

    const streamExecutor = vi.fn<ChatRuntimeStreamExecutor>(async ({ assistantMessage }, updateAssistant) => {
      assistantMessage.parts = [createAwaitingUserChoicePart()];
      assistantMessage.loading = false;
      assistantMessage.finished = true;
      await updateAssistant(assistantMessage);
      return {};
    });
    service = createChatRuntimeService({
      emit,
      createMessageId: (role) => `${role}-message-1`,
      now: () => '2026-06-19T00:00:00.000Z',
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (message) => {
          updatedMessages.push({ ...message, parts: [...message.parts] });
        }
      },
      streamExecutor
    });

    const result = await service.send(createInput({ content: 'order coffee' }));
    await flushRuntimeTasks();

    expect(updatedMessages.at(-1)).toMatchObject({
      id: 'assistant-message-1',
      loading: true,
      finished: false,
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-question',
          toolName: 'question',
          result: {
            toolName: 'question',
            status: 'awaiting_user_input',
            data: expect.objectContaining({ questionId: 'question-1' })
          }
        }
      ]
    });
    expect(isRuntimeActiveWhenQuestionPublished).toBe(false);
    expect(collector.events).toContainEqual(
      expect.objectContaining({
        name: 'chat:runtime:complete',
        payload: expect.objectContaining({
          runtimeId: result.runtimeId,
          reason: 'awaiting_user_input',
          interaction: {
            type: 'userChoice',
            status: 'pending',
            sessionId: 'session-1',
            messageId: 'assistant-message-1',
            runtimeId: result.runtimeId,
            agentId: 'primary',
            toolCallId: 'tool-call-question',
            questionId: 'question-1'
          }
        })
      })
    );
  });

  it('fails an awaiting user choice when the runtime errors before pausing', async (): Promise<void> => {
    const collector = createEventCollector();
    const updatedMessages: ChatMessageRecord[] = [];
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (role) => `${role}-message-1`,
      now: () => '2026-07-13T00:00:00.000Z',
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (message) => {
          updatedMessages.push({ ...message, parts: message.parts.map((part) => ({ ...part })) });
        }
      },
      streamExecutor: async ({ assistantMessage }, updateAssistant) => {
        assistantMessage.parts.push(createAwaitingUserChoicePart());
        assistantMessage.loading = true;
        assistantMessage.finished = false;
        await updateAssistant(assistantMessage);
        throw new Error('暂停前持久化失败');
      }
    });

    const result = await service.send(createInput());
    await flushRuntimeTasks();

    expect(updatedMessages.at(-1)).toMatchObject({
      loading: false,
      finished: true,
      parts: [
        expect.objectContaining({
          result: {
            toolName: 'question',
            status: 'failure',
            error: { code: 'EXECUTION_FAILED', message: '暂停前持久化失败' }
          }
        })
      ]
    });
    const terminalEventNames = collector.events
      .filter(
        (event): boolean =>
          event.payload.runtimeId === result.runtimeId && ['chat:runtime:message-updated', 'chat:runtime:error', 'chat:runtime:complete'].includes(event.name)
      )
      .map((event): string => event.name);

    expect(terminalEventNames).toEqual(['chat:runtime:message-updated', 'chat:runtime:error']);
  });

  it('continues beyond five distinct tool steps until the model naturally stops', async (): Promise<void> => {
    const updatedMessages: ChatMessageRecord[] = [];
    const streamExecutor = vi.fn<ChatRuntimeStreamExecutor>(async ({ assistantMessage, runtime, forceFinal }, updateAssistant) => {
      const callNumber = streamExecutor.mock.calls.length;

      if (callNumber > 6) {
        assistantMessage.content = 'natural final answer';
        assistantMessage.parts.push({ id: 'part-natural-final', type: 'text', text: 'natural final answer' });
        assistantMessage.loading = false;
        assistantMessage.finished = true;
        await updateAssistant(assistantMessage);
        return {};
      }

      assistantMessage.parts = [
        {
          id: `part-limit-${callNumber}`,
          type: 'tool',
          toolCallId: `tool-call-limit-${callNumber}`,
          toolName: 'read_file',
          status: 'done',
          input: { path: `src/file-${callNumber}.ts` },
          result: { toolName: 'read_file', status: 'success', data: { content: 'ok' } }
        }
      ];
      assistantMessage.loading = false;
      assistantMessage.finished = false;
      // 流式执行器测试替身需要同步写入当前步骤快照，模拟真实 executor 行为。
      const part = assistantMessage.parts[0];
      if (part.type === 'tool') {
        runtime.currentToolStep = { toolCalls: [{ toolName: part.toolName, input: part.input }] };
      }
      expect(forceFinal).toBe(false);
      await updateAssistant(assistantMessage);
      return { shouldContinue: true };
    });
    const service = createChatRuntimeService({
      emit: createEventCollector().emit,
      createMessageId: (role) => `${role}-message-1`,
      now: () => '2026-06-19T00:00:00.000Z',
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (message) => {
          updatedMessages.push({ ...message, parts: [...message.parts] });
        }
      },
      streamExecutor
    });

    await service.send(createInput({ content: 'inspect file' }));
    await flushRuntimeTasks();

    expect(streamExecutor).toHaveBeenCalledTimes(7);
    expect(streamExecutor.mock.calls.every(([input]) => input.forceFinal === false)).toBe(true);
    expect(updatedMessages.at(-1)).toMatchObject({
      content: 'natural final answer',
      loading: false,
      finished: true
    });
  });

  it('forces a final answer after two equivalent cross-round tool calls', async (): Promise<void> => {
    const streamExecutor = vi.fn<ChatRuntimeStreamExecutor>(async ({ assistantMessage, forceFinal, runtime }, updateAssistant) => {
      if (forceFinal) {
        assistantMessage.content = 'final answer from existing results';
        assistantMessage.parts.push({ id: 'part-final-repeat', type: 'text', text: 'final answer from existing results' });
        assistantMessage.loading = false;
        assistantMessage.finished = true;
        await updateAssistant(assistantMessage);
        return {};
      }

      const callNumber = streamExecutor.mock.calls.length;
      assistantMessage.parts.push({
        id: `part-repeat-${callNumber}`,
        type: 'tool',
        toolCallId: `tool-call-repeat-${callNumber}`,
        toolName: 'read_file',
        status: 'done',
        input: { path: 'src/index.ts' },
        result: { toolName: 'read_file', status: 'success', data: { content: 'ok' } }
      });
      assistantMessage.loading = false;
      assistantMessage.finished = false;
      runtime.currentToolStep = { toolCalls: [{ toolName: 'read_file', input: { path: 'src/index.ts' } }] };
      await updateAssistant(assistantMessage);
      return { shouldContinue: true };
    });
    const service = createChatRuntimeService({
      emit: createEventCollector().emit,
      createMessageId: (role) => `${role}-message-repeat`,
      now: () => '2026-07-16T00:00:00.000Z',
      messageReader: createNoopMessageReader(),
      messageWriter: createNoopMessageWriter(),
      streamExecutor
    });

    await service.send(createInput({ content: 'inspect the same file' }));
    await flushRuntimeTasks();

    expect(streamExecutor).toHaveBeenCalledTimes(3);
    expect(streamExecutor.mock.calls[2]?.[0]).toMatchObject({ forceFinal: true });
  });

  it('waits for renderer confirmation decisions through the runtime confirmation bridge', async (): Promise<void> => {
    const collector = createEventCollector();
    const service = createChatRuntimeService({
      emit: collector.emit,
      messageWriter: createNoopMessageWriter(),
      messageReader: createNoopMessageReader(),
      streamExecutor: createNoopStreamExecutor(),
      keepRuntimeOpenForTest: true
    });

    const result = await service.send(createInput({ content: 'edit file' }));
    const decisionPromise = service.requestConfirmation({
      runtimeId: result.runtimeId,
      toolCallId: 'tool-call-1',
      confirmationId: 'confirmation-1',
      request: {
        toolCallId: 'tool-call-1',
        toolName: 'write_file',
        title: '写入文件',
        description: '是否写入 src/index.ts？',
        riskLevel: 'write'
      }
    });

    expect(collector.events).toContainEqual(
      expect.objectContaining({
        name: 'chat:runtime:confirmation-requested',
        payload: expect.objectContaining({
          runtimeId: result.runtimeId,
          sessionId: 'session-1',
          clientId: 'client-1',
          agentId: 'primary',
          toolCallId: 'tool-call-1',
          confirmationId: 'confirmation-1',
          request: expect.objectContaining({ toolName: 'write_file', title: '写入文件' })
        })
      })
    );

    service.submitConfirmation({
      runtimeId: result.runtimeId,
      confirmationId: 'confirmation-1',
      decision: { approved: true, grantScope: 'session' }
    });

    await expect(decisionPromise).resolves.toEqual({ approved: true, grantScope: 'session' });
  });

  it('projects active runtimes and their pending renderer requests for recovery', async (): Promise<void> => {
    const service = createChatRuntimeService({
      emit: vi.fn(),
      messageWriter: createNoopMessageWriter(),
      messageReader: createNoopMessageReader(),
      streamExecutor: createNoopStreamExecutor(),
      keepRuntimeOpenForTest: true
    });
    const capabilities = {
      rendererTools: [
        {
          name: 'inspect_registered_page',
          history: { mode: 'latest-only' as const, redactInputPaths: ['payload.secret'] }
        }
      ],
      toolContext: { providerId: 'editor', resourceId: 'document-1' }
    };
    const result = await service.send(createInput({ capabilities }));
    capabilities.rendererTools[0]?.history.redactInputPaths.push('payload.changed');
    const decisionPromise = service.requestConfirmation({
      runtimeId: result.runtimeId,
      confirmationId: 'confirmation-recovery',
      request: { toolName: 'write_file', title: '写入文件', description: '是否写入？', riskLevel: 'write' }
    });
    const bridgePromise = service.requestBridge({ runtimeId: result.runtimeId, requestId: 'bridge-recovery', kind: 'document-snapshot' });

    const snapshots = service.listRecoverySnapshots();
    expect(structuredClone(snapshots)).toEqual(snapshots);
    expect(snapshots).toEqual([
      expect.objectContaining({
        runtimeId: result.runtimeId,
        capabilities: {
          rendererTools: [
            {
              name: 'inspect_registered_page',
              history: { mode: 'latest-only', redactInputPaths: ['payload.secret'] }
            }
          ],
          toolContext: { providerId: 'editor', resourceId: 'document-1' }
        },
        pendingRequests: expect.arrayContaining([
          expect.objectContaining({ type: 'confirmation', event: expect.objectContaining({ confirmationId: 'confirmation-recovery' }) }),
          expect.objectContaining({ type: 'bridge', event: expect.objectContaining({ requestId: 'bridge-recovery' }) })
        ])
      })
    ]);

    service.submitConfirmation({ runtimeId: result.runtimeId, confirmationId: 'confirmation-recovery', decision: { approved: false } });
    service.submitBridgeResponse({ runtimeId: result.runtimeId, requestId: 'bridge-recovery', result: { status: 'success', data: null } });
    await Promise.all([decisionPromise, bridgePromise]);
    expect(service.listRecoverySnapshots()[0]?.pendingRequests).toEqual([]);
  });

  it('keeps renderer confirmation requests pending until a decision is submitted', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const collector = createEventCollector();
      const service = createChatRuntimeService({
        emit: collector.emit,
        messageWriter: createNoopMessageWriter(),
        messageReader: createNoopMessageReader(),
        streamExecutor: createNoopStreamExecutor(),
        keepRuntimeOpenForTest: true
      });

      const result = await service.send(createInput({ content: 'edit file' }));
      const decisionPromise = service.requestConfirmation({
        runtimeId: result.runtimeId,
        toolCallId: 'tool-call-timeout',
        confirmationId: 'confirmation-timeout',
        request: {
          toolCallId: 'tool-call-timeout',
          toolName: 'write_file',
          title: '写入文件',
          description: '是否写入 src/index.ts？',
          riskLevel: 'write'
        }
      });

      let settled = false;
      decisionPromise.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(30_000);
      await Promise.resolve();

      expect(settled).toBe(false);
      service.submitConfirmation({
        runtimeId: result.runtimeId,
        confirmationId: 'confirmation-timeout',
        decision: { approved: true }
      });

      await expect(decisionPromise).resolves.toEqual({ approved: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for renderer bridge responses through the runtime bridge', async (): Promise<void> => {
    const collector = createEventCollector();
    const service = createChatRuntimeService({
      emit: collector.emit,
      messageWriter: createNoopMessageWriter(),
      messageReader: createNoopMessageReader(),
      streamExecutor: createNoopStreamExecutor(),
      keepRuntimeOpenForTest: true
    });

    const result = await service.send(createInput({ content: 'read current document' }));
    const responsePromise = service.requestBridge({
      runtimeId: result.runtimeId,
      requestId: 'bridge-1',
      toolCallId: 'tool-call-1',
      kind: 'document-snapshot',
      payload: { includeSelection: true }
    });

    expect(collector.events).toContainEqual(
      expect.objectContaining({
        name: 'chat:runtime:bridge-requested',
        payload: expect.objectContaining({
          runtimeId: result.runtimeId,
          sessionId: 'session-1',
          clientId: 'client-1',
          agentId: 'primary',
          requestId: 'bridge-1',
          toolCallId: 'tool-call-1',
          kind: 'document-snapshot',
          payload: { includeSelection: true }
        })
      })
    );

    service.submitBridgeResponse({
      runtimeId: result.runtimeId,
      requestId: 'bridge-1',
      result: {
        status: 'success',
        data: { title: 'index.ts', content: 'hello' }
      }
    });

    await expect(responsePromise).resolves.toEqual({
      status: 'success',
      data: { title: 'index.ts', content: 'hello' }
    });
  });

  it('times out renderer bridge requests when no response is submitted', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const collector = createEventCollector();
      const service = createChatRuntimeService({
        emit: collector.emit,
        messageWriter: createNoopMessageWriter(),
        messageReader: createNoopMessageReader(),
        streamExecutor: createNoopStreamExecutor(),
        keepRuntimeOpenForTest: true
      });

      const result = await service.send(createInput({ content: 'read current document' }));
      const responsePromise = service.requestBridge({
        runtimeId: result.runtimeId,
        requestId: 'bridge-timeout',
        toolCallId: 'tool-call-timeout',
        kind: 'document-snapshot',
        payload: { includeSelection: true }
      });

      await vi.advanceTimersByTimeAsync(30_000);

      await expect(responsePromise).resolves.toMatchObject({
        status: 'failure',
        error: { code: 'TOOL_TIMEOUT' }
      });
      expect(() =>
        service.submitBridgeResponse({
          runtimeId: result.runtimeId,
          requestId: 'bridge-timeout',
          result: { status: 'success', data: { title: 'late' } }
        })
      ).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it('prunes old large tool results only in the model projection', async (): Promise<void> => {
    const collector = createEventCollector();
    const updatedMessages: ChatMessageRecord[] = [];
    const largeContent = 'x'.repeat(12_000);
    const oldAssistant: ChatMessageRecord = {
      id: 'old-assistant',
      sessionId: 'session-1',
      role: 'assistant',
      content: '',
      parts: [
        {
          id: 'part0093',
          type: 'tool',
          toolCallId: 'tool-call-old',
          toolName: 'read_file',
          status: 'done',
          input: { path: 'src/large.ts' },
          result: {
            toolName: 'read_file',
            status: 'success',
            data: { path: 'src/large.ts', totalLines: 400, readLines: 400, content: largeContent }
          }
        }
      ],
      createdAt: '2026-06-19T00:00:01.000Z',
      finished: true
    };
    const recentAssistant: ChatMessageRecord = {
      id: 'recent-assistant',
      sessionId: 'session-1',
      role: 'assistant',
      content: '',
      parts: [
        {
          id: 'part0094',
          type: 'tool',
          toolCallId: 'tool-call-recent',
          toolName: 'read_file',
          status: 'done',
          input: { path: 'src/recent.ts' },
          result: {
            toolName: 'read_file',
            status: 'success',
            data: { path: 'src/recent.ts', totalLines: 1, readLines: 1, content: largeContent }
          }
        }
      ],
      createdAt: '2026-06-19T00:00:05.000Z',
      finished: true
    };
    const persistedMessages = [
      createMessageRecord('old-user', 'user', 'old question', '2026-06-19T00:00:00.000Z'),
      oldAssistant,
      createMessageRecord('middle-user', 'user', 'middle question', '2026-06-19T00:00:02.000Z'),
      createMessageRecord('middle-assistant', 'assistant', 'middle answer', '2026-06-19T00:00:03.000Z'),
      createMessageRecord('recent-user', 'user', 'recent question', '2026-06-19T00:00:04.000Z'),
      recentAssistant
    ];
    let projectedOldAssistant: ChatMessageRecord | undefined;
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (role) => `${role}-message-1`,
      now: () => '2026-06-19T00:00:06.000Z',
      messageReader: { getMessages: () => persistedMessages },
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (message) => {
          updatedMessages.push({ ...message, parts: [...message.parts] });
        }
      },
      streamExecutor: async ({ assistantMessage, sourceMessages }, updateAssistant) => {
        projectedOldAssistant = sourceMessages?.find((message) => message.id === 'old-assistant');
        assistantMessage.content = 'done';
        assistantMessage.parts = [{ id: 'part0095', type: 'text', text: 'done' }];
        assistantMessage.loading = false;
        assistantMessage.finished = true;
        await updateAssistant(assistantMessage);
        return {};
      }
    });

    await service.send(createInput({ content: 'current question' }));
    await flushRuntimeTasks();

    const oldToolPart = projectedOldAssistant?.parts[0];
    expect(oldToolPart).toMatchObject({
      type: 'tool',
      toolCallId: 'tool-call-old',
      toolName: 'read_file',
      status: 'done',
      result: {
        toolName: 'read_file',
        status: 'success',
        data: expect.objectContaining({
          pruned: true,
          path: 'src/large.ts',
          totalLines: 400,
          readLines: 400
        })
      }
    });
    expect(JSON.stringify(oldToolPart)).not.toContain(largeContent);
    expect(updatedMessages.some((message) => message.id === 'old-assistant')).toBe(false);
    expect(persistedMessages.find((message) => message.id === 'old-assistant')).toEqual(oldAssistant);
    expect(
      collector.events.some(
        (event) => event.name === 'chat:runtime:message-updated' && 'message' in event.payload && event.payload.message.id === 'old-assistant'
      )
    ).toBe(false);
  });

  it('projects older declarative Renderer snapshots only in the model request', async (): Promise<void> => {
    const collector = createEventCollector();
    const updatedMessages: ChatMessageRecord[] = [];
    const oldAssistant: ChatMessageRecord = {
      id: 'old-webview-assistant',
      sessionId: 'session-1',
      role: 'assistant',
      content: '',
      parts: [
        {
          id: 'old-webview-part',
          type: 'tool',
          toolCallId: 'old-webview-call',
          toolName: 'read_current_webpage',
          status: 'done',
          input: {},
          rendererHistory: { mode: 'latest-only', placeholder: '历史网页快照已裁剪，请重新读取当前网页。' },
          result: {
            toolName: 'read_current_webpage',
            status: 'success',
            data: {
              url: 'https://example.com',
              title: 'Example',
              summary: 'DOM_SENTINEL',
              header: 'header',
              content: 'DOM_SENTINEL',
              footer: 'footer',
              text: 'DOM_SENTINEL',
              selectedText: '',
              headings: [],
              links: [],
              capturedAt: 1,
              truncated: {},
              snapshotId: 'webview-snapshot-SNAPSHOT_SENTINEL',
              elements: []
            }
          }
        },
        {
          id: 'current-webview-part',
          type: 'tool',
          toolCallId: 'current-webview-call',
          toolName: 'read_current_webpage',
          status: 'done',
          input: {},
          rendererHistory: { mode: 'latest-only', placeholder: '历史网页快照已裁剪，请重新读取当前网页。' },
          result: {
            toolName: 'read_current_webpage',
            status: 'success',
            data: { summary: 'CURRENT_RENDERER_RESULT', snapshotId: 'current-snapshot' }
          }
        }
      ],
      createdAt: '2026-06-19T00:00:01.000Z',
      finished: true
    };
    const persistedMessages = [createMessageRecord('old-webview-user', 'user', '读取网页', '2026-06-19T00:00:00.000Z'), oldAssistant];
    const original = structuredClone(persistedMessages);
    let projectedOldAssistant: ChatMessageRecord | undefined;
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (role) => `${role}-message-webview`,
      now: () => '2026-06-19T00:00:02.000Z',
      messageReader: { getMessages: (): ChatMessageRecord[] => persistedMessages },
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (message: ChatMessageRecord): void => {
          updatedMessages.push(structuredClone(message));
        }
      },
      streamExecutor: async ({ assistantMessage, sourceMessages }, updateAssistant) => {
        projectedOldAssistant = sourceMessages?.find((message) => message.id === 'old-webview-assistant');
        assistantMessage.content = 'done';
        assistantMessage.parts = [{ id: 'webview-answer', type: 'text', text: 'done' }];
        assistantMessage.loading = false;
        assistantMessage.finished = true;
        await updateAssistant(assistantMessage);
        return {};
      }
    });

    await service.send(createInput({ content: '继续处理' }));
    await flushRuntimeTasks();

    const serialized = JSON.stringify(projectedOldAssistant);
    expect(serialized).not.toContain('DOM_SENTINEL');
    expect(serialized).not.toContain('SNAPSHOT_SENTINEL');
    expect(projectedOldAssistant?.parts[0]).toMatchObject({
      type: 'tool',
      result: { data: { pruned: true, pruneReason: 'renderer_history_latest_only' } }
    });
    expect(serialized).toContain('CURRENT_RENDERER_RESULT');
    expect(persistedMessages).toEqual(original);
    expect(updatedMessages.some((message) => message.id === 'old-webview-assistant')).toBe(false);
    expect(
      collector.events.some(
        (event) => event.name === 'chat:runtime:message-updated' && 'message' in event.payload && event.payload.message.id === 'old-webview-assistant'
      )
    ).toBe(false);
  });

  it('automatically compacts before the first model request and preserves the current user task', async (): Promise<void> => {
    const messages: ChatMessageRecord[] = [
      {
        id: 'old-assistant',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'x'.repeat(13_000),
        parts: [{ id: 'old-source-part', type: 'text', text: 'x'.repeat(13_000) }],
        createdAt: '2026-07-16T00:00:00.000Z',
        finished: true
      }
    ];
    const order: string[] = [];
    const summaryRequests: AIRequestOptions[] = [];
    const skillContent = 'Use deterministic weather instructions without persisting this text.';
    let modelSourceMessages: ChatMessageRecord[] = [];
    const streamExecutor = vi.fn<ChatRuntimeStreamExecutor>(async ({ sourceMessages }) => {
      order.push('stream');
      modelSourceMessages = structuredClone(sourceMessages ?? []);
      return {};
    });
    /** 自动压缩使用的 Runtime 模型解析器。 */
    const resolveModel = vi.fn<(_model?: ChatRuntimeModelSelection) => Promise<ChatModelResolution | null>>(async () => createModelResolution());
    const service = createChatRuntimeService({
      emit: vi.fn(),
      createMessageId: (role) => `${role}-message-auto`,
      now: () => '2026-07-16T00:00:01.000Z',
      messageReader: { getMessages: (): ChatMessageRecord[] => structuredClone(messages) },
      messageWriter: {
        addMessage: async (message: ChatMessageRecord): Promise<void> => {
          messages.push(structuredClone(message));
        },
        updateMessage: async (message: ChatMessageRecord): Promise<void> => {
          const index = messages.findIndex((candidate: ChatMessageRecord): boolean => candidate.id === message.id);
          if (index >= 0) messages[index] = structuredClone(message);
          const checkpoint = message.parts.find((part: ChatMessagePart): boolean => part.type === 'compaction');
          if (checkpoint?.type === 'compaction') order.push(`write:${checkpoint.status}`);
        }
      },
      resolveModel,
      compactionGenerateText: async (_createOptions: AICreateOptions, request: AIRequestOptions): Promise<[undefined, AIInvokeResult]> => {
        summaryRequests.push(structuredClone(request));
        return [undefined, { text: '', output: createCompactionSummary('old-source-part') }];
      },
      streamExecutor
    });

    await service.send(
      createInput({
        content: '$weather 当前任务必须保留原文',
        contextWindow: 12_000,
        model: { providerId: 'provider-1', modelId: 'model-2' },
        userMessageId: 'user-message-auto',
        parts: [
          {
            id: 'skill-reference-auto',
            type: 'skill_reference',
            name: 'weather',
            sourceText: { start: 0, end: 12, value: '{{$weather}}' }
          },
          { id: 'skill-request-auto', type: 'text', text: ' 当前任务必须保留原文' }
        ],
        runtimeContext: {
          skill: {
            targetMessageId: 'user-message-auto',
            snapshots: [
              {
                name: 'weather',
                content: skillContent,
                contentHash: 'weather-auto-hash',
                filePath: '/skills/weather/SKILL.md'
              }
            ]
          }
        }
      })
    );
    await vi.waitFor((): void => {
      expect(streamExecutor).toHaveBeenCalledOnce();
    });

    expect(order.slice(0, 3)).toEqual(['write:pending', 'write:success', 'stream']);
    expect(modelSourceMessages[0]).toMatchObject({ id: expect.stringMatching(/^context-checkpoint:/u) });
    expect(JSON.stringify(modelSourceMessages)).toContain('当前任务必须保留原文');
    expect(JSON.stringify(modelSourceMessages)).toContain(skillContent);
    expect(JSON.stringify(modelSourceMessages)).not.toContain('x'.repeat(13_000));
    expect(JSON.stringify(summaryRequests)).not.toContain(skillContent);
    expect(JSON.stringify(messages)).not.toContain(skillContent);
    expect(resolveModel).toHaveBeenCalledWith({ providerId: 'provider-1', modelId: 'model-2' });
  });

  it('manually compacts into a compaction-only assistant message without creating a user message', async (): Promise<void> => {
    const collector = createEventCollector();
    const messages: ChatMessageRecord[] = [
      {
        id: 'old-assistant',
        sessionId: 'session-1',
        role: 'assistant',
        content: '历史内容',
        parts: [{ id: 'old-source-part', type: 'text', text: '历史内容' }],
        createdAt: '2026-07-16T00:00:00.000Z',
        finished: true
      }
    ];
    /** 手动压缩使用的 Runtime 模型解析器。 */
    const resolveModel = vi.fn<(_model?: ChatRuntimeModelSelection) => Promise<ChatModelResolution | null>>(async () => createModelResolution());
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (): string => 'assistant-manual-compaction',
      now: () => '2026-07-16T00:00:01.000Z',
      messageReader: { getMessages: (): ChatMessageRecord[] => structuredClone(messages) },
      messageWriter: {
        addMessage: async (message: ChatMessageRecord): Promise<void> => {
          messages.push(structuredClone(message));
        },
        updateMessage: async (message: ChatMessageRecord): Promise<void> => {
          const index = messages.findIndex((candidate: ChatMessageRecord): boolean => candidate.id === message.id);
          if (index >= 0) messages[index] = structuredClone(message);
        }
      },
      resolveModel,
      compactionGenerateText: async (): Promise<[undefined, AIInvokeResult]> => [undefined, { text: '', output: createCompactionSummary('old-source-part') }],
      streamExecutor: createNoopStreamExecutor()
    });
    const input: ChatRuntimeCompactInput = {
      runtimeId: 'runtime-manual-compact',
      sessionId: 'session-1',
      turnId: 'turn-manual-compact',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: 'runtime-manual-compact',
      model: { providerId: 'provider-1', modelId: 'model-2' },
      contextWindow: 12_000
    };

    const result = await service.compact(input);
    await vi.waitFor((): void => {
      expect(collector.events).toContainEqual(
        expect.objectContaining({ name: 'chat:runtime:complete', payload: expect.objectContaining({ runtimeId: 'runtime-manual-compact' }) })
      );
    });

    expect(result).toEqual({ runtimeId: 'runtime-manual-compact', sessionId: 'session-1' });
    const createdMessages = messages.filter((message: ChatMessageRecord): boolean => message.id !== 'old-assistant');
    expect(createdMessages).toHaveLength(1);
    expect(createdMessages[0]).toMatchObject({ role: 'assistant', content: '', loading: false, finished: true });
    expect(createdMessages[0].parts).toEqual([expect.objectContaining({ type: 'compaction', status: 'success' })]);
    expect(resolveModel).toHaveBeenCalledWith({ providerId: 'provider-1', modelId: 'model-2' });
  });

  it('rejects manual compaction before inserting a message when the session is busy', async (): Promise<void> => {
    const addedMessages: ChatMessageRecord[] = [];
    const service = createChatRuntimeService({
      emit: vi.fn(),
      messageWriter: {
        addMessage: async (message: ChatMessageRecord): Promise<void> => {
          addedMessages.push(structuredClone(message));
        },
        updateMessage: async (): Promise<void> => undefined
      },
      messageReader: createNoopMessageReader(),
      streamExecutor: createNoopStreamExecutor(),
      keepRuntimeOpenForTest: true
    });
    await service.send(createInput({ runtimeId: 'runtime-busy-owner' }));
    const messageCount = addedMessages.length;

    await expect(
      service.compact({
        runtimeId: 'runtime-busy-compact',
        sessionId: 'session-1',
        turnId: 'turn-busy-compact',
        clientId: 'bchat',
        agentId: 'primary',
        rootRuntimeId: 'runtime-busy-compact',
        contextWindow: 12_000
      })
    ).rejects.toMatchObject({ code: 'SESSION_BUSY' });
    expect(addedMessages).toHaveLength(messageCount);
  });

  it('settles an early aborted compaction placeholder without creating a synthetic part', async (): Promise<void> => {
    const collector = createEventCollector();
    const sourceReady = createDeferred();
    const messages: ChatMessageRecord[] = [];
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (kind): string => `${kind}-early-compact-cancel`,
      messageReader: {
        getMessages: async (): Promise<ChatMessageRecord[]> => {
          await sourceReady.promise;
          return [];
        }
      },
      messageWriter: {
        addMessage: async (message: ChatMessageRecord): Promise<void> => {
          messages.push(structuredClone(message));
        },
        updateMessage: async (message: ChatMessageRecord): Promise<void> => {
          const index = messages.findIndex((candidate: ChatMessageRecord): boolean => candidate.id === message.id);
          if (index >= 0) messages[index] = structuredClone(message);
        },
        deleteMessage: async (_sessionId: string, messageId: string): Promise<void> => {
          const index = messages.findIndex((message: ChatMessageRecord): boolean => message.id === messageId);
          if (index >= 0) messages.splice(index, 1);
        }
      },
      resolveModel: async () => createModelResolution(),
      streamExecutor: createNoopStreamExecutor()
    });

    await service.compact({
      runtimeId: 'runtime-early-compact-cancel',
      sessionId: 'session-1',
      turnId: 'turn-early-compact-cancel',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: 'runtime-early-compact-cancel',
      contextWindow: 12_000
    });
    await service.abort({ runtimeId: 'runtime-early-compact-cancel' });
    sourceReady.resolve();
    await flushRuntimeTasks();

    const compactionMessage = messages.find((message: ChatMessageRecord): boolean => message.id === 'assistant-early-compact-cancel');
    expect(compactionMessage).toMatchObject({ role: 'assistant', loading: false, finished: true });
    expect(compactionMessage?.parts).toEqual([]);
    expect(collector.events).not.toContainEqual(
      expect.objectContaining({ name: 'chat:runtime:message-deleted', payload: expect.objectContaining({ messageId: 'assistant-early-compact-cancel' }) })
    );
    expect(collector.events).not.toContainEqual(
      expect.objectContaining({
        name: 'chat:runtime:message-created',
        payload: expect.objectContaining({ message: expect.objectContaining({ role: 'interrupt' }) })
      })
    );
  });

  it('updates a cancelled manual compaction without creating an interrupt message', async (): Promise<void> => {
    const collector = createEventCollector();
    const executionGate = createDeferred();
    const executionStarted = createDeferred();
    const messages: ChatMessageRecord[] = [];
    const compactionExecutor: CompactionExecutor = {
      execute: async (input: CompactionExecuteInput): Promise<CompactionExecuteResult> => {
        const pendingPart: ChatMessageCompactionPart = {
          id: 'checkpoint-cancel-existing',
          type: 'compaction',
          status: 'pending',
          trigger: input.trigger,
          createdAt: 1
        };
        input.assistantMessage.parts.push(pendingPart);
        executionStarted.resolve();
        await executionGate.promise;
        const cancelledPart: ChatMessageCompactionPart = {
          ...pendingPart,
          status: 'cancelled',
          errorCode: 'USER_CANCELLED',
          completedAt: 2
        };
        input.assistantMessage.parts.splice(input.assistantMessage.parts.indexOf(pendingPart), 1, cancelledPart);
        return { status: 'cancelled', checkpoint: cancelledPart };
      },
      cancel: async (): Promise<void> => {
        executionGate.resolve();
      }
    };
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (kind): string => `${kind}-cancel-existing`,
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: async (message: ChatMessageRecord): Promise<void> => {
          messages.push(structuredClone(message));
        },
        updateMessage: async (message: ChatMessageRecord): Promise<void> => {
          const index = messages.findIndex((candidate: ChatMessageRecord): boolean => candidate.id === message.id);
          if (index >= 0) messages[index] = structuredClone(message);
        }
      },
      resolveModel: async () => createModelResolution(),
      compactionExecutor,
      streamExecutor: createNoopStreamExecutor()
    });

    await service.compact({
      runtimeId: 'runtime-cancel-existing',
      sessionId: 'session-1',
      turnId: 'turn-cancel-existing',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: 'runtime-cancel-existing',
      contextWindow: 12_000
    });
    await executionStarted.promise;
    const result = await service.abort({ runtimeId: 'runtime-cancel-existing' });

    expect(result.interruptMessage).toBeUndefined();
    expect(result.assistantMessage?.parts).toEqual([expect.objectContaining({ type: 'compaction', status: 'cancelled', errorCode: 'USER_CANCELLED' })]);
    expect(collector.events).not.toContainEqual(
      expect.objectContaining({
        name: 'chat:runtime:message-created',
        payload: expect.objectContaining({ message: expect.objectContaining({ role: 'interrupt' }) })
      })
    );
  });

  it('keeps the session lock until an aborted compaction reaches a persisted terminal state', async (): Promise<void> => {
    const executionGate = createDeferred();
    const executionStarted = createDeferred();
    const compactionExecutor: CompactionExecutor = {
      execute: async (input: CompactionExecuteInput): Promise<CompactionExecuteResult> => {
        const pendingPart = {
          id: 'checkpoint-abort-lock',
          type: 'compaction' as const,
          status: 'pending' as const,
          trigger: input.trigger,
          createdAt: 1
        };
        input.assistantMessage.parts.push(pendingPart);
        executionStarted.resolve();
        await executionGate.promise;
        const cancelledPart = { ...pendingPart, status: 'cancelled' as const, errorCode: 'USER_CANCELLED', completedAt: 2 };
        input.assistantMessage.parts.splice(input.assistantMessage.parts.indexOf(pendingPart), 1, cancelledPart);
        return { status: 'cancelled', checkpoint: cancelledPart };
      },
      cancel: async (): Promise<void> => executionGate.promise
    };
    const service = createChatRuntimeService({
      emit: vi.fn(),
      createMessageId: (kind): string => `${kind}-abort-lock`,
      messageReader: createNoopMessageReader(),
      messageWriter: createNoopMessageWriter(),
      resolveModel: async () => createModelResolution(),
      compactionExecutor,
      streamExecutor: createNoopStreamExecutor()
    });

    await service.compact({
      runtimeId: 'runtime-abort-lock',
      sessionId: 'session-1',
      turnId: 'turn-abort-lock',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: 'runtime-abort-lock',
      contextWindow: 12_000
    });
    await executionStarted.promise;
    const abortPromise = service.abort({ runtimeId: 'runtime-abort-lock' });
    await flushRuntimeTasks();

    let concurrentError: unknown;
    let concurrentRuntimeId: string | undefined;
    try {
      const concurrent = await service.send(createInput({ runtimeId: 'runtime-during-abort' }));
      concurrentRuntimeId = concurrent.runtimeId;
    } catch (error: unknown) {
      concurrentError = error;
    }
    executionGate.resolve();
    await abortPromise;
    if (concurrentRuntimeId) await service.abort({ runtimeId: concurrentRuntimeId });

    expect(concurrentError).toMatchObject({ code: 'SESSION_BUSY' });
    const afterAbort = await service.send(createInput({ runtimeId: 'runtime-after-abort' }));
    expect(afterAbort.sessionId).toBe('session-1');
    await service.abort({ runtimeId: afterAbort.runtimeId });
  });

  it('continues with the previous projection when automatic compaction fails below the hard limit', async (): Promise<void> => {
    const messages: ChatMessageRecord[] = [
      {
        id: 'old-assistant',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'x'.repeat(13_000),
        parts: [{ id: 'old-source-part', type: 'text', text: 'x'.repeat(13_000) }],
        createdAt: '2026-07-16T00:00:00.000Z',
        finished: true
      }
    ];
    const streamExecutor = vi.fn<ChatRuntimeStreamExecutor>(async () => ({}));
    const service = createChatRuntimeService({
      emit: vi.fn(),
      createMessageId: (role) => `${role}-message-failed-compaction`,
      messageReader: { getMessages: (): ChatMessageRecord[] => structuredClone(messages) },
      messageWriter: {
        addMessage: async (message: ChatMessageRecord): Promise<void> => {
          messages.push(structuredClone(message));
        },
        updateMessage: async (message: ChatMessageRecord): Promise<void> => {
          const index = messages.findIndex((candidate: ChatMessageRecord): boolean => candidate.id === message.id);
          if (index >= 0) messages[index] = structuredClone(message);
        }
      },
      resolveModel: async () => createModelResolution(),
      compactionGenerateText: async (): Promise<[AIServiceError]> => [{ code: 'REQUEST_FAILED', message: 'summary failed' }],
      streamExecutor
    });

    await service.send(createInput({ content: '当前任务', contextWindow: 12_000 }));
    await vi.waitFor((): void => {
      expect(streamExecutor).toHaveBeenCalledOnce();
    });

    const failed = messages.flatMap((message: ChatMessageRecord): ChatMessagePart[] => message.parts).find((part) => part.type === 'compaction');
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'MODEL_CALL_FAILED' });
  });

  it('prunes earlier active-turn output before same-message compaction', async (): Promise<void> => {
    const messages: ChatMessageRecord[] = [
      {
        id: 'old-assistant',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'x'.repeat(11_000),
        parts: [{ id: 'old-source-part', type: 'text', text: 'x'.repeat(11_000) }],
        createdAt: '2026-07-16T00:00:00.000Z',
        finished: true
      }
    ];
    const streamExecutor = vi.fn<ChatRuntimeStreamExecutor>(async ({ assistantMessage, sourceMessages }, updateAssistant) => {
      if (streamExecutor.mock.calls.length === 1) {
        assistantMessage.parts.push({
          id: 'long-tool-part-earlier',
          type: 'tool',
          toolCallId: 'long-tool-call-earlier',
          toolName: 'read_file',
          status: 'done',
          input: { path: 'src/large.ts' },
          result: {
            toolName: 'read_file',
            status: 'success',
            data: { artifactId: 'artifact-large', path: 'src/large.ts', content: 'y'.repeat(24_000) }
          }
        });
        assistantMessage.parts.push({
          id: 'long-tool-part-latest',
          type: 'tool',
          toolCallId: 'long-tool-call-latest',
          toolName: 'read_file',
          status: 'done',
          input: { path: 'src/current.ts' },
          result: { toolName: 'read_file', status: 'success', data: { path: 'src/current.ts', content: 'export const current = true' } }
        });
        await updateAssistant(assistantMessage);
        return { shouldContinue: true };
      }

      const projectedAssistant = sourceMessages?.find((message) => message.id === assistantMessage.id);
      expect(projectedAssistant?.parts).toEqual([
        expect.objectContaining({
          id: 'long-tool-part-earlier',
          result: expect.objectContaining({ data: expect.objectContaining({ artifactId: 'artifact-large', path: 'src/large.ts', pruned: true }) })
        }),
        expect.objectContaining({
          id: 'long-tool-part-latest',
          result: expect.objectContaining({ data: { path: 'src/current.ts', content: 'export const current = true' } })
        })
      ]);
      return {};
    });
    const service = createChatRuntimeService({
      emit: vi.fn(),
      createMessageId: (role) => `${role}-message-tool-round`,
      now: () => '2026-07-16T00:00:01.000Z',
      messageReader: { getMessages: (): ChatMessageRecord[] => structuredClone(messages) },
      messageWriter: {
        addMessage: async (message: ChatMessageRecord): Promise<void> => {
          messages.push(structuredClone(message));
        },
        updateMessage: async (message: ChatMessageRecord): Promise<void> => {
          const index = messages.findIndex((candidate: ChatMessageRecord): boolean => candidate.id === message.id);
          if (index >= 0) messages[index] = structuredClone(message);
        }
      },
      resolveModel: async () => createModelResolution(),
      compactionGenerateText: async (): Promise<[undefined, AIInvokeResult]> => [undefined, { text: '', output: createCompactionSummary('old-source-part') }],
      streamExecutor
    });

    await service.send(createInput({ content: '执行长任务', contextWindow: 12_000 }));
    await vi.waitFor((): void => {
      expect(streamExecutor).toHaveBeenCalledTimes(2);
    });

    const assistantMessage = messages.find((message) => message.id === 'assistant-message-tool-round');
    expect(assistantMessage?.parts.map((part: ChatMessagePart): string => part.type)).toEqual(['tool', 'tool', 'compaction']);
    expect(assistantMessage?.parts[0]).toMatchObject({ result: { data: { content: 'y'.repeat(24_000) } } });
    expect(assistantMessage?.parts[2]).toMatchObject({ status: 'success', boundaryPartId: 'old-source-part' });
  });

  it('keeps the session write lock while automatic summary generation is pending', async (): Promise<void> => {
    const messages: ChatMessageRecord[] = [
      {
        id: 'old-assistant',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'x'.repeat(13_000),
        parts: [{ id: 'old-source-part', type: 'text', text: 'x'.repeat(13_000) }],
        createdAt: '2026-07-16T00:00:00.000Z',
        finished: true
      }
    ];
    let resolveSummary: ((result: [undefined, AIInvokeResult]) => void) | undefined;
    const summaryPromise = new Promise<[undefined, AIInvokeResult]>((resolve): void => {
      resolveSummary = resolve;
    });
    const service = createChatRuntimeService({
      emit: vi.fn(),
      createMessageId: (role) => `${role}-message-lock-${messages.length}`,
      messageReader: { getMessages: (): ChatMessageRecord[] => structuredClone(messages) },
      messageWriter: {
        addMessage: async (message: ChatMessageRecord): Promise<void> => {
          messages.push(structuredClone(message));
        },
        updateMessage: async (message: ChatMessageRecord): Promise<void> => {
          const index = messages.findIndex((candidate: ChatMessageRecord): boolean => candidate.id === message.id);
          if (index >= 0) messages[index] = structuredClone(message);
        }
      },
      resolveModel: async () => createModelResolution(),
      compactionGenerateText: async (): Promise<[undefined, AIInvokeResult]> => summaryPromise,
      streamExecutor: createNoopStreamExecutor()
    });

    await service.send(createInput({ runtimeId: 'runtime-lock-owner', content: '当前任务', contextWindow: 12_000 }));
    await vi.waitFor((): void => {
      const pending = messages.flatMap((message: ChatMessageRecord): ChatMessagePart[] => message.parts).find((part) => part.type === 'compaction');
      expect(pending).toMatchObject({ status: 'pending' });
    });
    const messageCount = messages.length;

    await expect(service.send(createInput({ runtimeId: 'runtime-lock-contender', content: '不应写入', contextWindow: 12_000 }))).rejects.toMatchObject({
      code: 'SESSION_BUSY'
    });
    expect(messages).toHaveLength(messageCount);

    resolveSummary?.([undefined, { text: '', output: createCompactionSummary('old-source-part') }]);
  });

  it('does not call the main model when uncompressed projection reaches the hard limit', async (): Promise<void> => {
    const messages: ChatMessageRecord[] = [
      {
        id: 'old-assistant',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'x'.repeat(40_000),
        parts: [{ id: 'old-source-part', type: 'text', text: 'x'.repeat(40_000) }],
        createdAt: '2026-07-16T00:00:00.000Z',
        finished: true
      }
    ];
    const streamExecutor = vi.fn<ChatRuntimeStreamExecutor>(async () => ({}));
    const service = createChatRuntimeService({
      emit: vi.fn(),
      createMessageId: (role) => `${role}-message-hard-limit`,
      messageReader: { getMessages: (): ChatMessageRecord[] => structuredClone(messages) },
      messageWriter: {
        addMessage: async (message: ChatMessageRecord): Promise<void> => {
          messages.push(structuredClone(message));
        },
        updateMessage: async (message: ChatMessageRecord): Promise<void> => {
          const index = messages.findIndex((candidate: ChatMessageRecord): boolean => candidate.id === message.id);
          if (index >= 0) messages[index] = structuredClone(message);
        }
      },
      resolveModel: async () => createModelResolution(),
      compactionGenerateText: async (): Promise<[undefined, AIInvokeResult]> => [undefined, { text: '', output: createCompactionSummary('old-source-part') }],
      streamExecutor
    });

    await service.send(createInput({ content: '当前任务', contextWindow: 12_000 }));
    await vi.waitFor((): void => {
      const failed = messages.flatMap((message: ChatMessageRecord): ChatMessagePart[] => message.parts).find((part) => part.type === 'compaction');
      expect(failed).toMatchObject({ status: 'failed' });
    });

    expect(streamExecutor).not.toHaveBeenCalled();
  });

  it('accumulates usage from multiple continuation stream rounds', async (): Promise<void> => {
    const collector = createEventCollector();
    const updatedMessages: ChatMessageRecord[] = [];
    const firstUsage = { inputTokens: 8, outputTokens: 5, totalTokens: 13 };
    const secondUsage = { inputTokens: 3, outputTokens: 4, totalTokens: 7 };
    const streamExecutor = vi.fn<ChatRuntimeStreamExecutor>(async ({ assistantMessage }, updateAssistant) => {
      if (streamExecutor.mock.calls.length === 1) {
        assistantMessage.parts = [
          {
            id: 'part0096',
            type: 'tool',
            toolCallId: 'tool-call-1',
            toolName: 'read_file',
            status: 'done',
            input: { path: 'src/index.ts' },
            result: { toolName: 'read_file', status: 'success', data: { content: 'ok' } }
          }
        ];
        assistantMessage.usage = firstUsage;
        await updateAssistant(assistantMessage);
        return { totalUsage: firstUsage, shouldContinue: true };
      }

      assistantMessage.content = 'final answer';
      assistantMessage.parts = [...assistantMessage.parts, { id: 'part0097', type: 'text', text: 'final answer' }];
      assistantMessage.loading = false;
      assistantMessage.finished = true;
      assistantMessage.usage = secondUsage;
      await updateAssistant(assistantMessage);
      return { totalUsage: secondUsage };
    });
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (role) => `${role}-message-1`,
      now: () => '2026-06-19T00:00:00.000Z',
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (message) => {
          updatedMessages.push({ ...message, parts: [...message.parts] });
        }
      },
      streamExecutor
    });

    const result = await service.send(createInput({ content: 'inspect file' }));
    await flushRuntimeTasks();

    const expectedUsage = { inputTokens: 11, outputTokens: 9, totalTokens: 20 };
    expect(updatedMessages.at(-1)?.usage).toEqual(expectedUsage);
    expect(collector.events).toContainEqual(
      expect.objectContaining({
        name: 'chat:runtime:complete',
        payload: expect.objectContaining({ runtimeId: result.runtimeId, usage: expectedUsage })
      })
    );
  });

  it('continues from a user choice answer using the provided message snapshot', async (): Promise<void> => {
    const collector = createEventCollector();
    const updatedMessages: ChatMessageRecord[] = [];
    const userMessage: ChatMessageRecord = {
      id: 'user-1',
      sessionId: 'session-1',
      role: 'user',
      content: 'choose',
      parts: [{ id: 'part0098', type: 'text', text: 'choose' }],
      createdAt: '2026-06-19T00:00:00.000Z',
      finished: true
    };
    const assistantMessage: ChatMessageRecord = {
      id: 'assistant-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: '',
      parts: [
        {
          id: 'part0099',
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'ask_user_choice',
          status: 'done',
          input: { question: 'Continue?' },
          result: {
            toolName: 'ask_user_choice',
            status: 'success',
            data: { questionId: 'question-1', toolCallId: 'tool-call-1', answers: ['yes'] }
          }
        }
      ],
      createdAt: '',
      finished: false,
      loading: false
    };
    const streamExecutor = vi.fn<ChatRuntimeStreamExecutor>(async ({ assistantMessage: draft }, updateAssistant) => {
      draft.content = 'continued answer';
      draft.parts = [...draft.parts, { id: 'part0100', type: 'text', text: 'continued answer' }];
      draft.loading = false;
      draft.finished = true;
      await updateAssistant(draft);
      return {};
    });
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (role) => `${role}-message-1`,
      now: () => '2026-06-19T00:00:02.000Z',
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (message) => {
          updatedMessages.push({ ...message, parts: [...message.parts] });
        }
      },
      streamExecutor
    });

    const result = await service.continue(createContinueInput({ messages: [userMessage, assistantMessage], contextWindow: 200_000 }));
    await flushRuntimeTasks();

    expect(result.runtimeId).toMatch(/^runtime-/);
    expect(streamExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage,
        assistantMessage: expect.objectContaining({ id: 'assistant-1', runtimeId: result.runtimeId }),
        sourceMessages: [userMessage, expect.objectContaining({ id: 'assistant-1', runtimeId: result.runtimeId })]
      }),
      expect.any(Function)
    );
    expect(updatedMessages.at(-1)).toMatchObject({
      id: 'assistant-1',
      runtimeId: result.runtimeId,
      content: 'continued answer',
      createdAt: '2026-06-19T00:00:02.000Z',
      finished: true
    });
    expect(collector.events).toContainEqual(
      expect.objectContaining({
        name: 'chat:runtime:complete',
        payload: expect.objectContaining({ runtimeId: result.runtimeId })
      })
    );
  });

  it('creates an assistant placeholder when continuing from a user-only snapshot', async (): Promise<void> => {
    const collector = createEventCollector();
    const addedMessages: ChatMessageRecord[] = [];
    const updatedMessages: ChatMessageRecord[] = [];
    const userMessage: ChatMessageRecord = {
      id: 'user-regenerate',
      sessionId: 'session-1',
      role: 'user',
      content: '重新回答',
      parts: [{ id: 'part0101', type: 'text', text: '重新回答' }],
      createdAt: '2026-06-19T00:00:00.000Z',
      finished: true
    };
    const streamExecutor = vi.fn<ChatRuntimeStreamExecutor>(async ({ assistantMessage: draft }, updateAssistant) => {
      draft.content = '新回答';
      draft.parts = [{ id: 'part0102', type: 'text', text: '新回答' }];
      draft.loading = false;
      draft.finished = true;
      await updateAssistant(draft);
      return {};
    });
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (role) => `${role}-message-1`,
      now: () => '2026-06-19T00:00:02.000Z',
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (message) => {
          addedMessages.push({ ...message, parts: [...message.parts] });
        },
        updateMessage: (message) => {
          updatedMessages.push({ ...message, parts: [...message.parts] });
        }
      },
      streamExecutor
    });

    const result = await service.continue(createContinueInput({ messages: [userMessage], contextWindow: 200_000 }));
    await flushRuntimeTasks();

    expect(addedMessages).toEqual([
      expect.objectContaining({
        id: 'assistant-message-1',
        role: 'assistant',
        runtimeId: result.runtimeId,
        content: '',
        parts: [],
        loading: true,
        finished: false,
        createdAt: '2026-06-19T00:00:02.000Z'
      })
    ]);
    expect(collector.events).toContainEqual(
      expect.objectContaining({
        name: 'chat:runtime:message-created',
        payload: expect.objectContaining({
          runtimeId: result.runtimeId,
          message: expect.objectContaining({ id: 'assistant-message-1', role: 'assistant' })
        })
      })
    );
    expect(streamExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage,
        assistantMessage: expect.objectContaining({ id: 'assistant-message-1', runtimeId: result.runtimeId }),
        sourceMessages: [userMessage]
      }),
      expect.any(Function)
    );
    expect(updatedMessages.at(-1)).toMatchObject({
      id: 'assistant-message-1',
      content: '新回答',
      finished: true
    });
  });

  it('passes invalidated historical Skill results into continuation streams', async (): Promise<void> => {
    const previousUser = createMessageRecord('previous-user', 'user', 'previous question', '2026-06-19T00:00:00.000Z');
    const previousAssistant = createMessageRecord('previous-assistant', 'assistant', '', '2026-06-19T00:00:01.000Z');
    previousAssistant.parts = [
      {
        id: 'previous-skill-part',
        type: 'tool',
        toolCallId: 'previous-skill-call',
        toolName: 'skill',
        status: 'done',
        input: { name: 'weather' },
        result: {
          toolName: 'skill',
          status: 'success',
          data: '<skill_metadata><content_hash>old-hash</content_hash></skill_metadata><skill_content name="weather">old instructions</skill_content>'
        }
      }
    ];
    const currentUser = createMessageRecord('current-user', 'user', 'current question', '2026-06-19T00:00:02.000Z');
    const streamExecutor = vi.fn<ChatRuntimeStreamExecutor>(async (): Promise<{}> => ({}));
    const service = createChatRuntimeService({
      emit: vi.fn(),
      createMessageId: (role) => `${role}-message-1`,
      messageReader: createNoopMessageReader(),
      messageWriter: createNoopMessageWriter(),
      streamExecutor
    });

    await service.continue(
      createContinueInput({
        messages: [previousUser, previousAssistant, currentUser],
        skillContentHashes: { weather: 'new-hash' }
      })
    );
    await flushRuntimeTasks();

    const sourceMessages = streamExecutor.mock.calls[0]?.[0].sourceMessages ?? [];
    const serialized = JSON.stringify(sourceMessages);
    expect(serialized).toContain('skill_invalidated');
    expect(serialized).not.toContain('old instructions');
  });

  it('does not reuse a previous turn assistant when continuation history ends with a user message', async (): Promise<void> => {
    const collector = createEventCollector();
    const addedMessages: ChatMessageRecord[] = [];
    const updatedMessages: ChatMessageRecord[] = [];
    const previousUserMessage: ChatMessageRecord = {
      id: 'user-previous',
      sessionId: 'session-1',
      role: 'user',
      content: '上一轮问题',
      parts: [{ id: 'part0103', type: 'text', text: '上一轮问题' }],
      createdAt: '2026-06-19T00:00:00.000Z',
      finished: true
    };
    const previousAssistantMessage: ChatMessageRecord = {
      id: 'assistant-previous',
      sessionId: 'session-1',
      role: 'assistant',
      content: '上一轮回答',
      parts: [{ id: 'part0104', type: 'text', text: '上一轮回答' }],
      createdAt: '2026-06-19T00:00:00.000Z',
      finished: true,
      loading: false
    };
    const currentUserMessage: ChatMessageRecord = {
      id: 'user-current',
      sessionId: 'session-1',
      role: 'user',
      content: '重新生成当前回答',
      parts: [{ id: 'part0105', type: 'text', text: '重新生成当前回答' }],
      createdAt: '2026-06-19T00:00:01.000Z',
      finished: true
    };
    const streamExecutor = vi.fn<ChatRuntimeStreamExecutor>(async ({ assistantMessage: draft }, updateAssistant) => {
      draft.content = '当前新回答';
      draft.parts = [{ id: 'part0106', type: 'text', text: '当前新回答' }];
      draft.loading = false;
      draft.finished = true;
      await updateAssistant(draft);
      return {};
    });
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (role) => `${role}-message-1`,
      now: () => '2026-06-19T00:00:02.000Z',
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (message) => {
          addedMessages.push({ ...message, parts: [...message.parts] });
        },
        updateMessage: (message) => {
          updatedMessages.push({ ...message, parts: [...message.parts] });
        }
      },
      streamExecutor
    });

    const result = await service.continue(
      createContinueInput({ messages: [previousUserMessage, previousAssistantMessage, currentUserMessage], contextWindow: 200_000 })
    );
    await flushRuntimeTasks();

    expect(addedMessages).toEqual([
      expect.objectContaining({
        id: 'assistant-message-1',
        role: 'assistant',
        runtimeId: result.runtimeId,
        loading: true,
        finished: false,
        createdAt: '2026-06-19T00:00:02.000Z'
      })
    ]);
    expect(updatedMessages).not.toContainEqual(expect.objectContaining({ id: 'assistant-previous', loading: true }));
    expect(streamExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: currentUserMessage,
        assistantMessage: expect.objectContaining({ id: 'assistant-message-1', runtimeId: result.runtimeId }),
        sourceMessages: [previousUserMessage, previousAssistantMessage, currentUserMessage]
      }),
      expect.any(Function)
    );
  });

  it('submits a user choice answer from persisted messages and continues the runtime', async (): Promise<void> => {
    const collector = createEventCollector();
    const updatedMessages: ChatMessageRecord[] = [];
    const userMessage: ChatMessageRecord = {
      id: 'user-1',
      sessionId: 'session-1',
      role: 'user',
      content: 'choose',
      parts: [{ id: 'part0107', type: 'text', text: 'choose' }],
      createdAt: '2026-06-19T00:00:00.000Z',
      finished: true
    };
    const assistantMessage: ChatMessageRecord = {
      id: 'assistant-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: '',
      parts: [
        {
          id: 'part0108',
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'ask_user_choice',
          status: 'done',
          input: { question: 'Continue?' },
          result: {
            toolName: 'ask_user_choice',
            status: 'awaiting_user_input',
            data: {
              questionId: 'question-1',
              toolCallId: 'tool-call-1',
              question: 'Continue?',
              mode: 'single',
              options: [{ label: 'Yes', value: 'yes' }]
            }
          }
        }
      ],
      createdAt: '2026-06-19T00:00:01.000Z',
      finished: false,
      loading: false
    };
    const streamExecutor = vi.fn<ChatRuntimeStreamExecutor>(async ({ sourceMessages, assistantMessage: draft }, updateAssistant) => {
      expect(sourceMessages?.find((message) => message.id === 'assistant-1')?.parts[0]).toMatchObject({
        type: 'tool',
        result: {
          status: 'success',
          data: {
            questionId: 'question-1',
            toolCallId: 'tool-call-1',
            answers: ['yes']
          }
        }
      });
      draft.content = 'continued answer';
      draft.parts = [...draft.parts, { id: 'part0109', type: 'text', text: 'continued answer' }];
      draft.loading = false;
      draft.finished = true;
      await updateAssistant(draft);
      return {};
    });
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (role) => `${role}-message-1`,
      now: () => '2026-06-19T00:00:02.000Z',
      messageReader: { getMessages: () => [userMessage, assistantMessage] },
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (message) => {
          updatedMessages.push({ ...message, parts: [...message.parts] });
        }
      },
      streamExecutor
    });

    const result = await service.submitUserChoice({
      runtimeId: 'runtime-choice-answer',
      sessionId: 'session-1',
      turnId: 'turn-choice-answer',
      clientId: 'client-1',
      agentId: 'primary',
      rootRuntimeId: 'runtime-choice-answer',
      contextWindow: 200_000,
      answer: {
        questionId: 'question-1',
        toolCallId: 'tool-call-1',
        answers: ['yes']
      }
    });
    await flushRuntimeTasks();

    expect(result.runtimeId).toMatch(/^runtime-/);
    expect(streamExecutor).toHaveBeenCalledOnce();
    expect(updatedMessages[0]).toEqual(
      expect.objectContaining({
        id: 'assistant-1',
        runtimeId: result.runtimeId,
        loading: true,
        finished: false,
        parts: [
          expect.objectContaining({
            result: {
              toolName: 'ask_user_choice',
              status: 'success',
              data: {
                questionId: 'question-1',
                toolCallId: 'tool-call-1',
                answers: ['yes']
              }
            }
          })
        ]
      })
    );
    expect(collector.events).toContainEqual(
      expect.objectContaining({
        name: 'chat:runtime:complete',
        payload: expect.objectContaining({ runtimeId: result.runtimeId })
      })
    );
  });

  it('continues the runtime with a cancelled user choice result', async (): Promise<void> => {
    const collector = createEventCollector();
    const updatedMessages: ChatMessageRecord[] = [];
    const userMessage: ChatMessageRecord = {
      id: 'user-1',
      sessionId: 'session-1',
      role: 'user',
      content: 'choose',
      parts: [{ id: 'part0110', type: 'text', text: 'choose' }],
      createdAt: '2026-06-19T00:00:00.000Z',
      finished: true
    };
    const assistantMessage: ChatMessageRecord = {
      id: 'assistant-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: '',
      parts: [
        {
          id: 'part0111',
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'ask_user_choice',
          status: 'done',
          input: { question: 'Continue?' },
          result: {
            toolName: 'ask_user_choice',
            status: 'awaiting_user_input',
            data: {
              questionId: 'question-1',
              toolCallId: 'tool-call-1',
              question: 'Continue?',
              mode: 'single',
              options: [{ label: 'Yes', value: 'yes' }]
            }
          }
        }
      ],
      createdAt: '2026-06-19T00:00:01.000Z',
      finished: false,
      loading: false
    };
    const streamExecutor = vi.fn<ChatRuntimeStreamExecutor>(async ({ sourceMessages, assistantMessage: draft }, updateAssistant) => {
      expect(sourceMessages?.find((message) => message.id === 'assistant-1')?.parts[0]).toMatchObject({
        type: 'tool',
        result: {
          status: 'cancelled',
          error: { code: 'USER_CANCELLED', message: '用户取消了选择' }
        }
      });
      draft.content = 'cancel acknowledged';
      draft.parts = [...draft.parts, { id: 'part0112', type: 'text', text: 'cancel acknowledged' }];
      draft.loading = false;
      draft.finished = true;
      await updateAssistant(draft);
      return {};
    });
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (role) => `${role}-message-1`,
      now: () => '2026-06-19T00:00:02.000Z',
      messageReader: { getMessages: () => [userMessage, assistantMessage] },
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (message) => {
          updatedMessages.push({ ...message, parts: [...message.parts] });
        }
      },
      streamExecutor
    });

    const result = await service.submitUserChoice({
      runtimeId: 'runtime-choice-cancelled',
      sessionId: 'session-1',
      turnId: 'turn-choice-cancelled',
      clientId: 'client-1',
      agentId: 'primary',
      rootRuntimeId: 'runtime-choice-cancelled',
      contextWindow: 200_000,
      answer: {
        questionId: 'question-1',
        toolCallId: 'tool-call-1',
        answers: [],
        questionAnswers: [],
        otherText: ''
      }
    });
    await flushRuntimeTasks();

    expect(result).toEqual({ runtimeId: expect.stringMatching(/^runtime-/), sessionId: 'session-1' });
    expect(streamExecutor).toHaveBeenCalledOnce();
    expect(updatedMessages[0]).toEqual(
      expect.objectContaining({
        id: 'assistant-1',
        runtimeId: result.runtimeId,
        loading: true,
        finished: false,
        parts: [
          expect.objectContaining({
            result: {
              toolName: 'ask_user_choice',
              status: 'cancelled',
              error: { code: 'USER_CANCELLED', message: '用户取消了选择' }
            }
          })
        ]
      })
    );
    expect(collector.events).toContainEqual(
      expect.objectContaining({
        name: 'chat:runtime:complete',
        payload: expect.objectContaining({ runtimeId: result.runtimeId })
      })
    );
  });

  it('marks assistant message as failed and emits runtime error when stream executor fails', async (): Promise<void> => {
    const collector = createEventCollector();
    const updatedMessages: Array<ChatRuntimeEventMap['chat:runtime:message-updated']['message']> = [];
    const runtimeError = { code: 'REQUEST_FAILED', message: 'model failed' } as AIServiceError;
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (role) => `${role}-message-1`,
      now: () => '2026-06-19T00:00:00.000Z',
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (message) => {
          updatedMessages.push({ ...message, parts: [...message.parts] });
        }
      },
      streamExecutor: async () => {
        throw runtimeError;
      }
    });

    const result = await service.send(createInput({ content: 'hello runtime' }));
    await flushRuntimeTasks();

    expect(result.runtimeId).toMatch(/^runtime-/);
    expect(updatedMessages).toHaveLength(1);
    expect(updatedMessages[0]).toMatchObject({
      id: 'assistant-message-1',
      content: 'model failed',
      parts: [{ type: 'error', text: 'model failed' }],
      loading: false,
      finished: true
    });
    const terminalEventNames = collector.events
      .filter(
        (event): boolean =>
          event.payload.runtimeId === result.runtimeId && ['chat:runtime:message-updated', 'chat:runtime:error', 'chat:runtime:complete'].includes(event.name)
      )
      .map((event): string => event.name);
    const messageUpdatedEvent = collector.events.find(
      (event): boolean => event.name === 'chat:runtime:message-updated' && event.payload.runtimeId === result.runtimeId
    );
    const errorEvent = collector.events.find((event): boolean => event.name === 'chat:runtime:error' && event.payload.runtimeId === result.runtimeId);

    expect(terminalEventNames).toEqual(['chat:runtime:message-updated', 'chat:runtime:error']);
    expect(messageUpdatedEvent).toMatchObject({
      payload: {
        message: {
          id: 'assistant-message-1',
          content: 'model failed',
          parts: [{ type: 'error', text: 'model failed' }],
          loading: false,
          finished: true
        }
      }
    });
    expect(errorEvent?.payload).toMatchObject({ error: runtimeError });
  });

  it('releases a failed runtime when persisting its terminal assistant message fails', async (): Promise<void> => {
    const collector = createEventCollector();
    const locks = createRuntimeLockRegistry();
    const updateMessage = vi.fn<() => Promise<never>>(() => Promise.reject(new Error('terminal persistence failed')));
    const service = createChatRuntimeService({
      locks,
      emit: collector.emit,
      createMessageId: (role) => `${role}-message-persist-failure`,
      now: () => '2026-08-03T00:00:00.000Z',
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage
      },
      streamExecutor: async (): Promise<never> => {
        throw new Error('model failed before terminal persistence');
      }
    });

    const result = await service.send(createInput({ sessionId: 'session-terminal-persist-failure' }));
    await flushRuntimeTasks();

    expect(updateMessage).toHaveBeenCalledOnce();
    expect(service.getActiveRuntime(result.runtimeId)).toBeUndefined();
    expect(locks.getWritingOwner(result.sessionId)).toBeUndefined();
    expect(collector.events).toContainEqual(
      expect.objectContaining({
        name: 'chat:runtime:message-updated',
        payload: expect.objectContaining({
          runtimeId: result.runtimeId,
          message: expect.objectContaining({
            content: 'model failed before terminal persistence',
            parts: [expect.objectContaining({ type: 'error', text: 'model failed before terminal persistence' })],
            loading: false,
            finished: true
          })
        })
      })
    );
    expect(collector.events).toContainEqual(
      expect.objectContaining({
        name: 'chat:runtime:error',
        payload: expect.objectContaining({
          runtimeId: result.runtimeId,
          error: expect.objectContaining({ message: 'model failed before terminal persistence' }),
          messagePersistenceFailed: true
        })
      })
    );
  });

  it.each(['chat:runtime:message-updated', 'chat:runtime:error'] as const)(
    'releases a failed runtime when the %s listener throws',
    async (failingEventName): Promise<void> => {
      const locks = createRuntimeLockRegistry();
      const emit = vi.fn((name: string): void => {
        if (name === failingEventName) throw new Error(`${name} listener failed`);
      });
      const service = createChatRuntimeService({
        locks,
        emit,
        createMessageId: (role) => `${role}-message-emit-failure`,
        now: () => '2026-08-03T00:00:00.000Z',
        messageReader: createNoopMessageReader(),
        messageWriter: createNoopMessageWriter(),
        streamExecutor: async (): Promise<never> => {
          throw new Error('model failed before terminal emit');
        }
      });

      const result = await service.send(createInput({ sessionId: `session-${failingEventName}` }));
      await flushRuntimeTasks();

      expect(service.getActiveRuntime(result.runtimeId)).toBeUndefined();
      expect(locks.getWritingOwner(result.sessionId)).toBeUndefined();
      expect(emit).toHaveBeenCalledWith('chat:runtime:error', expect.objectContaining({ runtimeId: result.runtimeId }));
    }
  );

  it('marks pending tool part as failed without appending duplicate error part when stream executor fails', async (): Promise<void> => {
    const collector = createEventCollector();
    const updatedMessages: ChatMessageRecord[] = [];
    const runtimeError = { code: 'REQUEST_FAILED', message: 'model failed' } as AIServiceError;
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (role) => `${role}-message-1`,
      now: () => '2026-06-19T00:00:00.000Z',
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (message): void => {
          updatedMessages.push(structuredClone(message));
        }
      },
      streamExecutor: async ({ assistantMessage }, updateAssistant): Promise<{}> => {
        const pendingSkillPart: ChatMessagePart = {
          id: 'tool-part-1',
          type: 'tool',
          toolCallId: 'tool-call-skill',
          toolName: 'skill',
          status: 'inputting',
          input: { name: 'debugging' },
          inputText: '{"name":"debugging"'
        };

        assistantMessage.parts.push(pendingSkillPart);
        await updateAssistant(assistantMessage);
        throw runtimeError;
      }
    });

    const result = await service.send(createInput({ content: 'hello runtime' }));
    await flushRuntimeTasks();

    const finalMessage = updatedMessages[updatedMessages.length - 1];
    expect(result.runtimeId).toMatch(/^runtime-/);
    expect(finalMessage).toMatchObject({
      id: 'assistant-message-1',
      content: 'model failed',
      parts: [
        {
          type: 'tool',
          toolName: 'skill',
          status: 'done',
          result: {
            toolName: 'skill',
            status: 'failure',
            error: { code: 'EXECUTION_FAILED', message: 'model failed' }
          }
        }
      ],
      loading: false,
      finished: true
    });
    expect(finalMessage.parts).toHaveLength(1);
    expect(finalMessage.parts.some((part) => part.type === 'error')).toBe(false);
  });

  it('rejects a second runtime for the same session while the first is active', async (): Promise<void> => {
    const collector = createEventCollector();
    const service = createChatRuntimeService({
      emit: collector.emit,
      messageWriter: createNoopMessageWriter(),
      messageReader: createNoopMessageReader(),
      streamExecutor: createNoopStreamExecutor(),
      keepRuntimeOpenForTest: true
    });

    const first = await service.send(createInput());

    await expect(service.send(createInput({ content: 'second' }))).rejects.toMatchObject({
      code: 'SESSION_BUSY'
    });

    await service.abort({ runtimeId: first.runtimeId });
    const second = await service.send(createInput({ content: 'after abort' }));
    expect(second.sessionId).toBe('session-1');
  });

  it('aborts only the targeted runtime', async (): Promise<void> => {
    const collector = createEventCollector();
    const service = createChatRuntimeService({
      emit: collector.emit,
      messageWriter: createNoopMessageWriter(),
      messageReader: createNoopMessageReader(),
      streamExecutor: createNoopStreamExecutor(),
      keepRuntimeOpenForTest: true
    });
    const first = await service.send(createInput({ sessionId: 'session-1' }));
    const second = await service.send(createInput({ sessionId: 'session-2' }));

    service.abort({ runtimeId: first.runtimeId });

    expect(service.getActiveRuntime(first.runtimeId)).toBeUndefined();
    expect(service.getActiveRuntime(second.runtimeId)?.sessionId).toBe('session-2');
  });

  it('drops an empty assistant draft before creating an interrupt message', async (): Promise<void> => {
    const collector = createEventCollector();
    const streamDeferred = createDeferred();
    const addedMessages: ChatMessageRecord[] = [];
    const updatedMessages: Array<ChatRuntimeEventMap['chat:runtime:message-updated']['message']> = [];
    const deletedMessages: Array<{ sessionId: string; messageId: string }> = [];
    const abortStream = vi.fn();
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (role) => `${role}-message-1`,
      now: () => '2026-06-19T00:00:00.000Z',
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (message) => {
          addedMessages.push({ ...message, parts: [...message.parts] });
        },
        updateMessage: (message) => {
          updatedMessages.push({ ...message, parts: [...message.parts] });
        },
        deleteMessage: (sessionId, messageId) => {
          deletedMessages.push({ sessionId, messageId });
        }
      },
      streamAbort: abortStream,
      streamExecutor: async () => {
        await streamDeferred.promise;
        return {};
      }
    });

    const result = await service.send(createInput());
    const abortResult = await service.abort({ runtimeId: result.runtimeId });

    expect(abortStream).toHaveBeenCalledWith(result.runtimeId);
    expect(abortResult).toEqual({
      deletedMessageId: 'assistant-message-1',
      interruptMessage: expect.objectContaining({
        id: 'interrupt-message-1',
        role: 'interrupt',
        content: '已中断'
      })
    });
    expect(service.getActiveRuntime(result.runtimeId)).toBeUndefined();
    expect(updatedMessages).not.toContainEqual(
      expect.objectContaining({
        id: 'assistant-message-1',
        role: 'assistant',
        content: '',
        loading: false,
        finished: true,
        parts: []
      })
    );
    expect(deletedMessages).toContainEqual({
      sessionId: 'session-1',
      messageId: 'assistant-message-1'
    });
    expect(collector.events).toContainEqual({
      name: 'chat:runtime:message-deleted',
      payload: expect.objectContaining({
        runtimeId: result.runtimeId,
        messageId: 'assistant-message-1'
      })
    });
    expect(addedMessages).toContainEqual(
      expect.objectContaining({
        id: 'interrupt-message-1',
        role: 'interrupt',
        content: '已中断',
        loading: false,
        finished: true,
        parts: []
      })
    );
    expect(collector.events).toContainEqual({
      name: 'chat:runtime:message-created',
      payload: expect.objectContaining({
        runtimeId: result.runtimeId,
        message: expect.objectContaining({ id: 'interrupt-message-1', role: 'interrupt', content: '已中断' })
      })
    });

    streamDeferred.resolve();
  });

  it('keeps streamed assistant parts before creating an interrupt message', async (): Promise<void> => {
    const collector = createEventCollector();
    const streamDeferred = createDeferred();
    const addedMessages: ChatMessageRecord[] = [];
    const updatedMessages: Array<ChatRuntimeEventMap['chat:runtime:message-updated']['message']> = [];
    const service = createChatRuntimeService({
      emit: collector.emit,
      createMessageId: (role) => `${role}-message-1`,
      now: () => '2026-06-19T00:00:00.000Z',
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (message) => {
          addedMessages.push({ ...message, parts: [...message.parts] });
        },
        updateMessage: (message) => {
          updatedMessages.push({ ...message, parts: [...message.parts] });
        }
      },
      streamExecutor: async ({ assistantMessage }, updateAssistant) => {
        assistantMessage.content = 'partial answer';
        assistantMessage.parts.push({ id: 'part0117', type: 'text', text: 'partial answer' });
        await updateAssistant(structuredClone(assistantMessage));
        await streamDeferred.promise;
        return {};
      }
    });

    const result = await service.send(createInput());
    await flushRuntimeTasks();
    const abortResult = await service.abort({ runtimeId: result.runtimeId });

    expect(abortResult).toEqual({
      assistantMessage: expect.objectContaining({
        id: 'assistant-message-1',
        content: 'partial answer',
        loading: false,
        finished: true
      }),
      interruptMessage: expect.objectContaining({
        id: 'interrupt-message-1',
        role: 'interrupt',
        content: '已中断'
      })
    });
    expect(updatedMessages.at(-1)).toMatchObject({
      id: 'assistant-message-1',
      role: 'assistant',
      content: 'partial answer',
      loading: false,
      finished: true,
      parts: [{ type: 'text', text: 'partial answer' }]
    });
    expect(addedMessages.at(-1)).toMatchObject({
      id: 'interrupt-message-1',
      role: 'interrupt',
      content: '已中断',
      loading: false,
      finished: true,
      parts: []
    });

    streamDeferred.resolve();
  });

  it('cancels an awaiting user choice when its active runtime is aborted', async (): Promise<void> => {
    const streamDeferred = createDeferred();
    const updatedMessages: ChatMessageRecord[] = [];
    const service = createChatRuntimeService({
      emit: vi.fn(),
      createMessageId: (role) => `${role}-message-1`,
      now: () => '2026-07-13T00:00:00.000Z',
      messageReader: createNoopMessageReader(),
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (message) => {
          updatedMessages.push({ ...message, parts: message.parts.map((part) => ({ ...part })) });
        }
      },
      streamExecutor: async ({ assistantMessage }, updateAssistant) => {
        assistantMessage.parts.push(createAwaitingUserChoicePart());
        assistantMessage.loading = true;
        assistantMessage.finished = false;
        await updateAssistant(assistantMessage);
        await streamDeferred.promise;
        return {};
      }
    });

    const result = await service.send(createInput());
    await flushRuntimeTasks();
    await service.abort({ runtimeId: result.runtimeId });

    expect(updatedMessages.at(-1)).toMatchObject({
      loading: false,
      finished: true,
      parts: [
        expect.objectContaining({
          status: 'done',
          result: {
            toolName: 'question',
            status: 'cancelled',
            error: { code: 'USER_CANCELLED', message: '用户中止了操作' }
          }
        })
      ]
    });

    streamDeferred.resolve();
  });

  it('runs an internal Primary Runtime B from frozen input with ordered results and fence-owner writes', async (): Promise<void> => {
    const locks = createRuntimeLockRegistry();
    const fence = locks.acquireContinuationFence({
      scope: 'session:session-1/history',
      checkpointId: 'checkpoint-1'
    });
    if (!fence) throw new Error('Continuation fence fixture must be acquired');
    const userMessage = createMessageRecord('user-1', 'user', 'delegate both tasks', '2026-07-23T00:00:00.000Z');
    const assistantMessage: ChatMessageRecord = {
      id: 'assistant-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: '',
      parts: [
        {
          id: 'delegate-part-1',
          type: 'tool',
          toolCallId: 'call-1',
          toolName: 'delegate_task',
          status: 'executing',
          input: { task: 'first' }
        },
        {
          id: 'delegate-part-2',
          type: 'tool',
          toolCallId: 'call-2',
          toolName: 'delegate_task',
          status: 'executing',
          input: { task: 'second' }
        }
      ],
      runtimeId: 'runtime-a',
      agentId: 'primary',
      loading: true,
      finished: false,
      createdAt: '2026-07-23T00:00:00.000Z'
    };
    const createTerminalResult = (taskId: string, agentId: string, attemptId: string, executionStatus: 'completed' | 'cancelled' = 'completed') => ({
      taskId,
      agentId,
      attemptId,
      executionStatus,
      completion: { level: 'none' as const, criteria: [] },
      summary: `Result for ${taskId}`,
      warnings: [],
      artifacts: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        modelCalls: 0,
        toolRounds: 0,
        queueDurationMs: 0,
        executionDurationMs: 0,
        externalRequests: 0,
        monetaryCost: {
          currency: 'unknown' as const,
          pricingVersion: 'unknown' as const,
          estimated: 'unknown' as const,
          actual: 'unknown' as const
        }
      },
      ...(executionStatus === 'cancelled'
        ? {
            error: {
              code: 'cancelled' as const,
              phase: 'runtime' as const,
              category: 'user' as const,
              retryable: false,
              details: { reason: 'user_cancelled' }
            }
          }
        : {})
    });
    const firstResult = createTerminalResult('task-1', 'child-1', 'attempt-1', 'cancelled');
    const secondResult = createTerminalResult('task-2', 'child-2', 'attempt-2');
    const toolSchemaSnapshot = [{ name: 'delegate_task', description: 'deferred', parameters: { type: 'object' as const } }];
    const continuationSnapshot = {
      checkpointSchemaVersion: 1,
      policyVersion: 'foundation-v1',
      modelSnapshot: { providerId: 'provider-frozen', modelId: 'model-frozen' },
      continuationContextReference: 'continuation-1',
      continuationContextHash: 'a'.repeat(64),
      sourceMessageRevision: hashAgentPayload(assistantMessage),
      toolSchemaSnapshotHash: hashAgentPayload(toolSchemaSnapshot),
      orderedToolCalls: [
        {
          toolCallId: 'call-1',
          taskId: 'task-1',
          required: true,
          argumentsHash: 'b'.repeat(64),
          providerMetadataHash: 'c'.repeat(64)
        },
        {
          toolCallId: 'call-2',
          taskId: 'task-2',
          required: true,
          argumentsHash: 'd'.repeat(64),
          providerMetadataHash: 'e'.repeat(64)
        }
      ],
      reservedResumeBudget: { tokenLimit: 100, costLimitUsd: 0, pricingVersion: 'unknown' },
      absoluteTurnDeadline: '2026-07-23T01:00:00.000Z'
    };
    const checkpoint = {
      checkpointId: 'checkpoint-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      primaryAgentId: 'primary',
      rootRuntimeId: 'runtime-root',
      sourceRuntimeId: 'runtime-a',
      assistantMessageId: 'assistant-1',
      continuationSnapshot,
      continuationSnapshotHash: 'f'.repeat(64),
      status: 'resuming',
      version: 3,
      terminalResults: {
        'call-2': { result: secondResult, resultHash: '1'.repeat(64) },
        'call-1': { result: firstResult, resultHash: '2'.repeat(64) }
      },
      resumeRuntimeId: 'runtime-b',
      recordState: 'active',
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:01.000Z'
    } satisfies AgentCheckpointRecord;
    const ownerWrites: Array<string | undefined> = [];
    const streamExecutor = vi.fn(async ({ runtime, assistantMessage: activeAssistant, forceFinal }) => {
      expect(runtime).toMatchObject({
        runtimeId: 'runtime-b',
        sessionId: 'session-1',
        turnId: 'turn-1',
        agentId: 'primary',
        parentRuntimeId: 'runtime-a',
        rootRuntimeId: 'runtime-root',
        continuationOfRuntimeId: 'runtime-a',
        model: { providerId: 'provider-frozen', modelId: 'model-frozen' },
        tools: [],
        ownerCheckpointId: 'checkpoint-1'
      });
      expect(runtime.system).toContain('base system');
      expect(runtime.system).toContain('required cancelled tasks: task-1');
      expect(runtime.system).toContain('must explicitly state');
      expect(forceFinal).toBe(true);
      expect(activeAssistant.parts).toEqual([
        expect.objectContaining({
          toolCallId: 'call-1',
          status: 'done',
          result: expect.objectContaining({ data: firstResult })
        }),
        expect.objectContaining({
          toolCallId: 'call-2',
          status: 'done',
          result: expect.objectContaining({ data: secondResult })
        })
      ]);
      return {};
    });
    const service = createChatRuntimeService({
      locks,
      emit: vi.fn(),
      messageReader: {
        getMessages: (): ChatMessageRecord[] => structuredClone([userMessage, assistantMessage])
      },
      messageWriter: {
        addMessage: (_message, ownerCheckpointId): void => {
          ownerWrites.push(ownerCheckpointId);
        },
        updateMessage: (_message, ownerCheckpointId): void => {
          ownerWrites.push(ownerCheckpointId);
        }
      },
      streamExecutor
    });
    const internalInput: ChatAgentPrimaryContinuationInput & Record<string, unknown> = {
      checkpoint,
      runtimeId: 'runtime-b',
      context: {
        clientId: 'client-1',
        modelSnapshot: { providerId: 'provider-frozen', modelId: 'model-frozen' },
        toolSchemaSnapshot,
        system: 'base system'
      },
      model: { providerId: 'renderer-override', modelId: 'renderer-override' },
      messages: [],
      tools: [{ name: 'renderer-tool', description: 'must be ignored', parameters: {} }]
    };

    await expect(service.resumePrimary(internalInput)).resolves.toEqual({ outcome: 'completed' });

    expect(streamExecutor).toHaveBeenCalledOnce();
    expect(ownerWrites.length).toBeGreaterThan(0);
    expect(ownerWrites.every((ownerCheckpointId): boolean => ownerCheckpointId === 'checkpoint-1')).toBe(true);
    expect(locks.getWritingOwner('session-1')).toBeUndefined();
    expect(locks.getContinuationFence('session:session-1/history')).toEqual({
      scope: 'session:session-1/history',
      checkpointId: 'checkpoint-1'
    });
    expect(assistantMessage.parts.every((part): boolean => part.type !== 'tool' || part.status === 'executing')).toBe(true);

    const failureLocks = createRuntimeLockRegistry();
    failureLocks.acquireContinuationFence({ scope: 'session:session-1/history', checkpointId: 'checkpoint-1' });
    const failedWrites: ChatMessageRecord[] = [];
    const failureEmit = vi.fn((name: string): void => {
      if (name === 'chat:runtime:error') throw new Error('renderer error listener failed');
    });
    const failedService = createChatRuntimeService({
      locks: failureLocks,
      emit: failureEmit,
      messageReader: { getMessages: (): ChatMessageRecord[] => structuredClone([userMessage, assistantMessage]) },
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (message, ownerCheckpointId): void => {
          expect(ownerCheckpointId).toBe('checkpoint-1');
          failedWrites.push(structuredClone(message));
        }
      },
      streamExecutor: async (): Promise<never> => {
        throw new Error('model failed');
      }
    });

    await expect(failedService.resumePrimary(internalInput)).resolves.toMatchObject({
      outcome: 'failed',
      phase: 'runtime',
      error: { code: 'runtime_failed', phase: 'runtime' }
    });
    expect(failedWrites.at(-1)).toMatchObject({ loading: false, finished: true });
    expect(failureEmit).toHaveBeenCalledWith('chat:runtime:error', expect.any(Object));
    expect(failureLocks.getWritingOwner('session-1')).toBeUndefined();
    expect(failureLocks.getContinuationFence('session:session-1/history')).toBeDefined();

    const staleCheckpoint: AgentCheckpointRecord = {
      ...checkpoint,
      continuationSnapshot: {
        ...checkpoint.continuationSnapshot,
        sourceMessageRevision: '0'.repeat(64)
      }
    };
    const startupLocks = createRuntimeLockRegistry();
    startupLocks.acquireContinuationFence({ scope: 'session:session-1/history', checkpointId: 'checkpoint-1' });
    const startupWrites: ChatMessageRecord[] = [];
    const startupEmit = vi.fn((name: string): void => {
      if (name === 'chat:runtime:error') throw new Error('renderer error listener failed');
    });
    const startupService = createChatRuntimeService({
      locks: startupLocks,
      emit: startupEmit,
      messageReader: { getMessages: (): ChatMessageRecord[] => structuredClone([userMessage, assistantMessage]) },
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (message, ownerCheckpointId): void => {
          expect(ownerCheckpointId).toBe('checkpoint-1');
          startupWrites.push(structuredClone(message));
        }
      },
      streamExecutor: createNoopStreamExecutor()
    });

    await expect(startupService.resumePrimary({ ...internalInput, checkpoint: staleCheckpoint })).resolves.toMatchObject({
      outcome: 'failed',
      phase: 'starting',
      error: { code: 'runtime_start_failed', phase: 'starting' }
    });
    expect(startupWrites.at(-1)).toMatchObject({ loading: false, finished: true });
    expect(startupEmit).toHaveBeenCalledWith('chat:runtime:error', expect.any(Object));
    expect(startupLocks.getWritingOwner('session-1')).toBeUndefined();
    expect(startupLocks.getContinuationFence('session:session-1/history')).toBeDefined();

    const unsafeLocks = createRuntimeLockRegistry();
    unsafeLocks.acquireContinuationFence({ scope: 'session:session-1/history', checkpointId: 'checkpoint-1' });
    const unsafeService = createChatRuntimeService({
      locks: unsafeLocks,
      emit: vi.fn(),
      messageReader: { getMessages: (): ChatMessageRecord[] => structuredClone([userMessage, assistantMessage]) },
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: (): Promise<never> => Promise.reject(new Error('failure terminalization failed'))
      },
      streamExecutor: createNoopStreamExecutor()
    });

    await expect(unsafeService.resumePrimary({ ...internalInput, checkpoint: staleCheckpoint })).rejects.toThrow('failure terminalization failed');
    expect(unsafeLocks.getWritingOwner('session-1')).toBeUndefined();
    expect(unsafeLocks.getContinuationFence('session:session-1/history')).toBeDefined();

    const missingLocks = createRuntimeLockRegistry();
    missingLocks.acquireContinuationFence({ scope: 'session:session-1/history', checkpointId: 'checkpoint-1' });
    const missingWriter = vi.fn();
    const missingService = createChatRuntimeService({
      locks: missingLocks,
      emit: vi.fn(),
      messageReader: { getMessages: (): ChatMessageRecord[] => structuredClone([userMessage]) },
      messageWriter: {
        addMessage: (): void => undefined,
        updateMessage: missingWriter
      },
      streamExecutor: createNoopStreamExecutor()
    });

    await expect(missingService.resumePrimary(internalInput)).rejects.toMatchObject({ code: 'INVALID_CONTINUATION' });
    expect(missingWriter).not.toHaveBeenCalled();
    expect(missingLocks.getWritingOwner('session-1')).toBeUndefined();
    expect(missingLocks.getContinuationFence('session:session-1/history')).toBeDefined();
  });
});
