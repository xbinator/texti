/**
 * @file factory.mts
 * @description ChatRuntime 活跃 runtime 状态创建工厂。
 */
import type { ActiveChatRuntime, ChatRuntimePrimaryContinuationContext } from '../types.mjs';
import type { ChatRuntimeCompactInput, ChatRuntimeContinueInput, ChatRuntimeSendInput, ChatRuntimeSubmitUserChoiceInput } from 'types/chat-runtime';

/** 支持创建 ActiveChatRuntime 的请求输入。 */
type RuntimeFactoryInput = ChatRuntimeSendInput | ChatRuntimeContinueInput | ChatRuntimeCompactInput | ChatRuntimeSubmitUserChoiceInput;

/** 内部 Primary Runtime B 工厂输入；Renderer 不能提供模型、消息或工具覆盖。 */
export interface PrimaryContinuationFactoryInput {
  /** continuation fence owner。 */
  checkpointId: string;
  /** 新 Runtime B 身份。 */
  runtimeId: string;
  /** 原 Session。 */
  sessionId: string;
  /** 原 Turn。 */
  turnId: string;
  /** Primary Actor。 */
  primaryAgentId: string;
  /** Turn 根 Runtime。 */
  rootRuntimeId: string;
  /** 挂起的 Runtime A。 */
  sourceRuntimeId: string;
  /** 经 Agent service 完整性校验的易失上下文。 */
  context: ChatRuntimePrimaryContinuationContext;
}

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
 * 从 Checkpoint 与冻结易失上下文创建内部 Primary Runtime B。
 * 工厂固定 `tools=[]` 与 `forceFinal=true`，不存在 Renderer 覆盖入口。
 * @param input - 已 claim 的 Checkpoint lineage 与上下文
 * @returns 仅允许 fence owner 写入的 Active Runtime
 */
export function createPrimaryContinuationRuntime(input: PrimaryContinuationFactoryInput): ActiveChatRuntime {
  const { context } = input;
  return {
    runtimeId: input.runtimeId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    clientId: context.clientId,
    agentId: input.primaryAgentId,
    parentRuntimeId: input.sourceRuntimeId,
    rootRuntimeId: input.rootRuntimeId,
    continuationOfRuntimeId: input.sourceRuntimeId,
    model: structuredClone(context.modelSnapshot),
    ...(context.capabilities ? { capabilities: structuredClone(context.capabilities) } : {}),
    ...(context.contextWindow ? { contextWindow: context.contextWindow } : {}),
    ...(context.system ? { system: context.system } : {}),
    ...(context.workspaceRoot ? { workspaceRoot: context.workspaceRoot } : {}),
    tools: [],
    ...(context.skillContentHashes ? { skillContentHashes: structuredClone(context.skillContentHashes) } : {}),
    ...(context.runtimeContext ? { runtimeContext: structuredClone(context.runtimeContext) } : {}),
    ownerCheckpointId: input.checkpointId,
    forceFinal: true,
    status: 'running',
    phase: 'streaming',
    abortController: new AbortController(),
    createdAt: Date.now()
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
