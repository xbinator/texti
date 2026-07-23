/**
 * @file service.test.ts
 * @description Child Agent 委派 prepare 边界、逻辑栅栏和恢复测试。
 */
import type { ActiveChatRuntime, ChatRuntimeDelegationPrepareInput } from '../../../../../../electron/main/modules/chat/runtime/types.mjs';
import type { ChatMessageRecord } from 'types/chat';
import type { AgentTaskError } from 'types/chat-agent';
import { describe, expect, it, vi } from 'vitest';
import { createChatAgentDelegationService, type ChatAgentDelegationServiceDependencies } from '../../../../../../electron/main/modules/chat/agents/service.mjs';
import { createRuntimeLockRegistry } from '../../../../../../electron/main/modules/chat/runtime/infrastructure/locks.mjs';

/**
 * 创建合法 Primary Runtime A。
 * @returns 委派测试 Runtime
 */
function createRuntime(): ActiveChatRuntime {
  return {
    sessionId: 'session-1',
    turnId: 'turn-1',
    agentId: 'primary',
    runtimeId: 'runtime-a',
    rootRuntimeId: 'runtime-a',
    clientId: 'bchat',
    contextWindow: 128_000,
    system: '只保存允许的续接上下文',
    workspaceRoot: '/workspace',
    tools: [{ name: 'delegate_task', description: 'delegate', parameters: { type: 'object' } }],
    runtimeContext: {
      skill: {
        targetMessageId: 'user-1',
        snapshots: [{ name: 'skill-a', content: 'approved skill prompt', contentHash: 'hash-a', filePath: '.agents/skills/skill-a/SKILL.md' }]
      }
    },
    resolvedModel: {
      createOptions: {
        providerId: 'provider-1',
        providerName: 'Provider',
        providerType: 'openai',
        apiKey: 'must-not-persist',
        baseUrl: 'https://example.com'
      },
      modelId: 'model-1'
    },
    status: 'running',
    phase: 'streaming',
    abortController: new AbortController(),
    createdAt: Date.parse('2026-07-23T00:00:00.000Z'),
    taskPausedDurationMs: 20_000
  };
}

/**
 * 创建含完整原始委派调用的 assistant。
 * @param mode - Task 模式
 * @returns assistant 快照
 */
function createAssistant(mode: 'read' | 'write' = 'read'): ChatMessageRecord {
  return {
    id: 'assistant-1',
    sessionId: 'session-1',
    role: 'assistant',
    content: '',
    parts: [
      {
        id: 'part-1',
        type: 'tool',
        toolCallId: 'call-1',
        toolName: 'delegate_task',
        status: 'executing',
        input: {
          task: '读取方案',
          acceptanceCriteria: ['返回摘要'],
          mode,
          resources: [{ kind: 'file', reference: 'CONTEXT.md' }],
          requestedTools: ['read_file'],
          required: true,
          priority: 'normal'
        }
      }
    ],
    loading: true,
    finished: false,
    parentRuntimeId: undefined,
    createdAt: '2026-07-23T00:00:00.000Z'
  };
}

/**
 * 创建 Runtime 交给 Coordinator 的 prepare 输入。
 * @param mode - Task 模式
 * @returns prepare 输入
 */
function createInput(mode: 'read' | 'write' = 'read'): ChatRuntimeDelegationPrepareInput {
  const assistantMessage = createAssistant(mode);
  return {
    checkpointId: 'checkpoint-1',
    runtime: createRuntime(),
    assistantMessage,
    suspension: {
      toolCalls: [
        {
          toolCallId: 'call-1',
          toolName: 'delegate_task',
          input: assistantMessage.parts[0]?.type === 'tool' ? assistantMessage.parts[0].input : null,
          argumentsHash: 'a'.repeat(64)
        }
      ]
    }
  };
}

/**
 * 创建窄 Store 测试替身。
 * @returns Store mock 与依赖
 */
function createDependencies(): {
  dependencies: ChatAgentDelegationServiceDependencies;
  prepareDelegation: ReturnType<typeof vi.fn>;
  interruptCheckpoint: ReturnType<typeof vi.fn>;
  interruptActive: ReturnType<typeof vi.fn>;
  markOutboxDelivered: ReturnType<typeof vi.fn>;
  listActive: ReturnType<typeof vi.fn>;
  persistAssistant: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
} {
  const prepareDelegation = vi.fn((_input, persistAssistant: () => undefined): void => {
    persistAssistant();
  });
  const interruptCheckpoint = vi.fn();
  const interruptActive = vi.fn((): number => 0);
  const markOutboxDelivered = vi.fn();
  const listActive = vi.fn(() => []);
  const persistAssistant = vi.fn((): undefined => undefined);
  const publish = vi.fn();
  return {
    dependencies: {
      store: {
        prepareDelegation,
        interruptCheckpoint,
        interruptActive,
        markOutboxDelivered,
        listActive
      },
      locks: createRuntimeLockRegistry(),
      persistAssistant,
      publish,
      createId: (kind, index): string => `${kind}-${index ?? 1}`,
      now: (): string => '2026-07-23T00:00:01.000Z'
    },
    prepareDelegation,
    interruptCheckpoint,
    interruptActive,
    markOutboxDelivered,
    listActive,
    persistAssistant,
    publish
  };
}

describe('chat agent delegation service', (): void => {
  it('commits immutable facts before acquiring the fence and publishing the outbox', (): void => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);

    expect(service.prepareDelegation(createInput())).toEqual({ prepared: true });

    expect(fixture.prepareDelegation).toHaveBeenCalledOnce();
    expect(fixture.persistAssistant).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [expect.objectContaining({ toolCallId: 'call-1' })]
      })
    );
    const preparedInput = fixture.prepareDelegation.mock.calls[0]?.[0];
    expect(preparedInput).toMatchObject({
      tasks: [
        {
          taskId: 'task-1',
          agentId: 'child-1',
          checkpointId: 'checkpoint-1',
          toolCallId: 'call-1',
          contractSnapshot: { mode: 'read' }
        }
      ],
      checkpoint: {
        checkpointId: 'checkpoint-1',
        continuationSnapshot: {
          modelSnapshot: { providerId: 'provider-1', modelId: 'model-1' },
          orderedToolCalls: [
            {
              toolCallId: 'call-1',
              taskId: 'task-1',
              providerMetadataHash: expect.stringMatching(/^[a-f0-9]{64}$/)
            }
          ],
          reservedResumeBudget: {
            tokenLimit: expect.any(Number),
            costLimitUsd: 0,
            pricingVersion: 'unknown'
          },
          absoluteTurnDeadline: '2026-07-23T00:05:20.000Z'
        }
      },
      outbox: {
        outboxId: 'outbox-1',
        eventType: 'delegation.created'
      }
    });
    expect(fixture.prepareDelegation.mock.invocationCallOrder[0]).toBeLessThan(fixture.publish.mock.invocationCallOrder[0]);
    expect(fixture.publish).toHaveBeenCalledWith(
      'delegation.created',
      expect.objectContaining({ checkpointId: 'checkpoint-1', sessionId: 'session-1', turnId: 'turn-1' })
    );
    expect(fixture.markOutboxDelivered).toHaveBeenCalledWith({
      outboxId: 'outbox-1',
      deliveredAt: '2026-07-23T00:00:01.000Z'
    });
    expect(service.getContinuationContext('checkpoint-1')).toEqual(
      expect.not.objectContaining({
        apiKey: expect.anything(),
        tavily: expect.anything(),
        mcp: expect.anything()
      })
    );
    expect(fixture.dependencies.locks.getContinuationFence('session:session-1/history')).toEqual({
      scope: 'session:session-1/history',
      checkpointId: 'checkpoint-1'
    });
  });

  it('rejects write mode with capability_denied before creating a checkpoint', (): void => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);

    expect((): void => {
      service.prepareDelegation(createInput('write'));
    }).toThrowError(
      expect.objectContaining({
        code: 'capability_denied',
        phase: 'contract_validation'
      })
    );
    expect(fixture.prepareDelegation).not.toHaveBeenCalled();
    expect(fixture.dependencies.locks.getContinuationFence('session:session-1/history')).toBeUndefined();
  });

  it('rejects a reserved scope conflict before creating any persistent facts', (): void => {
    const fixture = createDependencies();
    fixture.dependencies.locks.acquireContinuationFence({
      scope: 'session:session-1/history',
      checkpointId: 'checkpoint-existing'
    });
    const service = createChatAgentDelegationService(fixture.dependencies);

    expect((): void => {
      service.prepareDelegation(createInput());
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
    expect(fixture.prepareDelegation).not.toHaveBeenCalled();
    expect(fixture.interruptCheckpoint).not.toHaveBeenCalled();
    expect(fixture.interruptActive).not.toHaveBeenCalled();
    expect(service.getContinuationContext('checkpoint-1')).toBeUndefined();
    expect(fixture.publish).not.toHaveBeenCalled();
  });

  it('releases an inactive reservation when Store prepare fails', (): void => {
    const fixture = createDependencies();
    fixture.prepareDelegation.mockImplementationOnce((): never => {
      throw new Error('store prepare failed');
    });
    const service = createChatAgentDelegationService(fixture.dependencies);

    expect((): void => {
      service.prepareDelegation(createInput());
    }).toThrowError('store prepare failed');

    expect(fixture.dependencies.locks.getContinuationFence('session:session-1/history')).toBeUndefined();
    expect(
      fixture.dependencies.locks.reserveContinuationFence({
        scope: 'session:session-1/history',
        checkpointId: 'checkpoint-retry'
      })
    ).not.toBeNull();
  });

  it('interrupts startup checkpoints and clears volatile contexts and fences', (): void => {
    const fixture = createDependencies();
    fixture.interruptActive.mockReturnValue(1);
    const service = createChatAgentDelegationService(fixture.dependencies);
    service.prepareDelegation(createInput());

    expect(service.interruptUnrecoverableCheckpoints()).toBe(1);

    expect(fixture.interruptActive).toHaveBeenCalledWith(
      expect.objectContaining<AgentTaskError>({
        code: 'runtime_interrupted',
        phase: 'recovery',
        category: 'runtime',
        retryable: false
      })
    );
    expect(service.getContinuationContext('checkpoint-1')).toBeUndefined();
    expect(fixture.dependencies.locks.getContinuationFence('session:session-1/history')).toBeUndefined();
  });

  it('keeps or rebuilds fences for journal-blocked startup survivors without restoring volatile context', (): void => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);
    service.prepareDelegation(createInput());
    const preparedInput = fixture.prepareDelegation.mock.calls[0]?.[0];
    if (!preparedInput) throw new Error('Prepare input must be captured');
    const { checkpoint } = preparedInput;
    fixture.interruptActive.mockReturnValue(0);
    fixture.listActive.mockReturnValue([
      {
        checkpoint: {
          ...checkpoint,
          status: 'waiting_children',
          version: 1,
          terminalResults: {},
          recordState: 'active',
          createdAt: preparedInput.occurredAt,
          updatedAt: preparedInput.occurredAt
        },
        tasks: [],
        eventSequence: 2
      }
    ]);

    expect(service.interruptUnrecoverableCheckpoints()).toBe(0);

    expect(fixture.dependencies.locks.getContinuationFence('session:session-1/history')).toEqual({
      scope: 'session:session-1/history',
      checkpointId: 'checkpoint-1'
    });
    expect(service.getContinuationContext('checkpoint-1')).toBeUndefined();
  });

  it('fails startup recovery when a survivor cannot own its session history fence', (): void => {
    const fixture = createDependencies();
    fixture.dependencies.locks.acquireContinuationFence({
      scope: 'session:session-1/history',
      checkpointId: 'checkpoint-conflict'
    });
    fixture.listActive.mockReturnValue([
      {
        checkpoint: {
          checkpointId: 'checkpoint-1',
          sessionId: 'session-1',
          turnId: 'turn-1',
          primaryAgentId: 'primary',
          rootRuntimeId: 'runtime-a',
          sourceRuntimeId: 'runtime-a',
          assistantMessageId: 'assistant-1',
          continuationSnapshot: {
            checkpointSchemaVersion: 1,
            policyVersion: 'foundation-v1',
            modelSnapshot: { providerId: 'provider-1', modelId: 'model-1' },
            continuationContextReference: 'continuation-1',
            continuationContextHash: 'a'.repeat(64),
            sourceMessageRevision: 'b'.repeat(64),
            toolSchemaSnapshotHash: 'c'.repeat(64),
            orderedToolCalls: [
              {
                toolCallId: 'call-1',
                taskId: 'task-1',
                required: true,
                argumentsHash: 'd'.repeat(64),
                providerMetadataHash: 'e'.repeat(64)
              }
            ],
            reservedResumeBudget: { tokenLimit: 4096, costLimitUsd: 0, pricingVersion: 'unknown' },
            absoluteTurnDeadline: '2026-07-23T00:05:00.000Z'
          },
          continuationSnapshotHash: 'f'.repeat(64),
          status: 'waiting_children',
          version: 1,
          terminalResults: {},
          recordState: 'active',
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:00.000Z'
        },
        tasks: [],
        eventSequence: 2
      }
    ]);
    const service = createChatAgentDelegationService(fixture.dependencies);

    expect((): void => {
      service.interruptUnrecoverableCheckpoints();
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });
});
