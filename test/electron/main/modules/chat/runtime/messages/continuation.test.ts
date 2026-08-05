/**
 * @file continuation.test.ts
 * @description 验证 Runtime B 只按冻结 tool-call 顺序注入结构化 Child 结果。
 */
import type { ChatMessageRecord } from 'types/chat';
import type { AgentOrderedToolCallSnapshot, ChatAgentResult } from 'types/chat-agent';
import { describe, expect, it } from 'vitest';
import { createCancellationPolicy, injectAgentResults } from '../../../../../../../electron/main/modules/chat/runtime/messages/continuation.mts';

/**
 * 创建一个最小结构化 Child 结果。
 * @param taskId - Task 身份
 * @param agentId - Child Actor 身份
 * @param attemptId - Attempt 身份
 * @returns 可注入模型上下文的结果
 */
function createResult(taskId: string, agentId: string, attemptId: string, executionStatus: ChatAgentResult['executionStatus'] = 'completed'): ChatAgentResult {
  return {
    taskId,
    agentId,
    attemptId,
    executionStatus,
    completion: { level: 'none', criteria: [] },
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
        currency: 'unknown',
        pricingVersion: 'unknown',
        estimated: 'unknown',
        actual: 'unknown'
      }
    }
  };
}

describe('agent result continuation injection', (): void => {
  it('injects results by frozen toolCallId order without mutating the source assistant', (): void => {
    const assistant: ChatMessageRecord = {
      id: 'assistant-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: '',
      parts: [
        {
          id: 'call-part-1',
          type: 'tool',
          toolCallId: 'call-1',
          toolName: 'delegate_task',
          status: 'executing',
          input: { task: 'first' }
        },
        {
          id: 'call-part-2',
          type: 'tool',
          toolCallId: 'call-2',
          toolName: 'delegate_task',
          status: 'executing',
          input: { task: 'second' }
        }
      ],
      loading: true,
      finished: false,
      createdAt: '2026-07-23T00:00:00.000Z'
    };
    const orderedToolCalls: AgentOrderedToolCallSnapshot[] = [
      {
        toolCallId: 'call-1',
        taskId: 'task-1',
        required: true,
        argumentsHash: 'a'.repeat(64),
        providerMetadataHash: 'b'.repeat(64)
      },
      {
        toolCallId: 'call-2',
        taskId: 'task-2',
        required: true,
        argumentsHash: 'c'.repeat(64),
        providerMetadataHash: 'd'.repeat(64)
      }
    ];
    const second = createResult('task-2', 'child-2', 'attempt-2');
    const first = createResult('task-1', 'child-1', 'attempt-1');

    const injected = injectAgentResults(assistant, orderedToolCalls, {
      'call-2': { result: second, resultHash: 'e'.repeat(64) },
      'call-1': { result: first, resultHash: 'f'.repeat(64) }
    });

    expect(injected.parts).toEqual([
      expect.objectContaining({
        toolCallId: 'call-1',
        status: 'done',
        result: {
          toolName: 'delegate_task',
          status: 'success',
          data: first
        }
      }),
      expect.objectContaining({
        toolCallId: 'call-2',
        status: 'done',
        result: {
          toolName: 'delegate_task',
          status: 'success',
          data: second
        }
      })
    ]);
    expect(assistant.parts).toEqual([
      expect.objectContaining({ toolCallId: 'call-1', status: 'executing' }),
      expect.objectContaining({ toolCallId: 'call-2', status: 'executing' })
    ]);
    expect(assistant.parts.every((part): boolean => part.type !== 'tool' || part.result === undefined)).toBe(true);
  });

  it('fails closed when a frozen tool call has no unique matching result part', (): void => {
    const assistant: ChatMessageRecord = {
      id: 'assistant-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: '',
      parts: [],
      createdAt: '2026-07-23T00:00:00.000Z'
    };
    const orderedToolCalls: AgentOrderedToolCallSnapshot[] = [
      {
        toolCallId: 'call-missing',
        taskId: 'task-1',
        required: true,
        argumentsHash: 'a'.repeat(64),
        providerMetadataHash: 'b'.repeat(64)
      }
    ];

    expect((): void => {
      injectAgentResults(assistant, orderedToolCalls, {
        'call-missing': { result: createResult('task-1', 'child-1', 'attempt-1'), resultHash: 'c'.repeat(64) }
      });
    }).toThrowError(/protocol_error/u);
  });

  it('creates distinct continuation rules for required and optional cancellations', (): void => {
    const orderedToolCalls: AgentOrderedToolCallSnapshot[] = [
      {
        toolCallId: 'call-required',
        taskId: 'task-required',
        required: true,
        argumentsHash: 'a'.repeat(64),
        providerMetadataHash: 'b'.repeat(64)
      },
      {
        toolCallId: 'call-optional',
        taskId: 'task-optional',
        required: false,
        argumentsHash: 'c'.repeat(64),
        providerMetadataHash: 'd'.repeat(64)
      }
    ];

    const policy = createCancellationPolicy(orderedToolCalls, {
      'call-required': {
        result: createResult('task-required', 'child-required', 'attempt-required', 'cancelled'),
        resultHash: 'e'.repeat(64)
      },
      'call-optional': {
        result: createResult('task-optional', 'child-optional', 'attempt-optional', 'cancelled'),
        resultHash: 'f'.repeat(64)
      }
    });

    expect(policy).toContain('required cancelled tasks: task-required');
    expect(policy).toContain('must explicitly state');
    expect(policy).toContain('optional cancelled tasks: task-optional');
    expect(policy).toContain('information gap');
  });

  it('does not add a cancellation policy when every delegated task completed', (): void => {
    const orderedToolCalls: AgentOrderedToolCallSnapshot[] = [
      {
        toolCallId: 'call-1',
        taskId: 'task-1',
        required: true,
        argumentsHash: 'a'.repeat(64),
        providerMetadataHash: 'b'.repeat(64)
      }
    ];

    expect(
      createCancellationPolicy(orderedToolCalls, {
        'call-1': {
          result: createResult('task-1', 'child-1', 'attempt-1'),
          resultHash: 'c'.repeat(64)
        }
      })
    ).toBeUndefined();
  });

  it('fails closed when cancellation policy inputs do not match frozen identities', (): void => {
    const orderedToolCalls: AgentOrderedToolCallSnapshot[] = [
      {
        toolCallId: 'call-1',
        taskId: 'task-1',
        required: true,
        argumentsHash: 'a'.repeat(64),
        providerMetadataHash: 'b'.repeat(64)
      }
    ];

    expect((): void => {
      createCancellationPolicy(orderedToolCalls, {
        'call-1': {
          result: createResult('task-other', 'child-1', 'attempt-1', 'cancelled'),
          resultHash: 'c'.repeat(64)
        }
      });
    }).toThrowError(/protocol_error/u);
  });
});
