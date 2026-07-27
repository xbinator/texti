/**
 * @file stream/executor.test.ts
 * @description ChatRuntime 主进程流式执行器测试。
 */
import type { ActiveChatRuntime, ChatRuntimeMainToolExecutionInput } from '../../../../../../../electron/main/modules/chat/runtime/types.mjs';
import type { AIMCPRequestConfig, AIToolExecutionResult, AITransportTool } from 'types/ai';
import type { ChatMessageRecord } from 'types/chat';
import type { DelegateTaskInput } from 'types/chat-agent';
import { cloneDeep } from 'lodash-es';
import { describe, expect, it, vi } from 'vitest';
import { hashAgentPayload, validateFoundationContract } from '../../../../../../../electron/main/modules/chat/agents/contracts.mjs';
import { createRuntimeStreamExecutor } from '../../../../../../../electron/main/modules/chat/runtime/stream/index.mjs';

/** 测试 runtime 状态。 */
const runtime: ActiveChatRuntime = {
  runtimeId: 'runtime-1',
  sessionId: 'session-1',
  turnId: 'turn-1',
  clientId: 'client-1',
  agentId: 'agent-1',
  rootRuntimeId: 'runtime-1',
  status: 'running',
  phase: 'streaming',
  abortController: new AbortController(),
  createdAt: 0
};

/** 委派工具必须显式出现在当前 Runtime 的工具快照中。 */
const delegateTool: AITransportTool = {
  name: 'delegate_task',
  description: 'Delegate one bounded task.',
  parameters: { type: 'object', properties: {} }
};

/** 可由 AI SDK 发现并执行工具的 MCP 请求配置。 */
const executableMcp: AIMCPRequestConfig = {
  servers: [
    {
      id: 'mcp-enabled',
      name: 'Enabled MCP',
      enabled: true,
      transport: 'stdio',
      command: 'mcp-server',
      args: [],
      env: {},
      headers: {},
      toolAllowlist: ['search'],
      connectTimeoutMs: 20_000,
      toolCallTimeoutMs: 30_000
    }
  ],
  enabledServerIds: ['mcp-enabled'],
  enabledTools: [{ serverId: 'mcp-enabled', toolName: 'search' }],
  toolInstructions: ''
};

/**
 * 创建显式暴露委派工具的 Runtime。
 * @param overrides - Runtime 局部覆盖
 * @returns 暴露 delegate_task 的 Runtime
 */
function createDelegateRuntime(overrides: Partial<ActiveChatRuntime> = {}): ActiveChatRuntime {
  return {
    ...runtime,
    ...overrides,
    tools: overrides.tools ?? [delegateTool]
  };
}

/** ChatRuntime 默认传给 AI 服务的内部续轮策略。 */
const RUNTIME_CALL_OPTIONS = {
  runtimeToolLoop: true,
  forceFinal: false,
  totalTimeoutMs: 300_000
} as const;

/** 测试 user 消息。 */
const userMessage: ChatMessageRecord = {
  id: 'user-1',
  sessionId: 'session-1',
  role: 'user',
  content: 'hello',
  parts: [{ id: 'part0123', type: 'text', text: 'hello' }],
  createdAt: '2026-06-19T00:00:00.000Z',
  finished: true
};

/**
 * 创建 assistant 草稿消息。
 * @returns assistant 草稿消息
 */
function createAssistantMessage(): ChatMessageRecord {
  return {
    id: 'assistant-1',
    sessionId: 'session-1',
    role: 'assistant',
    content: '',
    parts: [],
    createdAt: '2026-06-19T00:00:00.000Z',
    loading: true,
    finished: false
  };
}

/** 延迟委派测试流中的单个调用。 */
interface DelegateStreamCall {
  /** 工具调用 ID。 */
  toolCallId: string;
  /** 委派契约输入。 */
  input: DelegateTaskInput;
  /** 可选 Provider 元数据。 */
  providerMetadata?: Record<string, unknown>;
}

/**
 * 创建合法的只读委派契约。
 * @param task - 子任务描述
 * @returns 最小只读委派输入
 */
function createDelegateInput(task: string): DelegateTaskInput {
  return {
    task,
    acceptanceCriteria: [`完成 ${task}`],
    mode: 'read',
    resources: [{ kind: 'file', reference: 'CONTEXT.md' }],
    requestedTools: ['read_file'],
    required: true,
    priority: 'normal'
  };
}

/**
 * 创建仅包含延迟委派调用的 Provider 流。
 * @param calls - 有序委派调用
 * @returns AI stream chunk 序列
 */
async function* createDelegateStream(calls: readonly DelegateStreamCall[]): AsyncGenerator<unknown> {
  for (const call of calls) {
    yield {
      type: 'tool-input-start',
      id: call.toolCallId,
      toolName: 'delegate_task',
      ...(call.providerMetadata ? { providerMetadata: call.providerMetadata } : {})
    };
    yield { type: 'tool-input-delta', id: call.toolCallId, delta: JSON.stringify(call.input) };
    yield { type: 'tool-input-end', id: call.toolCallId };
    yield {
      type: 'tool-call',
      toolCallId: call.toolCallId,
      toolName: 'delegate_task',
      input: call.input,
      ...(call.providerMetadata ? { providerMetadata: call.providerMetadata } : {})
    };
  }
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 } };
}

/**
 * 创建仅在 input-start 携带 Provider 元数据的委派流。
 * @param input - 委派契约输入
 * @param providerMetadata - 仅由 start chunk 提供的元数据
 * @returns AI stream chunk 序列
 */
async function* createStartMetadataStream(input: DelegateTaskInput, providerMetadata: unknown): AsyncGenerator<unknown> {
  yield {
    type: 'tool-input-start',
    id: 'delegate-call-1',
    toolName: 'delegate_task',
    providerMetadata
  };
  yield { type: 'tool-input-delta', id: 'delegate-call-1', delta: JSON.stringify(input) };
  yield { type: 'tool-input-end', id: 'delegate-call-1' };
  yield {
    type: 'tool-call',
    toolCallId: 'delegate-call-1',
    toolName: 'delegate_task',
    input
  };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 } };
}

/**
 * 创建 direct 与 deferred 交错的 Provider 流。
 * @param deferredFirst - 是否先完成延迟调用
 * @returns AI stream chunk 序列
 */
async function* createMixedDelegateStream(deferredFirst: boolean): AsyncGenerator<unknown> {
  const delegateInput = createDelegateInput('浏览上下文');
  if (deferredFirst) {
    yield { type: 'tool-input-start', id: 'delegate-call-1', toolName: 'delegate_task' };
    yield { type: 'tool-input-delta', id: 'delegate-call-1', delta: JSON.stringify(delegateInput) };
    yield { type: 'tool-input-end', id: 'delegate-call-1' };
    yield { type: 'tool-call', toolCallId: 'delegate-call-1', toolName: 'delegate_task', input: delegateInput };
    yield { type: 'tool-call', toolCallId: 'direct-call-1', toolName: 'read_file', input: { path: 'CONTEXT.md' } };
  } else {
    yield { type: 'tool-call', toolCallId: 'direct-call-1', toolName: 'read_file', input: { path: 'CONTEXT.md' } };
    yield { type: 'tool-input-start', id: 'delegate-call-1', toolName: 'delegate_task' };
    yield { type: 'tool-input-delta', id: 'delegate-call-1', delta: JSON.stringify(delegateInput) };
    yield { type: 'tool-input-end', id: 'delegate-call-1' };
    yield { type: 'tool-call', toolCallId: 'delegate-call-1', toolName: 'delegate_task', input: delegateInput };
  }
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 } };
}

/**
 * 创建两个普通 direct 工具调用的 Provider 流。
 * @returns AI stream chunk 序列
 */
async function* createDirectPairStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'direct-call-1', toolName: 'read_file', input: { path: 'CONTEXT.md' } };
  yield { type: 'tool-call', toolCallId: 'direct-call-2', toolName: 'read_file', input: { path: 'AGENTS.md' } };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 } };
}

/**
 * 创建一个 start-only 定义与另一个完整调用混合的流。
 * @param deferredStartOnly - start-only 定义是否属于 deferred
 * @returns AI stream chunk 序列
 */
async function* createStartOnlyStream(deferredStartOnly: boolean): AsyncGenerator<unknown> {
  if (deferredStartOnly) {
    yield { type: 'tool-input-start', id: 'start-only-call', toolName: 'delegate_task' };
    yield { type: 'tool-call', toolCallId: 'complete-call', toolName: 'read_file', input: { path: 'CONTEXT.md' } };
  } else {
    yield { type: 'tool-input-start', id: 'start-only-call', toolName: 'read_file' };
    yield {
      type: 'tool-call',
      toolCallId: 'complete-call',
      toolName: 'delegate_task',
      input: createDelegateInput('浏览上下文')
    };
  }
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 } };
}

/**
 * 创建携带敏感输入但缺少完整 call 定义的 deferred 流。
 * @returns AI stream chunk 序列
 */
async function* createIncompleteDelegateStream(): AsyncGenerator<unknown> {
  yield {
    type: 'tool-input-start',
    id: 'delegate-call-1',
    toolName: 'delegate_task',
    providerMetadata: { secretSignature: 'incomplete-provider-secret' }
  };
  yield {
    type: 'tool-input-delta',
    id: 'delegate-call-1',
    delta: '{"task":"incomplete-contract-secret"'
  };
  yield { type: 'tool-input-end', id: 'delegate-call-1' };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 } };
}

/**
 * 创建同一 ID 的 start/call 定义冲突流。
 * @param startName - start 阶段工具名称
 * @param callName - call 阶段工具名称
 * @returns AI stream chunk 序列
 */
async function* createConflictStream(startName: string, callName: string): AsyncGenerator<unknown> {
  yield { type: 'tool-input-start', id: 'conflict-call', toolName: startName };
  yield {
    type: 'tool-call',
    toolCallId: 'conflict-call',
    toolName: callName,
    input: callName === 'delegate_task' ? createDelegateInput('浏览上下文') : { path: 'CONTEXT.md' }
  };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 } };
}

/**
 * 创建重复完整调用 ID 的流。
 * @returns AI stream chunk 序列
 */
async function* createDuplicateCallStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'duplicate-call', toolName: 'read_file', input: { path: 'CONTEXT.md' } };
  yield { type: 'tool-call', toolCallId: 'duplicate-call', toolName: 'read_file', input: { path: 'AGENTS.md' } };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 } };
}

/**
 * 创建停止类 Provider result 后仍出现 deferred 定义的流。
 * @param finishBeforeResult - finish 是否先于停止结果
 * @returns AI stream chunk 序列
 */
async function* createLateDeferredStream(finishBeforeResult: boolean): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'direct-call-1', toolName: 'read_file', input: { path: 'CONTEXT.md' } };
  if (finishBeforeResult) {
    yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 } };
  }
  yield {
    type: 'tool-result',
    toolCallId: 'direct-call-1',
    toolName: 'read_file',
    output: {
      toolName: 'read_file',
      status: 'cancelled',
      error: { code: 'USER_CANCELLED', message: 'provider cancelled' }
    }
  };
  if (!finishBeforeResult) {
    yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 } };
  }
  yield { type: 'tool-input-start', id: 'delegate-call-1', toolName: 'delegate_task' };
  yield {
    type: 'tool-call',
    toolCallId: 'delegate-call-1',
    toolName: 'delegate_task',
    input: createDelegateInput('浏览上下文')
  };
}

/**
 * 创建停止类 Provider result 后仍出现 pure-direct 调用的流。
 * @returns AI stream chunk 序列
 */
async function* createStoppedDirectStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'direct-call-1', toolName: 'read_file', input: { path: 'CONTEXT.md' } };
  yield {
    type: 'tool-result',
    toolCallId: 'direct-call-1',
    toolName: 'read_file',
    output: {
      toolName: 'read_file',
      status: 'awaiting_user_input',
      data: {
        questionId: 'question-1',
        toolCallId: 'direct-call-1',
        question: '继续吗？',
        mode: 'single',
        options: [{ label: '继续', value: 'yes' }]
      }
    }
  };
  yield { type: 'tool-call', toolCallId: 'direct-call-2', toolName: 'read_file', input: { path: 'AGENTS.md' } };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 } };
}

/**
 * 创建 Provider result 早于 deferred start/call 的非法流。
 * @param results - 同一调用 ID 的 Provider 工具结果
 * @returns AI stream chunk 序列
 */
async function* createEarlyResultStream(results: readonly AIToolExecutionResult[]): AsyncGenerator<unknown> {
  for (const result of results) {
    yield {
      type: 'tool-result',
      toolCallId: 'delegate-call-1',
      toolName: result.toolName,
      output: result
    };
  }
  yield { type: 'tool-input-start', id: 'delegate-call-1', toolName: 'delegate_task' };
  yield {
    type: 'tool-call',
    toolCallId: 'delegate-call-1',
    toolName: 'delegate_task',
    input: createDelegateInput('浏览上下文')
  };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 } };
}

/**
 * 创建停止类 Provider result 后仍发出内容、错误及可选 deferred 定义的流。
 * @param terminalType - 停止点后的错误事件类型
 * @param includeDeferred - 是否在 late error 后追加 deferred 定义
 * @returns AI stream chunk 序列
 */
async function* createPostStopNoiseStream(terminalType: 'error' | 'abort', includeDeferred: boolean): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'direct-call-1', toolName: 'read_file', input: { path: 'CONTEXT.md' } };
  yield {
    type: 'tool-result',
    toolCallId: 'direct-call-1',
    toolName: 'read_file',
    output: {
      toolName: 'read_file',
      status: 'cancelled',
      error: { code: 'PROVIDER_CANCELLED', message: 'provider stopped' }
    }
  };
  yield { type: 'text-delta', text: 'post-stop-text-secret' };
  yield { type: 'reasoning-delta', text: 'post-stop-reasoning-secret' };
  if (terminalType === 'error') {
    yield { type: 'error', error: new Error('late provider error') };
  } else {
    yield { type: 'abort', reason: 'late provider abort' };
  }
  if (includeDeferred) {
    yield { type: 'tool-input-start', id: 'delegate-call-1', toolName: 'delegate_task' };
    yield {
      type: 'tool-call',
      toolCallId: 'delegate-call-1',
      toolName: 'delegate_task',
      input: createDelegateInput('浏览上下文')
    };
  }
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 } };
}

/**
 * 创建测试流。
 * @returns AI stream chunk 序列
 */
async function* createTextStream(): AsyncGenerator<unknown> {
  yield { type: 'reasoning-delta', text: 'thinking' };
  yield { type: 'text-delta', text: 'Hello ' };
  yield { type: 'text-delta', text: 'runtime' };
  yield { type: 'finish-step', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } };
  yield {
    type: 'finish',
    finishReason: 'stop',
    totalUsage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 }
  };
}

/**
 * 创建含工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createToolStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-input-start', id: 'tool-call-1', toolName: 'read_file' };
  yield { type: 'tool-input-delta', id: 'tool-call-1', delta: '{"path":"' };
  yield { type: 'tool-input-delta', id: 'tool-call-1', delta: 'src/index.ts"}' };
  yield { type: 'tool-input-end', id: 'tool-call-1' };
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'read_file', input: { path: 'src/index.ts' } };
  yield { type: 'tool-result', toolCallId: 'tool-call-1', toolName: 'read_file', output: { content: 'export const ok = true;' } };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 } };
}

/**
 * 创建需要 renderer 执行本地工具的测试流。
 * @returns AI stream chunk 序列
 */
async function* createRendererToolStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'renderer_echo', input: { value: 'ping' } };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 } };
}

/**
 * 创建 provider 以 stop 结束但实际包含工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createRendererToolStopFinishStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'renderer_echo', input: { value: 'ping' } };
  yield { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 } };
}

/**
 * 创建等待用户回答的 question 工具调用测试流。
 * @returns AI stream chunk 序列
 */
async function* createQuestionToolStream(): AsyncGenerator<unknown> {
  yield {
    type: 'tool-call',
    toolCallId: 'tool-call-question',
    toolName: 'question',
    input: {
      question: '确认下单生椰拿铁，实付 9.9?',
      mode: 'single',
      options: [
        { label: '确认下单!', value: 'confirm' },
        { label: '再想想...', value: 'cancel' }
      ]
    }
  };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 } };
}

/**
 * 创建 AI SDK 7 的增量工具输入与最终工具调用测试流。
 * @returns AI stream chunk 序列
 */
async function* createQuestionInputStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-input-start', id: 'tool-call-question', toolName: 'question' };
  yield { type: 'tool-input-delta', id: 'tool-call-question', delta: '{"question":"确认下单生椰拿铁，实付 9.9?","mode":"single","options":[' };
  yield { type: 'tool-input-delta', id: 'tool-call-question', delta: '{"label":"确认下单!","value":"confirm"}]}' };
  yield { type: 'tool-input-end', id: 'tool-call-question' };
  yield {
    type: 'tool-call',
    toolCallId: 'tool-call-question',
    toolName: 'question',
    input: {
      question: '确认下单生椰拿铁，实付 9.9?',
      mode: 'single',
      options: [{ label: '确认下单!', value: 'confirm' }]
    }
  };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 } };
}

/**
 * 创建主进程 read_file 工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createMainReadFileToolCallStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'read_file', input: { path: 'secret.md' } };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 } };
}

/**
 * 创建同一模型流内包含两个工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createTwoMainToolCallStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'read_file', input: { path: 'secret.md' } };
  yield { type: 'tool-call', toolCallId: 'tool-call-2', toolName: 'run_shell_command', input: { command: 'echo should-not-run' } };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 } };
}

/**
 * 创建主进程 bridge 工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createMainBridgeToolStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'read_current_document', input: {} };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 6, outputTokens: 4, totalTokens: 10 } };
}

/**
 * 创建主进程网页读取工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createMainWebpageToolStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'read_current_webpage', input: {} };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 } };
}

/**
 * 创建主进程当前时间工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createMainTimeToolStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'get_current_time', input: {} };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 5, outputTokens: 4, totalTokens: 9 } };
}

/**
 * 创建主进程日志查询工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createMainQueryLogsToolStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'query_logs', input: { level: 'ERROR', limit: 5 } };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 11, outputTokens: 4, totalTokens: 15 } };
}

/**
 * 创建主进程文件读取工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createMainReadFileToolStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'read_file', input: { path: 'src/index.ts', offset: 1, limit: 2 } };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 } };
}

/**
 * 创建主进程目录读取工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createMainReadDirectoryToolStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'read_directory', input: { path: 'src' } };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 } };
}

/**
 * 创建主进程设置读取工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createMainGetSettingsToolStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'get_settings', input: { keys: ['theme'] } };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 6, outputTokens: 4, totalTokens: 10 } };
}

/**
 * 创建主进程 MCP 设置读取工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createMainGetMcpSettingsToolStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'get_mcp_settings', input: {} };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 7, outputTokens: 4, totalTokens: 11 } };
}

/**
 * 创建主进程新增 MCP server 工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createMainAddMcpServerToolStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'add_mcp_server', input: { name: 'Local MCP', command: 'npx', args: ['server'] } };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
}

/**
 * 创建主进程更新 MCP server 工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createMainUpdateMcpServerToolStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'update_mcp_server', input: { serverId: 'mcp-1', patch: { enabled: false } } };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 } };
}

/**
 * 创建主进程删除 MCP server 工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createMainRemoveMcpServerToolStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'remove_mcp_server', input: { serverId: 'mcp-1' } };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
}

/**
 * 创建主进程刷新 MCP discovery 工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createMainRefreshMcpDiscoveryToolStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'refresh_mcp_discovery', input: { serverId: 'mcp-1' } };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 } };
}

/**
 * 创建主进程打开资源工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createMainOpenResourceToolStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'open_resource', input: { path: 'https://example.com' } };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
}

/**
 * 创建主进程设置修改工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createMainUpdateSettingsToolStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'update_settings', input: { key: 'theme', value: 'dark' } };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 7, outputTokens: 4, totalTokens: 11 } };
}

/**
 * 创建主进程文档创建工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createMainCreateDocumentToolStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'create_document', input: { title: 'Notes', content: '# Notes', ext: 'md' } };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 } };
}

/**
 * 创建主进程文件写入工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createMainWriteFileToolStream(): AsyncGenerator<unknown> {
  yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'write_file', input: { path: 'docs/report.md', content: '# Report' } };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 } };
}

/**
 * 创建主进程文件编辑工具调用的测试流。
 * @returns AI stream chunk 序列
 */
async function* createMainEditFileToolStream(): AsyncGenerator<unknown> {
  yield {
    type: 'tool-call',
    toolCallId: 'tool-call-1',
    toolName: 'edit_file',
    input: { path: 'docs/report.md', oldString: 'old', newString: 'new' }
  };
  yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 11, outputTokens: 4, totalTokens: 15 } };
}

describe('runtime stream executor', (): void => {
  it('returns one deferred suspension without exposing or executing the tool part', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const delegateRuntime = createDelegateRuntime();
    const persistedUpdates: ChatMessageRecord[] = [];
    const executeMainTool = vi.fn();
    const executeRendererTool = vi.fn();
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([
      undefined,
      {
        stream: createDelegateStream([
          {
            toolCallId: 'delegate-call-1',
            input: createDelegateInput('浏览上下文'),
            providerMetadata: { anthropic: { signature: 'provider-signature' } }
          }
        ])
      }
    ]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool, executeRendererTool });

    const result = await executor({ runtime: delegateRuntime, userMessage, assistantMessage }, async (message) => {
      persistedUpdates.push(structuredClone(message));
    });

    expect(result).toMatchObject({
      shouldContinue: false,
      suspension: {
        toolCalls: [
          {
            toolCallId: 'delegate-call-1',
            toolName: 'delegate_task',
            input: createDelegateInput('浏览上下文'),
            argumentsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            providerMetadataHash: expect.stringMatching(/^[a-f0-9]{64}$/)
          }
        ]
      }
    });
    expect(executeMainTool).not.toHaveBeenCalled();
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(delegateRuntime.resolvedModel).toMatchObject({
      createOptions: { providerId: 'openai' },
      modelId: 'gpt-test'
    });
    expect(persistedUpdates.every((message): boolean => message.parts.every((part): boolean => part.type !== 'tool'))).toBe(true);
    expect(assistantMessage.parts).toEqual([
      expect.objectContaining({
        type: 'tool',
        toolCallId: 'delegate-call-1',
        toolName: 'delegate_task',
        status: 'executing',
        input: createDelegateInput('浏览上下文'),
        providerMetadata: { anthropic: { signature: 'provider-signature' } }
      })
    ]);
  });

  it('inherits Provider metadata from tool-input-start into the deferred suspension', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const providerMetadata = { anthropic: { signature: 'start-only-signature' } };
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createStartMetadataStream(createDelegateInput('浏览上下文'), providerMetadata) }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText });

    const result = await executor({ runtime: createDelegateRuntime(), userMessage, assistantMessage }, async () => undefined);

    expect(result.suspension?.toolCalls).toEqual([
      expect.objectContaining({
        toolCallId: 'delegate-call-1',
        providerMetadataHash: hashAgentPayload(providerMetadata)
      })
    ]);
    expect(assistantMessage.parts).toEqual([
      expect.objectContaining({
        toolCallId: 'delegate-call-1',
        providerMetadata
      })
    ]);
  });

  it('hashes the normalized delegation contract carried by the suspension', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const rawInput: DelegateTaskInput = {
      task: '  浏览上下文  ',
      acceptanceCriteria: ['  返回摘要  '],
      mode: 'read',
      resources: [{ kind: 'file', reference: '  CONTEXT.md  ' }],
      requestedTools: ['search_web', 'read_file'],
      required: true,
      priority: 'normal'
    };
    const validation = validateFoundationContract(rawInput);
    if (!validation.ok) throw new Error('expected normalized delegation fixture to be valid');
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createDelegateStream([{ toolCallId: 'delegate-call-1', input: rawInput }]) }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText });

    const result = await executor({ runtime: createDelegateRuntime(), userMessage, assistantMessage }, async () => undefined);
    const suspendedCall = result.suspension?.toolCalls[0];

    expect(suspendedCall?.input).toEqual(validation.contract);
    expect(suspendedCall?.argumentsHash).toBe(hashAgentPayload(validation.contract));
    expect(suspendedCall?.argumentsHash).not.toBe(hashAgentPayload(rawInput));
  });

  it.each<[string, AIToolExecutionResult]>([
    [
      'success',
      {
        toolName: 'delegate_task',
        status: 'success',
        data: { unexpected: true }
      }
    ],
    [
      'stopping cancellation',
      {
        toolName: 'delegate_task',
        status: 'cancelled',
        error: { code: 'USER_CANCELLED', message: 'provider stopped' }
      }
    ]
  ])(
    'rejects a deferred Provider result before its definition without leaking it: %s',
    async (_label: string, providerResult: AIToolExecutionResult): Promise<void> => {
      const assistantMessage = createAssistantMessage();
      const persistedUpdates: ChatMessageRecord[] = [];
      const executeMainTool = vi.fn();
      const executeRendererTool = vi.fn();
      const resolve = vi.fn().mockResolvedValue({
        createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
        modelId: 'gpt-test'
      });
      const streamText = vi.fn().mockResolvedValue([undefined, { stream: createEarlyResultStream([providerResult]) }]);
      const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool, executeRendererTool });

      const result = await executor({ runtime: createDelegateRuntime(), userMessage, assistantMessage }, async (message) => {
        persistedUpdates.push(structuredClone(message));
      });

      expect(result.suspension).toBeUndefined();
      expect(result.shouldContinue).toBeUndefined();
      expect(executeMainTool).not.toHaveBeenCalled();
      expect(executeRendererTool).not.toHaveBeenCalled();
      expect(
        persistedUpdates.every((message): boolean => message.parts.every((part): boolean => part.type !== 'tool' || part.toolCallId !== 'delegate-call-1'))
      ).toBe(true);
      expect(assistantMessage.parts).toEqual([
        expect.objectContaining({
          toolCallId: 'delegate-call-1',
          status: 'done',
          result: expect.objectContaining({
            status: 'failure',
            error: expect.objectContaining({ code: 'protocol_error' })
          })
        })
      ]);
    }
  );

  it('rejects a deferred Provider result with a conflicting tool name without leaking it', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const persistedUpdates: ChatMessageRecord[] = [];
    const executeMainTool = vi.fn();
    const executeRendererTool = vi.fn();
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([
      undefined,
      {
        stream: createEarlyResultStream([
          {
            toolName: 'read_file',
            status: 'success',
            data: { content: 'must stay private' }
          }
        ])
      }
    ]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool, executeRendererTool });

    const result = await executor({ runtime: createDelegateRuntime(), userMessage, assistantMessage }, async (message) => {
      persistedUpdates.push(structuredClone(message));
    });

    expect(result.suspension).toBeUndefined();
    expect(executeMainTool).not.toHaveBeenCalled();
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(
      persistedUpdates.every((message): boolean => message.parts.every((part): boolean => part.type !== 'tool' || part.toolCallId !== 'delegate-call-1'))
    ).toBe(true);
    expect(assistantMessage.parts).toEqual([
      expect.objectContaining({
        toolCallId: 'delegate-call-1',
        status: 'done',
        result: expect.objectContaining({ error: expect.objectContaining({ code: 'protocol_error' }) })
      })
    ]);
  });

  it('rejects duplicate deferred Provider results without leaking them', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const persistedUpdates: ChatMessageRecord[] = [];
    const executeMainTool = vi.fn();
    const executeRendererTool = vi.fn();
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const duplicateResult: AIToolExecutionResult = {
      toolName: 'delegate_task',
      status: 'success',
      data: { unexpected: true }
    };
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createEarlyResultStream([duplicateResult, structuredClone(duplicateResult)]) }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool, executeRendererTool });

    const result = await executor({ runtime: createDelegateRuntime(), userMessage, assistantMessage }, async (message) => {
      persistedUpdates.push(structuredClone(message));
    });

    expect(result.suspension).toBeUndefined();
    expect(executeMainTool).not.toHaveBeenCalled();
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(
      persistedUpdates.every((message): boolean => message.parts.every((part): boolean => part.type !== 'tool' || part.toolCallId !== 'delegate-call-1'))
    ).toBe(true);
    expect(assistantMessage.parts).toEqual([
      expect.objectContaining({
        toolCallId: 'delegate-call-1',
        status: 'done',
        result: expect.objectContaining({ error: expect.objectContaining({ code: 'protocol_error' }) })
      })
    ]);
  });

  it('collects multiple deferred calls into one ordered suspension', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const executeMainTool = vi.fn();
    const executeRendererTool = vi.fn();
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([
      undefined,
      {
        stream: createDelegateStream([
          { toolCallId: 'delegate-call-1', input: createDelegateInput('浏览上下文') },
          { toolCallId: 'delegate-call-2', input: createDelegateInput('浏览工具指南') }
        ])
      }
    ]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool, executeRendererTool });

    const result = await executor({ runtime: createDelegateRuntime(), userMessage, assistantMessage }, async () => undefined);

    expect(result).toMatchObject({
      shouldContinue: false,
      suspension: {
        toolCalls: [
          { toolCallId: 'delegate-call-1', toolName: 'delegate_task', input: createDelegateInput('浏览上下文') },
          { toolCallId: 'delegate-call-2', toolName: 'delegate_task', input: createDelegateInput('浏览工具指南') }
        ]
      }
    });
    expect(executeMainTool).not.toHaveBeenCalled();
    expect(executeRendererTool).not.toHaveBeenCalled();
  });

  it('rejects exposed deferred tools with executable Tavily before starting the model stream', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createTextStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText });

    await expect(
      executor(
        {
          runtime: createDelegateRuntime({ tavily: { enabled: true, apiKey: 'tvly-enabled' } }),
          userMessage,
          assistantMessage
        },
        async () => undefined
      )
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(streamText).not.toHaveBeenCalled();
  });

  it('rejects exposed deferred tools with executable MCP before starting the model stream', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createTextStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText });

    await expect(
      executor(
        {
          runtime: createDelegateRuntime({ mcp: executableMcp }),
          userMessage,
          assistantMessage
        },
        async () => undefined
      )
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(streamText).not.toHaveBeenCalled();
  });

  it('allows deferred tools when MCP enables no tool on a runnable server', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createTextStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText });
    const mcpWithoutTools: AIMCPRequestConfig = {
      ...executableMcp,
      enabledTools: [{ serverId: 'another-server', toolName: 'search' }]
    };

    await executor(
      {
        runtime: createDelegateRuntime({ mcp: mcpWithoutTools }),
        userMessage,
        assistantMessage
      },
      async () => undefined
    );

    expect(streamText).toHaveBeenCalledOnce();
  });

  it('treats an unexposed delegate_task call as a protocol error instead of suspending', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const persistedUpdates: ChatMessageRecord[] = [];
    const secretInput = createDelegateInput('unexposed-contract-secret');
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([
      undefined,
      {
        stream: createDelegateStream([
          {
            toolCallId: 'delegate-call-1',
            input: secretInput,
            providerMetadata: { secretSignature: 'unexposed-provider-secret' }
          }
        ])
      }
    ]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText });

    const result = await executor({ runtime: { ...runtime }, userMessage, assistantMessage }, async (message) => {
      persistedUpdates.push(structuredClone(message));
    });

    expect(result.suspension).toBeUndefined();
    expect(JSON.stringify(persistedUpdates)).not.toContain('unexposed-contract-secret');
    expect(JSON.stringify(persistedUpdates)).not.toContain('unexposed-provider-secret');
    expect(assistantMessage.parts).toEqual([
      expect.objectContaining({
        toolCallId: 'delegate-call-1',
        status: 'done',
        input: null,
        result: expect.objectContaining({
          status: 'failure',
          error: expect.objectContaining({ code: 'protocol_error' })
        })
      })
    ]);
    expect(assistantMessage.parts[0]).not.toHaveProperty('inputText');
    expect(assistantMessage.parts[0]).not.toHaveProperty('providerMetadata');
  });

  it('scrubs an invalid deferred contract before persisting its protocol error', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const persistedUpdates: ChatMessageRecord[] = [];
    const invalidInput: DelegateTaskInput = {
      ...createDelegateInput('invalid-contract-secret'),
      acceptanceCriteria: []
    };
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([
      undefined,
      {
        stream: createDelegateStream([
          {
            toolCallId: 'delegate-call-1',
            input: invalidInput,
            providerMetadata: { secretSignature: 'invalid-provider-secret' }
          }
        ])
      }
    ]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText });

    const result = await executor({ runtime: createDelegateRuntime(), userMessage, assistantMessage }, async (message) => {
      persistedUpdates.push(structuredClone(message));
    });

    expect(result.suspension).toBeUndefined();
    expect(JSON.stringify(persistedUpdates)).not.toContain('invalid-contract-secret');
    expect(JSON.stringify(persistedUpdates)).not.toContain('invalid-provider-secret');
    expect(persistedUpdates.at(-1)?.parts).toEqual([
      expect.objectContaining({
        toolCallId: 'delegate-call-1',
        toolName: 'delegate_task',
        status: 'done',
        input: null,
        result: expect.objectContaining({ error: expect.objectContaining({ code: 'protocol_error' }) })
      })
    ]);
    expect(persistedUpdates.at(-1)?.parts[0]).not.toHaveProperty('inputText');
    expect(persistedUpdates.at(-1)?.parts[0]).not.toHaveProperty('providerMetadata');
  });

  it('preserves executable Tavily and MCP requests when no deferred tool is exposed', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createTextStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText });
    const directRuntime: ActiveChatRuntime = {
      ...runtime,
      tools: [{ name: 'read_file', description: 'Read a file.', parameters: { type: 'object', properties: {} } }],
      tavily: { enabled: true, apiKey: 'tvly-enabled' },
      mcp: executableMcp
    };

    await executor({ runtime: directRuntime, userMessage, assistantMessage }, async () => undefined);

    expect(streamText).toHaveBeenCalledOnce();
  });

  it.each([
    ['direct before deferred', false],
    ['deferred before direct', true]
  ])('rejects mixed execution classes before side effects: %s', async (_label: string, deferredFirst: boolean): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const executeMainTool = vi.fn().mockResolvedValue({
      toolName: 'read_file',
      status: 'success',
      data: { content: 'must not run' }
    });
    const executeRendererTool = vi.fn();
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMixedDelegateStream(deferredFirst) }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool, executeRendererTool });

    const result = await executor({ runtime: createDelegateRuntime(), userMessage, assistantMessage }, async () => undefined);

    expect(executeMainTool).not.toHaveBeenCalled();
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result.suspension).toBeUndefined();
    expect(result.shouldContinue).toBe(true);
    expect(assistantMessage.parts).toHaveLength(2);
    expect(assistantMessage.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool',
          toolCallId: 'delegate-call-1',
          status: 'done',
          result: expect.objectContaining({
            status: 'failure',
            error: expect.objectContaining({ code: 'protocol_error' })
          })
        }),
        expect.objectContaining({
          type: 'tool',
          toolCallId: 'direct-call-1',
          status: 'done',
          result: expect.objectContaining({
            status: 'failure',
            error: expect.objectContaining({ code: 'protocol_error' })
          })
        })
      ])
    );
  });

  it('scrubs only deferred control data when a mixed step becomes a protocol error', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const persistedUpdates: ChatMessageRecord[] = [];
    const executeMainTool = vi.fn();
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMixedDelegateStream(true) }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool });

    await executor({ runtime: createDelegateRuntime(), userMessage, assistantMessage }, async (message) => {
      persistedUpdates.push(structuredClone(message));
    });

    const finalParts = persistedUpdates.at(-1)?.parts ?? [];
    const deferredPart = finalParts.find((part): boolean => part.type === 'tool' && part.toolCallId === 'delegate-call-1');
    const directPart = finalParts.find((part): boolean => part.type === 'tool' && part.toolCallId === 'direct-call-1');
    expect(executeMainTool).not.toHaveBeenCalled();
    expect(deferredPart).toMatchObject({
      type: 'tool',
      toolCallId: 'delegate-call-1',
      status: 'done',
      input: null,
      result: expect.objectContaining({ error: expect.objectContaining({ code: 'protocol_error' }) })
    });
    expect(deferredPart).not.toHaveProperty('inputText');
    expect(deferredPart).not.toHaveProperty('providerMetadata');
    expect(directPart).toMatchObject({
      type: 'tool',
      toolCallId: 'direct-call-1',
      input: { path: 'CONTEXT.md' },
      result: expect.objectContaining({ error: expect.objectContaining({ code: 'protocol_error' }) })
    });
  });

  it('preserves ordinary direct execution after full-step classification', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const executeMainTool = vi.fn(
      async (input: ChatRuntimeMainToolExecutionInput): Promise<AIToolExecutionResult> => ({
        toolName: input.toolName,
        status: 'success',
        data: { input: input.input }
      })
    );
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createDirectPairStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool });

    const result = await executor({ runtime: createDelegateRuntime(), userMessage, assistantMessage }, async () => undefined);

    expect(executeMainTool).toHaveBeenCalledTimes(2);
    expect(result.shouldContinue).toBe(true);
    expect(assistantMessage.parts).toEqual([
      expect.objectContaining({ toolCallId: 'direct-call-1', status: 'done' }),
      expect.objectContaining({ toolCallId: 'direct-call-2', status: 'done' })
    ]);
  });

  it('runs the mandatory guard before invoking a main-process tool executor', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const executeMainTool = vi.fn();
    const guardToolCall = vi.fn(
      async (): Promise<AIToolExecutionResult | null> => ({
        toolName: 'read_file',
        status: 'failure',
        error: {
          code: 'PERMISSION_DENIED',
          message: 'Tool is outside the frozen Child plan'
        }
      })
    );
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainReadFileToolCallStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool, guardToolCall });

    await executor({ runtime: { ...runtime }, userMessage, assistantMessage }, async () => undefined);

    expect(guardToolCall).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ runtimeId: runtime.runtimeId }),
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      input: { path: 'secret.md' },
      source: 'main'
    });
    expect(executeMainTool).not.toHaveBeenCalled();
    expect(assistantMessage.parts).toContainEqual(
      expect.objectContaining({
        type: 'tool',
        status: 'done',
        result: expect.objectContaining({
          status: 'failure',
          error: expect.objectContaining({ code: 'PERMISSION_DENIED' })
        })
      })
    );
  });

  it('lets the mandatory guard reject a Provider-supplied tool result before it is accepted', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const executeMainTool = vi.fn();
    const guardToolCall = vi.fn(
      async (): Promise<AIToolExecutionResult | null> => ({
        toolName: 'read_file',
        status: 'failure',
        error: {
          code: 'protocol_error',
          message: 'Provider tool results are forbidden for Child runtimes'
        }
      })
    );
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool, guardToolCall });

    await executor({ runtime: { ...runtime }, userMessage, assistantMessage }, async () => undefined);

    expect(guardToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tool-call-1',
        toolName: 'read_file',
        source: 'provider'
      })
    );
    expect(executeMainTool).not.toHaveBeenCalled();
    expect(assistantMessage.parts).toContainEqual(
      expect.objectContaining({
        toolCallId: 'tool-call-1',
        status: 'done',
        result: expect.objectContaining({
          status: 'failure',
          error: expect.objectContaining({ code: 'protocol_error' })
        })
      })
    );
    expect(JSON.stringify(assistantMessage.parts)).not.toContain('export const ok = true');
  });

  it.each([
    ['deferred start-only with complete direct', true],
    ['direct start-only with complete deferred', false]
  ])('rejects incomplete mixed definitions before side effects: %s', async (_label: string, deferredStartOnly: boolean): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const executeMainTool = vi.fn();
    const executeRendererTool = vi.fn();
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createStartOnlyStream(deferredStartOnly) }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool, executeRendererTool });

    const result = await executor({ runtime: createDelegateRuntime(), userMessage, assistantMessage }, async () => undefined);

    expect(executeMainTool).not.toHaveBeenCalled();
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result.suspension).toBeUndefined();
    expect(assistantMessage.parts).toHaveLength(2);
    expect(assistantMessage.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: 'start-only-call',
          status: 'done',
          result: expect.objectContaining({ error: expect.objectContaining({ code: 'protocol_error' }) })
        }),
        expect.objectContaining({
          toolCallId: 'complete-call',
          status: 'done',
          result: expect.objectContaining({ error: expect.objectContaining({ code: 'protocol_error' }) })
        })
      ])
    );
  });

  it('scrubs incomplete deferred input before persisting its protocol error', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const persistedUpdates: ChatMessageRecord[] = [];
    const executeMainTool = vi.fn();
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createIncompleteDelegateStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool });

    await executor({ runtime: createDelegateRuntime(), userMessage, assistantMessage }, async (message) => {
      persistedUpdates.push(structuredClone(message));
    });

    expect(executeMainTool).not.toHaveBeenCalled();
    expect(JSON.stringify(persistedUpdates)).not.toContain('incomplete-contract-secret');
    expect(JSON.stringify(persistedUpdates)).not.toContain('incomplete-provider-secret');
    expect(persistedUpdates.at(-1)?.parts).toEqual([
      expect.objectContaining({
        toolCallId: 'delegate-call-1',
        toolName: 'delegate_task',
        status: 'done',
        input: null,
        result: expect.objectContaining({ error: expect.objectContaining({ code: 'protocol_error' }) })
      })
    ]);
    expect(persistedUpdates.at(-1)?.parts[0]).not.toHaveProperty('inputText');
    expect(persistedUpdates.at(-1)?.parts[0]).not.toHaveProperty('providerMetadata');
  });

  it.each([
    ['name conflict', 'read_file', 'write_file'],
    ['execution class conflict', 'read_file', 'delegate_task']
  ])('rejects a reused toolCallId with a %s', async (_label: string, startName: string, callName: string): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const executeMainTool = vi.fn();
    const executeRendererTool = vi.fn();
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createConflictStream(startName, callName) }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool, executeRendererTool });

    const result = await executor({ runtime: createDelegateRuntime(), userMessage, assistantMessage }, async () => undefined);

    expect(executeMainTool).not.toHaveBeenCalled();
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result.suspension).toBeUndefined();
    expect(assistantMessage.parts).toEqual([
      expect.objectContaining({
        toolCallId: 'conflict-call',
        status: 'done',
        result: expect.objectContaining({ error: expect.objectContaining({ code: 'protocol_error' }) })
      })
    ]);
  });

  it('rejects duplicate completed tool-call IDs before execution', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const executeMainTool = vi.fn();
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createDuplicateCallStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool });

    const result = await executor({ runtime: createDelegateRuntime(), userMessage, assistantMessage }, async () => undefined);

    expect(executeMainTool).not.toHaveBeenCalled();
    expect(result.suspension).toBeUndefined();
    expect(assistantMessage.parts).toEqual([
      expect.objectContaining({
        toolCallId: 'duplicate-call',
        status: 'done',
        result: expect.objectContaining({ error: expect.objectContaining({ code: 'protocol_error' }) })
      })
    ]);
  });

  it.each([
    ['result before finish', false],
    ['finish before result', true]
  ])('reads deferred definitions after a stopping Provider result: %s', async (_label: string, finishBeforeResult: boolean): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const executeMainTool = vi.fn();
    const executeRendererTool = vi.fn();
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createLateDeferredStream(finishBeforeResult) }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool, executeRendererTool });

    const result = await executor({ runtime: createDelegateRuntime(), userMessage, assistantMessage }, async () => undefined);

    expect(executeMainTool).not.toHaveBeenCalled();
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result.suspension).toBeUndefined();
    expect(assistantMessage.parts).toHaveLength(2);
    expect(assistantMessage.parts.every((part): boolean => part.type === 'tool' && part.result?.error?.code === 'protocol_error')).toBe(true);
  });

  it('does not execute a pure-direct call after a stopping Provider result', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const executeMainTool = vi.fn();
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createStoppedDirectStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool });

    await executor({ runtime: { ...runtime }, userMessage, assistantMessage }, async () => undefined);

    expect(executeMainTool).not.toHaveBeenCalled();
    expect(assistantMessage.parts).toEqual([
      expect.objectContaining({
        toolCallId: 'direct-call-1',
        result: expect.objectContaining({ status: 'awaiting_user_input' })
      })
    ]);
  });

  it.each<[string, 'error' | 'abort']>([
    ['late error', 'error'],
    ['late abort', 'abort']
  ])(
    'keeps a pure-direct stopping result authoritative over post-stop content and %s',
    async (_label: string, terminalType: 'error' | 'abort'): Promise<void> => {
      const assistantMessage = createAssistantMessage();
      const persistedUpdates: ChatMessageRecord[] = [];
      const executeMainTool = vi.fn();
      const resolve = vi.fn().mockResolvedValue({
        createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
        modelId: 'gpt-test'
      });
      const streamText = vi.fn().mockResolvedValue([undefined, { stream: createPostStopNoiseStream(terminalType, false) }]);
      const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool });

      const result = await executor({ runtime: { ...runtime }, userMessage, assistantMessage }, async (message) => {
        persistedUpdates.push(structuredClone(message));
      });

      expect(result.suspension).toBeUndefined();
      expect(executeMainTool).not.toHaveBeenCalled();
      expect(assistantMessage.content).toBe('');
      expect(assistantMessage.thinking).toBeUndefined();
      expect(JSON.stringify(persistedUpdates)).not.toContain('post-stop-text-secret');
      expect(JSON.stringify(persistedUpdates)).not.toContain('post-stop-reasoning-secret');
      expect(assistantMessage.parts).toEqual([
        expect.objectContaining({
          toolCallId: 'direct-call-1',
          status: 'done',
          result: expect.objectContaining({ status: 'cancelled' })
        })
      ]);
    }
  );

  it('prioritizes a late deferred definition over post-stop content and errors', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const persistedUpdates: ChatMessageRecord[] = [];
    const executeMainTool = vi.fn();
    const executeRendererTool = vi.fn();
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createPostStopNoiseStream('error', true) }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool, executeRendererTool });

    const result = await executor({ runtime: createDelegateRuntime(), userMessage, assistantMessage }, async (message) => {
      persistedUpdates.push(structuredClone(message));
    });

    expect(result.suspension).toBeUndefined();
    expect(executeMainTool).not.toHaveBeenCalled();
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(JSON.stringify(persistedUpdates)).not.toContain('post-stop-text-secret');
    expect(JSON.stringify(persistedUpdates)).not.toContain('post-stop-reasoning-secret');
    expect(assistantMessage.parts).toHaveLength(2);
    expect(assistantMessage.parts.every((part): boolean => part.type === 'tool' && part.result?.error?.code === 'protocol_error')).toBe(true);
  });

  it('streams model chunks into the assistant message and returns usage', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createTextStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText });
    const model = { providerId: 'provider-1', modelId: 'model-2' };

    const result = await executor({ runtime: { ...runtime, model }, userMessage, assistantMessage }, async (message) => {
      updates.push({ ...message, parts: [...message.parts] });
    });

    expect(resolve).toHaveBeenCalledWith(model);
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'openai' }),
      expect.objectContaining({
        requestId: 'runtime-1',
        modelId: 'gpt-test',
        messages: [{ role: 'user', content: 'hello' }]
      }),
      RUNTIME_CALL_OPTIONS
    );
    expect(result).toEqual({
      stepUsage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      totalUsage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 }
    });
    expect(updates.at(-1)).toMatchObject({
      content: 'Hello runtime',
      parts: [
        { type: 'thinking', thinking: 'thinking' },
        { type: 'text', text: 'Hello runtime' }
      ],
      loading: false,
      finished: true,
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 }
    });
  });

  it('uses provided source messages as the model context', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createTextStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText });

    await executor(
      {
        runtime,
        userMessage,
        assistantMessage,
        sourceMessages: [
          {
            ...userMessage,
            id: 'prior-user',
            content: 'prior question',
            parts: [{ id: 'part0124', type: 'text', text: 'prior question' }]
          },
          {
            ...assistantMessage,
            id: 'prior-assistant',
            content: 'prior answer',
            parts: [{ id: 'part0125', type: 'text', text: 'prior answer' }],
            loading: false,
            finished: true
          },
          userMessage,
          assistantMessage
        ]
      },
      async () => undefined
    );

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'openai' }),
      expect.objectContaining({
        messages: [
          { role: 'user', content: 'prior question' },
          { role: 'assistant', content: [{ type: 'text', text: 'prior answer' }] },
          { role: 'user', content: 'hello' }
        ]
      }),
      RUNTIME_CALL_OPTIONS
    );
  });

  it('uses the model resolution frozen at the request boundary', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const resolve = vi.fn().mockResolvedValue({
      createOptions: { providerId: 'provider-new', providerName: 'New', providerType: 'openai' },
      modelId: 'model-new'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createTextStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText });
    const frozenRuntime: ActiveChatRuntime = {
      ...runtime,
      resolvedModel: {
        createOptions: { providerId: 'provider-frozen', providerName: 'Frozen', providerType: 'anthropic' },
        modelId: 'model-frozen'
      }
    };

    await executor({ runtime: frozenRuntime, userMessage, assistantMessage }, async () => undefined);

    expect(resolve).not.toHaveBeenCalled();
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'provider-frozen' }),
      expect.objectContaining({ modelId: 'model-frozen' }),
      RUNTIME_CALL_OPTIONS
    );
  });

  it('streams tool chunks into assistant tool parts', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText });

    const result = await executor({ runtime, userMessage, assistantMessage }, async (message) => {
      updates.push({ ...message, parts: [...message.parts] });
    });

    expect(result).toEqual({ totalUsage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 }, shouldContinue: true });
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'read_file',
          status: 'done',
          inputText: '{"path":"src/index.ts"}',
          input: { path: 'src/index.ts' },
          result: { toolName: 'read_file', status: 'success', data: { content: 'export const ok = true;' } }
        }
      ],
      loading: false,
      finished: false
    });
  });

  it('passes runtime tool and context request options to streamText', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createTextStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText });

    await executor(
      {
        runtime: {
          ...runtime,
          system: 'Remember project preferences.',
          tavily: { enabled: true, apiKey: 'tvly-test' },
          mcp: {
            servers: [],
            enabledServerIds: [],
            enabledTools: [],
            toolInstructions: 'Use MCP tools carefully.'
          },
          tools: [{ name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async () => undefined
    );

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'openai' }),
      expect.objectContaining({
        system: 'Remember project preferences.',
        tavily: { enabled: true, apiKey: 'tvly-test' },
        mcp: {
          servers: [],
          enabledServerIds: [],
          enabledTools: [],
          toolInstructions: 'Use MCP tools carefully.'
        },
        tools: [{ name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: {} } }]
      }),
      RUNTIME_CALL_OPTIONS
    );
  });

  it('executes renderer-managed tool calls and asks runtime to continue', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'renderer_echo',
      status: 'success',
      data: { value: 'pong' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createRendererToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'renderer_echo', description: 'Renderer echo', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(executeRendererTool).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ runtimeId: 'runtime-1', tools: expect.arrayContaining([expect.objectContaining({ name: 'renderer_echo' })]) }),
      toolCallId: 'tool-call-1',
      toolName: 'renderer_echo',
      input: { value: 'ping' }
    });
    expect(result).toEqual({ totalUsage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 }, shouldContinue: true });
    expect(updates.at(-1)).toMatchObject({
      finished: false,
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'renderer_echo',
          status: 'done',
          input: { value: 'ping' },
          result: { toolName: 'renderer_echo', status: 'success', data: { value: 'pong' } }
        }
      ]
    });
  });

  it('does not continue after the provider finishes with stop', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'renderer_echo',
      status: 'success',
      data: { value: 'pong' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai-compatible',
        providerName: 'OpenAI Compatible',
        providerType: 'openai-compatible',
        apiKey: 'sk-test',
        baseUrl: 'https://example.com/v1'
      },
      modelId: 'compatible-model'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createRendererToolStopFinishStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'renderer_echo', description: 'Renderer echo', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async () => undefined
    );

    expect(result).toEqual({ totalUsage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 } });
  });

  it('executes read_current_document through the main-process tool executor', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const executeMainTool = vi.fn().mockResolvedValue({
      toolName: 'read_current_document',
      status: 'success',
      data: { id: 'doc-1', title: 'index.md', path: '/tmp/index.md', content: '# Hello' }
    });
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'read_current_document',
      status: 'failure',
      error: { code: 'EXECUTION_FAILED', message: 'renderer should not run' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainBridgeToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool, executeMainTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'read_current_document', description: 'Read current document', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(executeMainTool).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ runtimeId: 'runtime-1', tools: expect.arrayContaining([expect.objectContaining({ name: 'read_current_document' })]) }),
      toolCallId: 'tool-call-1',
      toolName: 'read_current_document',
      input: {}
    });
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result).toEqual({ totalUsage: { inputTokens: 6, outputTokens: 4, totalTokens: 10 }, shouldContinue: true });
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'read_current_document',
          status: 'done',
          input: {},
          result: {
            toolName: 'read_current_document',
            status: 'success',
            data: { id: 'doc-1', title: 'index.md', path: '/tmp/index.md', content: '# Hello' }
          }
        }
      ]
    });
  });

  it('does not continue tool rounds after a main-process tool is cancelled', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const executeMainTool = vi.fn().mockResolvedValue({
      toolName: 'read_file',
      status: 'cancelled',
      error: { code: 'USER_CANCELLED', message: '用户取消了工具调用' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainReadFileToolCallStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(result).toEqual({});
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'read_file',
          status: 'done',
          result: {
            toolName: 'read_file',
            status: 'cancelled',
            error: { code: 'USER_CANCELLED', message: '用户取消了工具调用' }
          }
        }
      ]
    });
  });

  it('keeps assistant message unfinished while waiting for a question tool answer', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'question',
      status: 'awaiting_user_input',
      data: {
        questionId: 'question-1',
        toolCallId: 'tool-call-question',
        question: '确认下单生椰拿铁，实付 9.9?',
        mode: 'single',
        options: [
          { label: '确认下单!', value: 'confirm' },
          { label: '再想想...', value: 'cancel' }
        ]
      }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createQuestionToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'question', description: 'Ask user', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(result).toEqual({});
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-question',
          toolName: 'question',
          status: 'done',
          result: {
            toolName: 'question',
            status: 'awaiting_user_input',
            data: expect.objectContaining({ questionId: 'question-1' })
          }
        }
      ],
      loading: true,
      finished: false
    });
  });

  it('executes renderer question tools after AI SDK 7 incremental input chunks', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'question',
      status: 'awaiting_user_input',
      data: {
        questionId: 'question-1',
        toolCallId: 'tool-call-question',
        question: '确认下单生椰拿铁，实付 9.9?',
        mode: 'single',
        options: [{ label: '确认下单!', value: 'confirm' }]
      }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createQuestionInputStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'question', description: 'Ask user', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push(cloneDeep(message));
      }
    );

    expect(result).toEqual({});
    expect(updates).toContainEqual(
      expect.objectContaining({
        parts: [
          expect.objectContaining({
            type: 'tool',
            toolCallId: 'tool-call-question',
            toolName: 'question',
            status: 'executing',
            inputText: '{"question":"确认下单生椰拿铁，实付 9.9?","mode":"single","options":[{"label":"确认下单!","value":"confirm"}]}'
          })
        ]
      })
    );
    expect(executeRendererTool).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ runtimeId: 'runtime-1' }),
      toolCallId: 'tool-call-question',
      toolName: 'question',
      input: {
        question: '确认下单生椰拿铁，实付 9.9?',
        mode: 'single',
        options: [{ label: '确认下单!', value: 'confirm' }]
      }
    });
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-question',
          toolName: 'question',
          status: 'done',
          result: {
            toolName: 'question',
            status: 'awaiting_user_input',
            data: expect.objectContaining({ questionId: 'question-1' })
          }
        }
      ],
      loading: true,
      finished: false
    });
  });

  it('stops consuming same-stream tool calls after a main-process tool is cancelled', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const executeMainTool = vi.fn().mockResolvedValue({
      toolName: 'read_file',
      status: 'cancelled',
      error: { code: 'USER_CANCELLED', message: '用户取消了工具调用' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createTwoMainToolCallStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [
            { name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: {} } },
            { name: 'run_shell_command', description: 'Run shell command', parameters: { type: 'object', properties: {} } }
          ]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(result).toEqual({});
    expect(executeMainTool).toHaveBeenCalledTimes(1);
    expect(executeMainTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tool-call-1',
        toolName: 'read_file'
      })
    );
    expect(updates.at(-1)?.parts).toHaveLength(1);
    expect(updates.at(-1)?.parts[0]).toMatchObject({
      type: 'tool',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      result: {
        toolName: 'read_file',
        status: 'cancelled',
        error: { code: 'USER_CANCELLED', message: '用户取消了工具调用' }
      }
    });
  });

  it('executes read_current_webpage through the main-process tool executor', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const webpageSnapshot = {
      url: 'https://example.com',
      title: 'Example',
      text: 'Example Domain',
      selectedText: '',
      headings: [],
      links: [],
      capturedAt: 1,
      truncated: { text: false, headings: false, links: false, selectedText: false }
    };
    const executeMainTool = vi.fn().mockResolvedValue({
      toolName: 'read_current_webpage',
      status: 'success',
      data: webpageSnapshot
    });
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'read_current_webpage',
      status: 'failure',
      error: { code: 'EXECUTION_FAILED', message: 'renderer should not run' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainWebpageToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool, executeMainTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'read_current_webpage', description: 'Read current webpage', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(executeMainTool).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ runtimeId: 'runtime-1', tools: expect.arrayContaining([expect.objectContaining({ name: 'read_current_webpage' })]) }),
      toolCallId: 'tool-call-1',
      toolName: 'read_current_webpage',
      input: {}
    });
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result).toEqual({ totalUsage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 }, shouldContinue: true });
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'read_current_webpage',
          status: 'done',
          input: {},
          result: {
            toolName: 'read_current_webpage',
            status: 'success',
            data: webpageSnapshot
          }
        }
      ]
    });
  });

  it('executes get_current_time through the main-process tool executor', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const executeMainTool = vi.fn().mockResolvedValue({
      toolName: 'get_current_time',
      status: 'success',
      data: { iso: '2026-06-19T00:00:00.000Z', timestamp: 1781827200000, locale: '2026-06-19 08:00:00' }
    });
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'get_current_time',
      status: 'failure',
      error: { code: 'EXECUTION_FAILED', message: 'renderer should not run' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainTimeToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool, executeMainTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'get_current_time', description: 'Get current time', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(executeMainTool).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ runtimeId: 'runtime-1', tools: expect.arrayContaining([expect.objectContaining({ name: 'get_current_time' })]) }),
      toolCallId: 'tool-call-1',
      toolName: 'get_current_time',
      input: {}
    });
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result).toEqual({ totalUsage: { inputTokens: 5, outputTokens: 4, totalTokens: 9 }, shouldContinue: true });
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'get_current_time',
          status: 'done',
          input: {},
          result: {
            toolName: 'get_current_time',
            status: 'success',
            data: { iso: '2026-06-19T00:00:00.000Z', timestamp: 1781827200000, locale: '2026-06-19 08:00:00' }
          }
        }
      ]
    });
  });

  it('executes query_logs through the main-process tool executor', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const queryLogsResult = {
      items: [{ level: 'ERROR', scope: 'main', message: 'boom', timestamp: '2026-06-19 00:00:00.000' }],
      returnedCount: 1,
      appliedFilters: { level: 'ERROR', limit: 5, offset: 0, usedDefaultDate: true }
    };
    const executeMainTool = vi.fn().mockResolvedValue({
      toolName: 'query_logs',
      status: 'success',
      data: queryLogsResult
    });
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'query_logs',
      status: 'failure',
      error: { code: 'EXECUTION_FAILED', message: 'renderer should not run' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainQueryLogsToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool, executeMainTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'query_logs', description: 'Query logs', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(executeMainTool).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ runtimeId: 'runtime-1', tools: expect.arrayContaining([expect.objectContaining({ name: 'query_logs' })]) }),
      toolCallId: 'tool-call-1',
      toolName: 'query_logs',
      input: { level: 'ERROR', limit: 5 }
    });
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result).toEqual({ totalUsage: { inputTokens: 11, outputTokens: 4, totalTokens: 15 }, shouldContinue: true });
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'query_logs',
          status: 'done',
          input: { level: 'ERROR', limit: 5 },
          result: {
            toolName: 'query_logs',
            status: 'success',
            data: queryLogsResult
          }
        }
      ]
    });
  });

  it('executes read_file through the main-process tool executor', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const readFileResult = {
      path: '/workspace/src/index.ts',
      content: 'line 1\nline 2',
      totalLines: 3,
      readLines: 2,
      hasMore: true,
      nextOffset: 3
    };
    const executeMainTool = vi.fn().mockResolvedValue({
      toolName: 'read_file',
      status: 'success',
      data: readFileResult
    });
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'read_file',
      status: 'failure',
      error: { code: 'EXECUTION_FAILED', message: 'renderer should not run' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainReadFileToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool, executeMainTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          workspaceRoot: '/workspace',
          tools: [{ name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(executeMainTool).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ runtimeId: 'runtime-1', workspaceRoot: '/workspace' }),
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      input: { path: 'src/index.ts', offset: 1, limit: 2 }
    });
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result).toEqual({ totalUsage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 }, shouldContinue: true });
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'read_file',
          status: 'done',
          input: { path: 'src/index.ts', offset: 1, limit: 2 },
          result: {
            toolName: 'read_file',
            status: 'success',
            data: readFileResult
          }
        }
      ]
    });
  });

  it('executes read_directory through the main-process tool executor', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const readDirectoryResult = {
      path: '/workspace/src',
      entries: [{ name: 'index.ts', path: '/workspace/src/index.ts', type: 'file' }]
    };
    const executeMainTool = vi.fn().mockResolvedValue({
      toolName: 'read_directory',
      status: 'success',
      data: readDirectoryResult
    });
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'read_directory',
      status: 'failure',
      error: { code: 'EXECUTION_FAILED', message: 'renderer should not run' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainReadDirectoryToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool, executeMainTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          workspaceRoot: '/workspace',
          tools: [{ name: 'read_directory', description: 'Read directory', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(executeMainTool).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ runtimeId: 'runtime-1', workspaceRoot: '/workspace' }),
      toolCallId: 'tool-call-1',
      toolName: 'read_directory',
      input: { path: 'src' }
    });
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result).toEqual({ totalUsage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 }, shouldContinue: true });
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'read_directory',
          status: 'done',
          input: { path: 'src' },
          result: {
            toolName: 'read_directory',
            status: 'success',
            data: readDirectoryResult
          }
        }
      ]
    });
  });

  it('executes get_settings through the main-process tool executor', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const settingsResult = { settings: { theme: 'dark' } };
    const executeMainTool = vi.fn().mockResolvedValue({
      toolName: 'get_settings',
      status: 'success',
      data: settingsResult
    });
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'get_settings',
      status: 'failure',
      error: { code: 'EXECUTION_FAILED', message: 'renderer should not run' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainGetSettingsToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool, executeMainTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'get_settings', description: 'Get settings', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(executeMainTool).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ runtimeId: 'runtime-1' }),
      toolCallId: 'tool-call-1',
      toolName: 'get_settings',
      input: { keys: ['theme'] }
    });
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result).toEqual({ totalUsage: { inputTokens: 6, outputTokens: 4, totalTokens: 10 }, shouldContinue: true });
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'get_settings',
          status: 'done',
          input: { keys: ['theme'] },
          result: {
            toolName: 'get_settings',
            status: 'success',
            data: settingsResult
          }
        }
      ]
    });
  });

  it('executes get_mcp_settings through the main-process tool executor', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const mcpSettingsResult = {
      settings: {
        servers: [
          {
            id: 'mcp-1',
            name: 'Local MCP',
            enabled: true,
            transport: 'stdio',
            command: 'npx',
            args: ['server'],
            env: {},
            headers: {},
            toolAllowlist: [],
            connectTimeoutMs: 20000,
            toolCallTimeoutMs: 30000
          }
        ]
      }
    };
    const executeMainTool = vi.fn().mockResolvedValue({
      toolName: 'get_mcp_settings',
      status: 'success',
      data: mcpSettingsResult
    });
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'get_mcp_settings',
      status: 'failure',
      error: { code: 'EXECUTION_FAILED', message: 'renderer should not run' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainGetMcpSettingsToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool, executeMainTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'get_mcp_settings', description: 'Get MCP settings', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(executeMainTool).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ runtimeId: 'runtime-1' }),
      toolCallId: 'tool-call-1',
      toolName: 'get_mcp_settings',
      input: {}
    });
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result).toEqual({ totalUsage: { inputTokens: 7, outputTokens: 4, totalTokens: 11 }, shouldContinue: true });
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'get_mcp_settings',
          status: 'done',
          input: {},
          result: {
            toolName: 'get_mcp_settings',
            status: 'success',
            data: mcpSettingsResult
          }
        }
      ]
    });
  });

  it('executes add_mcp_server through the main-process tool executor', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const addMcpServerResult = {
      applied: true,
      server: {
        id: 'mcp-1',
        name: 'Local MCP',
        enabled: true,
        transport: 'stdio',
        command: 'npx',
        args: ['server'],
        env: {},
        headers: {},
        toolAllowlist: [],
        connectTimeoutMs: 20000,
        toolCallTimeoutMs: 30000
      }
    };
    const executeMainTool = vi.fn().mockResolvedValue({
      toolName: 'add_mcp_server',
      status: 'success',
      data: addMcpServerResult
    });
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'add_mcp_server',
      status: 'failure',
      error: { code: 'EXECUTION_FAILED', message: 'renderer should not run' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainAddMcpServerToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool, executeMainTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'add_mcp_server', description: 'Add MCP server', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(executeMainTool).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ runtimeId: 'runtime-1' }),
      toolCallId: 'tool-call-1',
      toolName: 'add_mcp_server',
      input: { name: 'Local MCP', command: 'npx', args: ['server'] }
    });
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result).toEqual({ totalUsage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 }, shouldContinue: true });
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'add_mcp_server',
          status: 'done',
          input: { name: 'Local MCP', command: 'npx', args: ['server'] },
          result: {
            toolName: 'add_mcp_server',
            status: 'success',
            data: addMcpServerResult
          }
        }
      ]
    });
  });

  it('executes update_mcp_server through the main-process tool executor', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const updateMcpServerResult = {
      applied: true,
      previousServer: { id: 'mcp-1', name: 'Local MCP', enabled: true },
      currentServer: { id: 'mcp-1', name: 'Local MCP', enabled: false }
    };
    const executeMainTool = vi.fn().mockResolvedValue({
      toolName: 'update_mcp_server',
      status: 'success',
      data: updateMcpServerResult
    });
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'update_mcp_server',
      status: 'failure',
      error: { code: 'EXECUTION_FAILED', message: 'renderer should not run' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainUpdateMcpServerToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool, executeMainTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'update_mcp_server', description: 'Update MCP server', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(executeMainTool).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ runtimeId: 'runtime-1' }),
      toolCallId: 'tool-call-1',
      toolName: 'update_mcp_server',
      input: { serverId: 'mcp-1', patch: { enabled: false } }
    });
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result).toEqual({ totalUsage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 }, shouldContinue: true });
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'update_mcp_server',
          status: 'done',
          input: { serverId: 'mcp-1', patch: { enabled: false } },
          result: {
            toolName: 'update_mcp_server',
            status: 'success',
            data: updateMcpServerResult
          }
        }
      ]
    });
  });

  it('executes remove_mcp_server through the main-process tool executor', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const removeMcpServerResult = {
      applied: true,
      removedServer: { id: 'mcp-1', name: 'Local MCP', enabled: true }
    };
    const executeMainTool = vi.fn().mockResolvedValue({
      toolName: 'remove_mcp_server',
      status: 'success',
      data: removeMcpServerResult
    });
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'remove_mcp_server',
      status: 'failure',
      error: { code: 'EXECUTION_FAILED', message: 'renderer should not run' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainRemoveMcpServerToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool, executeMainTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'remove_mcp_server', description: 'Remove MCP server', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(executeMainTool).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ runtimeId: 'runtime-1' }),
      toolCallId: 'tool-call-1',
      toolName: 'remove_mcp_server',
      input: { serverId: 'mcp-1' }
    });
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result).toEqual({ totalUsage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 }, shouldContinue: true });
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'remove_mcp_server',
          status: 'done',
          input: { serverId: 'mcp-1' },
          result: {
            toolName: 'remove_mcp_server',
            status: 'success',
            data: removeMcpServerResult
          }
        }
      ]
    });
  });

  it('executes refresh_mcp_discovery through the main-process tool executor', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const refreshMcpDiscoveryResult = {
      refreshed: true,
      result: { ok: true, serverId: 'mcp-1', tools: [], discoveredAt: 1781827200000 }
    };
    const executeMainTool = vi.fn().mockResolvedValue({
      toolName: 'refresh_mcp_discovery',
      status: 'success',
      data: refreshMcpDiscoveryResult
    });
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'refresh_mcp_discovery',
      status: 'failure',
      error: { code: 'EXECUTION_FAILED', message: 'renderer should not run' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainRefreshMcpDiscoveryToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool, executeMainTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'refresh_mcp_discovery', description: 'Refresh MCP discovery', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(executeMainTool).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ runtimeId: 'runtime-1' }),
      toolCallId: 'tool-call-1',
      toolName: 'refresh_mcp_discovery',
      input: { serverId: 'mcp-1' }
    });
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result).toEqual({ totalUsage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 }, shouldContinue: true });
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'refresh_mcp_discovery',
          status: 'done',
          input: { serverId: 'mcp-1' },
          result: {
            toolName: 'refresh_mcp_discovery',
            status: 'success',
            data: refreshMcpDiscoveryResult
          }
        }
      ]
    });
  });

  it('executes open_resource through the main-process tool executor', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const openResourceResult = { path: 'https://example.com', resourceType: 'webview', opened: true };
    const executeMainTool = vi.fn().mockResolvedValue({
      toolName: 'open_resource',
      status: 'success',
      data: openResourceResult
    });
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'open_resource',
      status: 'failure',
      error: { code: 'EXECUTION_FAILED', message: 'renderer should not run' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainOpenResourceToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool, executeMainTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'open_resource', description: 'Open resource', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(executeMainTool).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ runtimeId: 'runtime-1' }),
      toolCallId: 'tool-call-1',
      toolName: 'open_resource',
      input: { path: 'https://example.com' }
    });
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result).toEqual({ totalUsage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 }, shouldContinue: true });
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'open_resource',
          status: 'done',
          input: { path: 'https://example.com' },
          result: {
            toolName: 'open_resource',
            status: 'success',
            data: openResourceResult
          }
        }
      ]
    });
  });

  it('executes update_settings through the main-process tool executor', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const updateSettingsResult = { applied: true, key: 'theme', previousValue: 'light', currentValue: 'dark' };
    const executeMainTool = vi.fn().mockResolvedValue({
      toolName: 'update_settings',
      status: 'success',
      data: updateSettingsResult
    });
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'update_settings',
      status: 'failure',
      error: { code: 'EXECUTION_FAILED', message: 'renderer should not run' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainUpdateSettingsToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool, executeMainTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'update_settings', description: 'Update settings', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(executeMainTool).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ runtimeId: 'runtime-1' }),
      toolCallId: 'tool-call-1',
      toolName: 'update_settings',
      input: { key: 'theme', value: 'dark' }
    });
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result).toEqual({ totalUsage: { inputTokens: 7, outputTokens: 4, totalTokens: 11 }, shouldContinue: true });
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'update_settings',
          status: 'done',
          input: { key: 'theme', value: 'dark' },
          result: {
            toolName: 'update_settings',
            status: 'success',
            data: updateSettingsResult
          }
        }
      ]
    });
  });

  it('executes create_document through the main-process tool executor', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const createDocumentResult = { id: 'draft-1', title: 'Notes', path: 'unsaved://draft-1/Notes.md', content: '# Notes' };
    const executeMainTool = vi.fn().mockResolvedValue({
      toolName: 'create_document',
      status: 'success',
      data: createDocumentResult
    });
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'create_document',
      status: 'failure',
      error: { code: 'EXECUTION_FAILED', message: 'renderer should not run' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainCreateDocumentToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool, executeMainTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'create_document', description: 'Create document', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(executeMainTool).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ runtimeId: 'runtime-1' }),
      toolCallId: 'tool-call-1',
      toolName: 'create_document',
      input: { title: 'Notes', content: '# Notes', ext: 'md' }
    });
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result).toEqual({ totalUsage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 }, shouldContinue: true });
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'create_document',
          status: 'done',
          input: { title: 'Notes', content: '# Notes', ext: 'md' },
          result: {
            toolName: 'create_document',
            status: 'success',
            data: createDocumentResult
          }
        }
      ]
    });
  });

  it('executes write_file through the main-process tool executor', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const writeFileResult = { path: '/workspace/docs/report.md', content: '# Report', created: true };
    const executeMainTool = vi.fn().mockResolvedValue({
      toolName: 'write_file',
      status: 'success',
      data: writeFileResult
    });
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'write_file',
      status: 'failure',
      error: { code: 'EXECUTION_FAILED', message: 'renderer should not run' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainWriteFileToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool, executeMainTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          workspaceRoot: '/workspace',
          tools: [{ name: 'write_file', description: 'Write file', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(executeMainTool).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ runtimeId: 'runtime-1', workspaceRoot: '/workspace' }),
      toolCallId: 'tool-call-1',
      toolName: 'write_file',
      input: { path: 'docs/report.md', content: '# Report' }
    });
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result).toEqual({ totalUsage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 }, shouldContinue: true });
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'write_file',
          status: 'done',
          input: { path: 'docs/report.md', content: '# Report' },
          result: {
            toolName: 'write_file',
            status: 'success',
            data: writeFileResult
          }
        }
      ]
    });
  });

  it('executes edit_file through the main-process tool executor', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const editFileResult = { path: '/workspace/docs/report.md', content: 'new', replacedCount: 1 };
    const executeMainTool = vi.fn().mockResolvedValue({
      toolName: 'edit_file',
      status: 'success',
      data: editFileResult
    });
    const executeRendererTool = vi.fn().mockResolvedValue({
      toolName: 'edit_file',
      status: 'failure',
      error: { code: 'EXECUTION_FAILED', message: 'renderer should not run' }
    });
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainEditFileToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool, executeMainTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          workspaceRoot: '/workspace',
          tools: [{ name: 'edit_file', description: 'Edit file', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(executeMainTool).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ runtimeId: 'runtime-1', workspaceRoot: '/workspace' }),
      toolCallId: 'tool-call-1',
      toolName: 'edit_file',
      input: { path: 'docs/report.md', oldString: 'old', newString: 'new' }
    });
    expect(executeRendererTool).not.toHaveBeenCalled();
    expect(result).toEqual({ totalUsage: { inputTokens: 11, outputTokens: 4, totalTokens: 15 }, shouldContinue: true });
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'edit_file',
          status: 'done',
          input: { path: 'docs/report.md', oldString: 'old', newString: 'new' },
          result: {
            toolName: 'edit_file',
            status: 'success',
            data: editFileResult
          }
        }
      ]
    });
  });

  it('records renderer-managed tool failures and asks runtime to continue', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const executeRendererTool = vi.fn().mockRejectedValue(new Error('Renderer bridge unavailable'));
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createRendererToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'renderer_echo', description: 'Renderer echo', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(result).toEqual({ totalUsage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 }, shouldContinue: true });
    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'renderer_echo',
          status: 'done',
          result: {
            toolName: 'renderer_echo',
            status: 'failure',
            error: { code: 'EXECUTION_FAILED', message: 'Renderer bridge unavailable' }
          }
        }
      ]
    });
  });

  it('preserves stable renderer-managed tool error codes', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];
    const timeoutError = Object.assign(new Error('Renderer tool renderer_echo timed out after 5ms'), { code: 'TOOL_TIMEOUT' });
    const executeRendererTool = vi.fn().mockRejectedValue(timeoutError);
    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createRendererToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool });

    await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'renderer_echo', description: 'Renderer echo', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(updates.at(-1)).toMatchObject({
      parts: [
        {
          type: 'tool',
          toolCallId: 'tool-call-1',
          toolName: 'renderer_echo',
          status: 'done',
          result: {
            toolName: 'renderer_echo',
            status: 'failure',
            error: { code: 'TOOL_TIMEOUT', message: 'Renderer tool renderer_echo timed out after 5ms' }
          }
        }
      ]
    });
  });

  it('times out renderer-managed tool calls and records a tool timeout result', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const assistantMessage = createAssistantMessage();
      const updates: ChatMessageRecord[] = [];
      const executeRendererTool = vi.fn(
        () =>
          new Promise<never>(() => {
            // 保持 pending，用于验证 renderer 工具超时兜底。
          })
      );
      const resolve = vi.fn().mockResolvedValue({
        createOptions: {
          providerId: 'openai',
          providerName: 'OpenAI',
          providerType: 'openai',
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com/v1'
        },
        modelId: 'gpt-test'
      });
      const streamText = vi.fn().mockResolvedValue([undefined, { stream: createRendererToolStream() }]);
      const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeRendererTool, rendererToolTimeoutMs: 5 });

      const task = executor(
        {
          runtime: {
            ...runtime,
            tools: [{ name: 'renderer_echo', description: 'Renderer echo', parameters: { type: 'object', properties: {} } }]
          },
          userMessage,
          assistantMessage
        },
        async (message) => {
          updates.push({ ...message, parts: [...message.parts] });
        }
      );

      let settled = false;
      task
        .then(() => {
          settled = true;
        })
        .catch(() => undefined);
      await vi.advanceTimersByTimeAsync(5);
      await Promise.resolve();

      expect(settled).toBe(true);
      await expect(task).resolves.toEqual({
        totalUsage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 },
        shouldContinue: true
      });
      expect(updates.at(-1)).toMatchObject({
        parts: [
          {
            type: 'tool',
            toolCallId: 'tool-call-1',
            toolName: 'renderer_echo',
            status: 'done',
            result: {
              toolName: 'renderer_echo',
              status: 'failure',
              error: { code: 'TOOL_TIMEOUT', message: 'Renderer 工具 renderer_echo 执行超时，已等待 5ms' }
            }
          }
        ]
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out main-process tool calls within the task deadline', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const assistantMessage = createAssistantMessage();
      const updates: ChatMessageRecord[] = [];
      const executeMainTool = vi.fn(
        () =>
          new Promise<never>(() => {
            // 保持 pending，用于验证主进程工具超时兜底。
          })
      );
      const resolve = vi.fn().mockResolvedValue({
        createOptions: {
          providerId: 'openai',
          providerName: 'OpenAI',
          providerType: 'openai',
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com/v1'
        },
        modelId: 'gpt-test'
      });
      const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainReadFileToolCallStream() }]);
      const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool, rendererToolTimeoutMs: 5 });

      const task = executor({ runtime: { ...runtime }, userMessage, assistantMessage }, async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      });

      await vi.advanceTimersByTimeAsync(5);
      await expect(task).resolves.toEqual({
        totalUsage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 },
        shouldContinue: true
      });
      expect(updates.at(-1)).toMatchObject({
        parts: [
          {
            type: 'tool',
            toolCallId: 'tool-call-1',
            toolName: 'read_file',
            status: 'done',
            result: {
              toolName: 'read_file',
              status: 'failure',
              error: { code: 'TOOL_TIMEOUT', message: '主进程工具 read_file 执行超时，已等待 5ms' }
            }
          }
        ]
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauses main-process tool timeout while waiting for user confirmation', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const assistantMessage = createAssistantMessage();
      const updates: ChatMessageRecord[] = [];
      const writeFileResult = { path: '/workspace/docs/report.md', content: '# Report', created: true };
      let approveConfirmation: (() => void) | undefined;
      const executeMainTool = vi.fn(
        (input: ChatRuntimeMainToolExecutionInput) =>
          new Promise<AIToolExecutionResult>((resolve) => {
            input.timeoutControls?.pause();
            approveConfirmation = (): void => {
              input.timeoutControls?.resume();
              resolve({
                toolName: 'write_file',
                status: 'success',
                data: writeFileResult
              });
            };
          })
      );
      const resolve = vi.fn().mockResolvedValue({
        createOptions: {
          providerId: 'openai',
          providerName: 'OpenAI',
          providerType: 'openai',
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com/v1'
        },
        modelId: 'gpt-test'
      });
      const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMainWriteFileToolStream() }]);
      const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool, rendererToolTimeoutMs: 5 });

      const task = executor({ runtime: { ...runtime, workspaceRoot: '/workspace' }, userMessage, assistantMessage }, async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(executeMainTool).toHaveBeenCalledOnce();

      let settled = false;
      task
        .then(() => {
          settled = true;
        })
        .catch(() => undefined);
      await vi.advanceTimersByTimeAsync(10);
      await Promise.resolve();

      expect(settled).toBe(false);
      if (!approveConfirmation) throw new Error('确认回调未初始化');

      approveConfirmation();
      await expect(task).resolves.toEqual({
        totalUsage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
        shouldContinue: true
      });
      expect(updates.at(-1)).toMatchObject({
        parts: [
          {
            type: 'tool',
            toolCallId: 'tool-call-1',
            toolName: 'write_file',
            status: 'done',
            result: {
              toolName: 'write_file',
              status: 'success',
              data: writeFileResult
            }
          }
        ]
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns TOOL_NOT_FOUND failure for unregistered tool calls', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];

    async function* createUnknownToolStream(): AsyncGenerator<unknown> {
      yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'unknown_tool', input: {} };
      yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } };
    }

    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createUnknownToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText });

    const result = await executor({ runtime, userMessage, assistantMessage }, async (message) => {
      updates.push({ ...message, parts: [...message.parts] });
    });

    expect(result).toEqual({
      totalUsage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
      shouldContinue: true
    });
    expect(updates.at(-1)?.parts[0]).toMatchObject({
      type: 'tool',
      toolCallId: 'tool-call-1',
      toolName: 'unknown_tool',
      status: 'done',
      result: {
        toolName: 'unknown_tool',
        status: 'failure',
        error: {
          code: 'TOOL_NOT_FOUND',
          message: expect.stringContaining('unknown_tool')
        }
      }
    });
  });

  it('stops stream when earlier tool call is cancelled, even if later ones succeed', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];

    async function* createMixedToolStream(): AsyncGenerator<unknown> {
      yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'read_file', input: { path: 'a.md' } };
      yield { type: 'tool-call', toolCallId: 'tool-call-2', toolName: 'read_file', input: { path: 'b.md' } };
      yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 } };
    }

    const executeMainTool = vi
      .fn()
      .mockResolvedValueOnce({
        toolName: 'read_file',
        status: 'cancelled',
        error: { code: 'USER_CANCELLED', message: 'cancelled' }
      })
      .mockResolvedValueOnce({
        toolName: 'read_file',
        status: 'success',
        data: { content: 'b' }
      });

    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createMixedToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText, executeMainTool });

    const result = await executor(
      {
        runtime: {
          ...runtime,
          tools: [{ name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: {} } }]
        },
        userMessage,
        assistantMessage
      },
      async (message) => {
        updates.push({ ...message, parts: [...message.parts] });
      }
    );

    expect(executeMainTool).toHaveBeenCalledTimes(1);
    expect(result).toEqual({});
    expect(updates.at(-1)?.parts).toHaveLength(1);
  });

  it('does not reset parsed tool input to null on invalid JSON delta', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const updates: ChatMessageRecord[] = [];

    async function* createFlickerToolStream(): AsyncGenerator<unknown> {
      yield { type: 'tool-input-start', id: 'tool-call-1', toolName: 'read_file' };
      yield { type: 'tool-input-delta', id: 'tool-call-1', delta: '{"path":"src/index.ts"}' };
      yield { type: 'tool-input-delta', id: 'tool-call-1', delta: ',' };
      yield { type: 'tool-input-end', id: 'tool-call-1' };
      yield { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'read_file', input: { path: 'src/index.ts' } };
      yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 } };
    }

    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createFlickerToolStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText });

    await executor({ runtime, userMessage, assistantMessage }, async (message) => {
      updates.push({ ...message, parts: [...message.parts] });
    });

    const afterInvalidDelta = updates.find((message) => {
      const part = message.parts[0];
      return part?.type === 'tool' && part.inputText === '{"path":"src/index.ts"},';
    });
    expect(afterInvalidDelta).toBeDefined();
    expect(afterInvalidDelta?.parts[0]).toMatchObject({
      type: 'tool',
      input: { path: 'src/index.ts' }
    });
  });

  it('includes image files in model request when sourceMessages are empty', async (): Promise<void> => {
    const assistantMessage = createAssistantMessage();
    const imageUserMessage: ChatMessageRecord = {
      ...userMessage,
      content: 'describe this image',
      parts: [{ id: 'part0126', type: 'text', text: 'describe this image' }],
      files: [
        {
          id: 'file-1',
          type: 'image',
          name: 'test.png',
          url: 'https://example.com/test.png',
          mimeType: 'image/png'
        }
      ]
    };

    const resolve = vi.fn().mockResolvedValue({
      createOptions: {
        providerId: 'openai',
        providerName: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1'
      },
      modelId: 'gpt-test'
    });
    const streamText = vi.fn().mockResolvedValue([undefined, { stream: createTextStream() }]);
    const executor = createRuntimeStreamExecutor({ resolver: { resolve }, streamText });

    await executor({ runtime, userMessage: imageUserMessage, assistantMessage }, async () => undefined);

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'openai' }),
      expect.objectContaining({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'describe this image' },
              { type: 'file', data: new URL('https://example.com/test.png'), mediaType: 'image/png', filename: 'test.png' }
            ]
          }
        ]
      }),
      RUNTIME_CALL_OPTIONS
    );
  });
});
