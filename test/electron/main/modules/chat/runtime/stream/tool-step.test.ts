/**
 * @file tool-step.test.ts
 * @description ChatRuntime 工具步骤分类与执行边界测试。
 */
import type { ObservedToolDefinition } from '../../../../../../../electron/main/modules/chat/runtime/stream/observer.mjs';
import type { RuntimeToolCallChunk } from '../../../../../../../electron/main/modules/chat/runtime/stream/types.mjs';
import type { ActiveChatRuntime } from '../../../../../../../electron/main/modules/chat/runtime/types.mjs';
import type { AIToolExecutionResult } from 'types/ai';
import type { ChatMessageRecord } from 'types/chat';
import type { DelegateTaskInput } from 'types/chat-agent';
import { describe, expect, it, vi } from 'vitest';
import { classifyToolStep, executeToolStep } from '../../../../../../../electron/main/modules/chat/runtime/stream/tool-step.mjs';

/**
 * 创建工具调用 chunk。
 * @param toolCallId - 调用 ID
 * @param toolName - 工具名称
 * @param input - 工具输入
 * @returns 完整调用 chunk
 */
function createCall(toolCallId: string, toolName: string, input: unknown = {}): RuntimeToolCallChunk {
  return { type: 'tool-call', toolCallId, toolName, input };
}

/**
 * 创建工具事实定义。
 * @param call - 完整调用 chunk
 * @param overrides - 观察事实局部覆盖
 * @returns 可供分类的事实
 */
function createDefinition(call: RuntimeToolCallChunk, overrides: Partial<ObservedToolDefinition> = {}): ObservedToolDefinition {
  return {
    toolCallId: call.toolCallId,
    startNames: [],
    calls: [call],
    resultNames: [],
    results: [],
    ...overrides
  };
}

/**
 * 创建合法的只读委派输入。
 * @returns delegate_task 输入
 */
function createDelegateInput(): DelegateTaskInput {
  return {
    task: '读取项目上下文',
    acceptanceCriteria: ['返回项目摘要'],
    mode: 'read',
    resources: [{ kind: 'file', reference: 'CONTEXT.md' }],
    requestedTools: ['read_file'],
    required: true,
    priority: 'normal'
  };
}

/**
 * 创建测试 Runtime。
 * @returns 已初始化工具步骤的 Runtime
 */
function createRuntime(): ActiveChatRuntime {
  return {
    runtimeId: 'runtime-tool-step',
    sessionId: 'session-tool-step',
    turnId: 'turn-tool-step',
    clientId: 'client-tool-step',
    agentId: 'agent-tool-step',
    rootRuntimeId: 'runtime-tool-step',
    status: 'running',
    phase: 'streaming',
    abortController: new AbortController(),
    createdAt: 0,
    currentToolStep: { toolCalls: [] }
  };
}

/**
 * 创建含执行中工具 Part 的 Assistant。
 * @param call - 工具调用
 * @returns 工作 Assistant 消息
 */
function createMessage(call: RuntimeToolCallChunk): ChatMessageRecord {
  return {
    id: 'assistant-tool-step',
    sessionId: 'session-tool-step',
    role: 'assistant',
    content: '',
    parts: [
      {
        id: 'part-tool-step',
        type: 'tool',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        status: 'executing',
        input: call.input
      }
    ],
    createdAt: '2026-08-10T00:00:00.000Z',
    loading: true,
    finished: false
  };
}

describe('runtime tool step', (): void => {
  it.each([
    {
      name: 'duplicate IDs',
      definitions: [createDefinition(createCall('call-1', 'read_file'), { calls: [createCall('call-1', 'read_file'), createCall('call-1', 'read_file')] })],
      exposed: new Set<string>(),
      reason: 'duplicate_tool_call_id'
    },
    {
      name: 'conflicting names',
      definitions: [createDefinition(createCall('call-1', 'read_file'), { startNames: ['write_file'] })],
      exposed: new Set<string>(),
      reason: 'tool_definition_conflict'
    },
    {
      name: 'mixed execution classes',
      definitions: [createDefinition(createCall('call-1', 'delegate_task', createDelegateInput())), createDefinition(createCall('call-2', 'read_file'))],
      exposed: new Set<string>(['delegate_task']),
      reason: 'mixed_execution_classes'
    },
    {
      name: 'unexposed deferred tools',
      definitions: [createDefinition(createCall('call-1', 'delegate_task', createDelegateInput()))],
      exposed: new Set<string>(),
      reason: 'deferred_tool_not_exposed'
    }
  ])('classifies $name before side effects', ({ definitions, exposed, reason }): void => {
    const observedTools = new Map<string, ObservedToolDefinition>(definitions.map((definition) => [definition.toolCallId, definition]));

    const classification = classifyToolStep({ observedTools, exposedDeferredToolNames: exposed });

    expect(classification.protocolReason).toBe(reason);
    expect(classification.deferredToolCalls).toEqual([]);
  });

  it('returns validated deferred calls without executing them', (): void => {
    const call = createCall('delegate-call-1', 'delegate_task', createDelegateInput());
    const observedTools = new Map<string, ObservedToolDefinition>([[call.toolCallId, createDefinition(call)]]);

    const classification = classifyToolStep({ observedTools, exposedDeferredToolNames: new Set<string>(['delegate_task']) });

    expect(classification.protocolReason).toBeUndefined();
    expect(classification.deferredToolCalls).toEqual([expect.objectContaining({ toolCallId: 'delegate-call-1', toolName: 'delegate_task' })]);
  });

  it('runs the guard before accepting a provider result', async (): Promise<void> => {
    const call = createCall('call-guard', 'read_file', { path: 'CONTEXT.md' });
    const providerResult: AIToolExecutionResult = { toolName: 'read_file', status: 'success', data: { content: 'provider' } };
    const guardResult: AIToolExecutionResult = {
      toolName: 'read_file',
      status: 'failure',
      error: { code: 'PERMISSION_DENIED', message: '拒绝读取' }
    };
    const definition = createDefinition(call, {
      resultNames: ['read_file'],
      results: [{ type: 'tool-result', toolCallId: call.toolCallId, toolName: call.toolName, result: providerResult }]
    });
    const observedTools = new Map<string, ObservedToolDefinition>([[call.toolCallId, definition]]);
    const classification = classifyToolStep({ observedTools, exposedDeferredToolNames: new Set<string>() });
    const guardToolCall = vi.fn(async (): Promise<AIToolExecutionResult> => guardResult);
    const persistAssistant = vi.fn(async (): Promise<void> => undefined);
    const assistantMessage = createMessage(call);

    const result = await executeToolStep({
      runtime: createRuntime(),
      assistantMessage,
      classification,
      deferredToolCallIds: new Set<string>(),
      dependencies: { guardToolCall },
      startToolLease: vi.fn(),
      persistAssistant
    });

    expect(guardToolCall).toHaveBeenCalledTimes(1);
    expect(assistantMessage.parts[0]).toEqual(expect.objectContaining({ status: 'done', result: guardResult }));
    expect(result.executedToolCount).toBe(1);
    expect(result.allToolsContinueable).toBe(true);
    expect(persistAssistant).toHaveBeenCalledTimes(1);
  });
});
