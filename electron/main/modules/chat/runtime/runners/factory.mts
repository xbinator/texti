/**
 * @file factory.mts
 * @description ChatRuntime 活跃 runtime 状态创建工厂。
 */
import type { ActiveChatRuntime } from '../types.mjs';
import type { ChatRuntimeCompactInput, ChatRuntimeContinueInput, ChatRuntimeSendInput, ChatRuntimeSubmitUserChoiceInput } from 'types/chat-runtime';

/** 支持创建 ActiveChatRuntime 的请求输入。 */
type RuntimeFactoryInput = ChatRuntimeSendInput | ChatRuntimeContinueInput | ChatRuntimeCompactInput | ChatRuntimeSubmitUserChoiceInput;

/** ActiveChatRuntime 中由全部创建路径共享的基础状态。 */
type RuntimeBaseState = Pick<
  ActiveChatRuntime,
  | 'runtimeId'
  | 'sessionId'
  | 'turnId'
  | 'clientId'
  | 'agentId'
  | 'parentAgentId'
  | 'parentRuntimeId'
  | 'rootRuntimeId'
  | 'continuationOfRuntimeId'
  | 'model'
  | 'capabilities'
  | 'contextWindow'
  | 'system'
  | 'workspaceRoot'
  | 'tools'
  | 'skillContentHashes'
  | 'runtimeContext'
  | 'status'
  | 'abortController'
  | 'createdAt'
>;

/**
 * 创建全部 Runtime 路径共享的基础状态。
 * @param input - Runtime 请求输入
 * @param runtimeId - Runtime ID
 * @param sessionId - Session ID
 * @returns ActiveChatRuntime 基础状态
 */
function createRuntimeBase(input: RuntimeFactoryInput, runtimeId: string, sessionId: string): RuntimeBaseState {
  return {
    runtimeId,
    sessionId,
    turnId: input.turnId,
    clientId: input.clientId,
    agentId: input.agentId,
    parentAgentId: input.parentAgentId,
    parentRuntimeId: input.parentRuntimeId,
    rootRuntimeId: input.rootRuntimeId,
    continuationOfRuntimeId: input.continuationOfRuntimeId,
    model: input.model,
    capabilities: input.capabilities,
    contextWindow: input.contextWindow,
    system: input.system,
    workspaceRoot: input.workspaceRoot,
    tools: input.tools,
    skillContentHashes: input.skillContentHashes,
    runtimeContext: input.runtimeContext,
    status: 'running',
    abortController: new AbortController(),
    createdAt: Date.now()
  };
}

/**
 * 创建普通发送 runtime 状态。
 * @param input - 发送输入
 * @param runtimeId - runtime id
 * @param sessionId - 会话 ID
 * @returns runtime 状态
 */
export function createSendRuntime(input: ChatRuntimeSendInput, runtimeId: string, sessionId: string): ActiveChatRuntime {
  return {
    ...createRuntimeBase(input, runtimeId, sessionId),
    tavily: input.tavily,
    mcp: input.mcp,
    phase: 'streaming'
  };
}

/**
 * 创建续轮 runtime 状态。
 * @param input - 续轮输入
 * @param runtimeId - runtime id
 * @returns runtime 状态
 */
export function createContinuationRuntime(input: ChatRuntimeContinueInput, runtimeId: string): ActiveChatRuntime {
  return {
    ...createRuntimeBase(input, runtimeId, input.sessionId),
    tavily: input.tavily,
    mcp: input.mcp,
    phase: 'streaming'
  };
}

/**
 * 创建手动上下文压缩 runtime 状态。
 * @param input - 压缩输入
 * @param runtimeId - runtime id
 * @returns runtime 状态
 */
export function createCompactRuntime(input: ChatRuntimeCompactInput, runtimeId: string): ActiveChatRuntime {
  return {
    ...createRuntimeBase(input, runtimeId, input.sessionId),
    phase: 'compacting',
    compactionTrigger: 'manual'
  };
}

/**
 * 根据用户选择输入创建续轮 runtime 状态。
 * @param input - 用户选择提交输入
 * @param runtimeId - runtime id
 * @returns runtime 状态
 */
export function createUserChoiceRuntime(input: ChatRuntimeSubmitUserChoiceInput, runtimeId: string): ActiveChatRuntime {
  return {
    ...createRuntimeBase(input, runtimeId, input.sessionId),
    tavily: input.tavily,
    mcp: input.mcp,
    phase: 'streaming'
  };
}
