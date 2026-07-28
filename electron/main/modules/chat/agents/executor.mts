/**
 * @file executor.mts
 * @description 在无聊天消息持久化、无 Session 锁和无 Renderer Bridge 的边界内执行只读或受控写入 Child Attempt。
 */
import * as fs from 'node:fs/promises';
import type { AgentAttemptRecord, AgentCheckpointRecord, AgentTaskRecord, RecordAgentToolCompletedInput, RecordAgentToolStartedInput } from './types.mjs';
import type { ChatModelResolver } from '../runtime/model/resolver.mjs';
import type { RuntimeStreamText } from '../runtime/stream/index.mjs';
import type { ActiveChatRuntime } from '../runtime/types.mjs';
import type { AIToolExecutionResult, AIUsage } from 'types/ai';
import type { ChatMessageRecord, ChatMessageToolPart } from 'types/chat';
import type {
  AgentChangesetSnapshot,
  AgentExecutionPlanSnapshot,
  AgentTaskError,
  AgentUsageAccounting,
  AgentWriteResultDraft,
  ChatAgentResult
} from 'types/chat-agent';
import { addRuntimeUsage } from '../runtime/context/usage.mjs';
import { createRuntimeStreamExecutor } from '../runtime/stream/index.mjs';
import { hashAgentPayload } from './contracts.mjs';
import { createChildReadTools } from './read-tools.mjs';
import { createChildWriteTools, type ChildWriteTools } from './write-tools.mjs';

/** Child Runtime 单次执行允许的最大模型调用数，防止无界工具续轮。 */
const CHILD_MODEL_CALL_LIMIT = 8;

/** Child 结果摘要最大字符数。 */
const CHILD_SUMMARY_LIMIT = 4_000;

/** Child Runtime 执行输入。 */
export interface ChildRuntimeInput {
  /** 已授权并进入 running 的 Task。 */
  readonly task: AgentTaskRecord;
  /** 与冻结计划绑定的当前 Attempt。 */
  readonly attempt: AgentAttemptRecord;
  /** 持有 Primary continuation 的 Checkpoint。 */
  readonly checkpoint: AgentCheckpointRecord;
  /** Coordinator 传入的 cooperative cancellation 信号。 */
  readonly signal: AbortSignal;
}

/** Child 模型执行结束后交给 Coordinator 的判别结果。 */
export type ChildExecutionOutcome =
  | {
      /** 已经可以直接汇合的终态结果。 */
      readonly kind: 'terminal';
      /** read、no-op write 或失败结果。 */
      readonly result: ChatAgentResult;
    }
  | {
      /** write Runtime 已结束，但外部提交仍需确认。 */
      readonly kind: 'changeset_prepared';
      /** overlay 生成的不可变 changeset。 */
      readonly changeset: AgentChangesetSnapshot;
      /** commit journal 最终结果所需的冻结草稿。 */
      readonly draft: AgentWriteResultDraft;
    };

/** executor 内部 outcome 与 retained overlay 所有权。 */
interface ChildRuntimeExecutionResult {
  /** 对外判别结果。 */
  readonly outcome: ChildExecutionOutcome;
  /** 仅 changeset preparation 成功时转交 Coordinator 的工具边界。 */
  readonly retainedTools?: ChildWriteTools;
}

/** 无消息持久化的 Child Runtime executor。 */
export interface ChildTaskRuntimeExecutor {
  /**
   * 执行一个冻结 read/write Attempt。
   * @param input - Task、Attempt、Checkpoint 和取消信号
   * @returns 直接终态或待确认 changeset
   */
  execute(input: ChildRuntimeInput): Promise<ChildExecutionOutcome>;
  /**
   * 请求一个活跃 Child Runtime cooperative cancellation。
   * @param runtimeId - 当前 Runtime 身份
   * @param reason - 稳定取消原因
   */
  abort(runtimeId: string, reason: string): void;
  /**
   * 在拒绝、提交完成或失败后精确回收已转交的 write overlay。
   * @param runtimeId - changeset 来源 Runtime
   */
  discard(runtimeId: string): Promise<void>;
}

/** Child executor 外部可信依赖。 */
export interface ChildExecutorDependencies {
  /** 冻结模型解析器。 */
  readonly resolver: ChatModelResolver;
  /** 复用的单轮 Runtime stream 调用边界。 */
  readonly streamText: RuntimeStreamText;
  /**
   * 从易失 continuation context 恢复冻结工作区。
   * @param checkpointId - Checkpoint 身份
   * @returns 工作区根目录，不可用时为 undefined
   */
  readonly resolveWorkspaceRoot: (checkpointId: string) => Promise<string | undefined> | string | undefined;
  /**
   * 解析 Main 私有 write overlay 根目录。
   * @param checkpointId - Checkpoint 身份
   * @returns 已存在私有目录，不可用时为 undefined
   */
  readonly resolveOverlayRoot: (checkpointId: string) => Promise<string | undefined> | string | undefined;
  /**
   * 创建 changeset 或 operation 身份。
   * @param kind - overlay 身份域
   * @returns 单一安全目录段
   */
  readonly createOverlayId: (kind: 'changeset' | 'operation') => string;
  /**
   * 使用可信价格表计算 Task 成本。
   * @param pricingVersion - 冻结定价版本
   * @param model - 冻结模型身份
   * @param usage - Provider 实际 token usage
   * @returns 可信成本或显式 unknown
   */
  readonly calculateCost: (pricingVersion: string, model: AgentExecutionPlanSnapshot['modelSnapshot'], usage: AIUsage) => AgentUsageAccounting['monetaryCost'];
  /**
   * 在工具副作用前持久化裁剪后的开始 Event。
   * @param input - Task、Attempt、Runtime 与工具身份
   */
  readonly recordToolStarted: (input: RecordAgentToolStartedInput) => void;
  /**
   * 在规范化结果后持久化裁剪后的完成 Event。
   * @param input - 工具身份与 canonical 结果 hash
   */
  readonly recordToolCompleted: (input: RecordAgentToolCompletedInput) => void;
  /**
   * 读取单调执行时钟。
   * @returns 毫秒时间戳
   */
  readonly now: () => number;
}

/** Child Runtime 内部累计状态。 */
interface ChildExecutionState {
  /** Provider token usage。 */
  usage?: AIUsage;
  /** 已启动模型调用次数。 */
  modelCalls: number;
  /** 含工具调用的模型轮次数。 */
  toolRounds: number;
  /** executor 起始时刻。 */
  startedAt: number;
}

/** 单个工具失败的安全投影。 */
interface ChildToolFailure {
  /** 工具名称。 */
  readonly toolName: string;
  /** 工具结果状态。 */
  readonly status: 'failure' | 'cancelled' | 'awaiting_user_input';
  /** 可选稳定工具错误码。 */
  readonly errorCode?: string;
}

/**
 * 创建零值 AI usage。
 * @returns 零 token 使用量
 */
function createZeroUsage(): AIUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

/**
 * 截断并规整 Primary 可见摘要。
 * @param summary - 模型输出或失败说明
 * @param fallback - 空输出时的稳定兜底
 * @returns 紧凑结果摘要
 */
function normalizeSummary(summary: string, fallback: string): string {
  const normalized = summary.trim() || fallback;
  return normalized.length <= CHILD_SUMMARY_LIMIT ? normalized : `${normalized.slice(0, CHILD_SUMMARY_LIMIT - 3)}...`;
}

/**
 * 为全部验收标准创建不受 Child 自证影响的结果。
 * @param task - 不可变 Task 契约
 * @param claimStatus - Child 声明状态
 * @param summary - Child 紧凑摘要
 * @returns 与 acceptanceCriteria 精确对齐的结果
 */
function createCriteria(
  task: AgentTaskRecord,
  claimStatus: ChatAgentResult['completion']['criteria'][number]['claim']['status'],
  summary: string
): ChatAgentResult['completion']['criteria'] {
  return task.contractSnapshot.acceptanceCriteria.map((_criterion, criterionIndex) => ({
    criterionIndex,
    claim: {
      status: claimStatus,
      summary,
      evidence: []
    },
    verification: {
      status: 'unverified',
      verifier: 'policy',
      evidence: []
    }
  }));
}

/**
 * 生成本次 Attempt 的实际资源记账。
 * @param dependencies - 成本计算与时钟依赖
 * @param plan - 冻结计划
 * @param state - Runtime 累计状态
 * @returns 真实 token、轮次、耗时和可信成本
 */
function createUsage(dependencies: ChildExecutorDependencies, plan: AgentExecutionPlanSnapshot, state: ChildExecutionState): AgentUsageAccounting {
  const usage = state.usage ?? createZeroUsage();
  const monetaryCost: AgentUsageAccounting['monetaryCost'] =
    plan.budget.pricingVersion === 'unknown'
      ? {
          currency: 'unknown',
          pricingVersion: 'unknown',
          estimated: 'unknown',
          actual: 'unknown'
        }
      : dependencies.calculateCost(plan.budget.pricingVersion, plan.modelSnapshot, usage);
  return {
    ...usage,
    modelCalls: state.modelCalls,
    toolRounds: state.toolRounds,
    queueDurationMs: 0,
    executionDurationMs: Math.max(0, Math.floor(dependencies.now() - state.startedAt)),
    externalRequests: 0,
    monetaryCost
  };
}

/**
 * 创建一个 Child 终态结果。
 * @param dependencies - 记账依赖
 * @param input - Task 和 Attempt 身份
 * @param plan - 冻结计划
 * @param state - 累计执行状态
 * @param executionStatus - 机器终态
 * @param summary - Primary 可见摘要
 * @param error - 可选结构化错误
 * @returns 完整 ChatAgentResult
 */
function createResult(
  dependencies: ChildExecutorDependencies,
  input: ChildRuntimeInput,
  plan: AgentExecutionPlanSnapshot,
  state: ChildExecutionState,
  executionStatus: ChatAgentResult['executionStatus'],
  summary: string,
  error?: AgentTaskError
): ChatAgentResult {
  const completed = executionStatus === 'completed';
  const normalizedSummary = normalizeSummary(summary, completed ? 'Child task completed without a textual summary.' : 'Child task failed.');
  return {
    taskId: input.task.taskId,
    agentId: input.task.agentId,
    attemptId: input.attempt.attemptId,
    executionStatus,
    completion: {
      level: 'none',
      criteria: createCriteria(input.task, completed ? 'satisfied' : 'unknown', normalizedSummary)
    },
    summary: normalizedSummary,
    warnings: [],
    artifacts: [],
    usage: createUsage(dependencies, plan, state),
    ...(error ? { error } : {})
  };
}

/**
 * 把直接终态结果包装为 executor 判别结果。
 * @param result - 完整 Child 结果
 * @returns terminal outcome
 */
function createTerminal(result: ChatAgentResult): ChildExecutionOutcome {
  return { kind: 'terminal', result };
}

/**
 * 回收未转交 Coordinator 的 write overlay 后返回 terminal outcome。
 * @param writeTools - 可选 write 工具边界
 * @param outcome - 已构造终态
 * @returns 清理后的内部结果
 */
async function disposeRuntimeTools(writeTools: ChildWriteTools | undefined, outcome: ChildExecutionOutcome): Promise<ChildRuntimeExecutionResult> {
  if (writeTools) await writeTools.dispose();
  return { outcome };
}

/**
 * 从 write Runtime 输出生成 commit 前冻结草稿。
 * @param dependencies - 记账依赖
 * @param input - 当前 Task 与 Attempt
 * @param plan - 冻结计划
 * @param state - 累计 usage
 * @param summary - 模型最终文本
 * @returns criteria 均保持 unverified 的写入结果草稿
 */
function createWriteDraft(
  dependencies: ChildExecutorDependencies,
  input: ChildRuntimeInput,
  plan: AgentExecutionPlanSnapshot,
  state: ChildExecutionState,
  summary: string
): AgentWriteResultDraft {
  const normalizedSummary = normalizeSummary(summary, 'Child prepared a controlled changeset.');
  return {
    taskId: input.task.taskId,
    agentId: input.task.agentId,
    attemptId: input.attempt.attemptId,
    summary: normalizedSummary,
    criteria: createCriteria(input.task, 'satisfied', normalizedSummary),
    warnings: [],
    usage: createUsage(dependencies, plan, state)
  };
}

/**
 * 创建 Runtime 阶段结构化错误。
 * @param code - 稳定错误码
 * @param category - 错误类别
 * @param reason - 稳定机器原因
 * @param runtimeId - Runtime 身份
 * @param toolName - 可选工具名称
 * @returns Agent 错误
 */
function createRuntimeError(
  code: AgentTaskError['code'],
  category: AgentTaskError['category'],
  reason: string,
  runtimeId: string,
  toolName?: string
): AgentTaskError {
  return {
    code,
    phase: 'runtime',
    category,
    retryable: false,
    message: 'Child Runtime execution did not complete normally.',
    details: {
      reason,
      runtimeId,
      ...(toolName ? { toolName } : {})
    }
  };
}

/**
 * 校验 Task、Attempt 与 Checkpoint 的聚合身份和冻结 hash。
 * @param input - Child 执行输入
 * @returns 稳定失败原因或 null
 */
function validateRuntimeInput(input: ChildRuntimeInput): string | null {
  const plan = input.task.executionPlanSnapshot;
  if (!plan || !input.task.executionPlanSnapshotHash) return 'execution_plan_missing';
  if (
    input.task.recordState !== 'active' ||
    input.checkpoint.recordState !== 'active' ||
    input.task.status !== 'running' ||
    (input.attempt.status !== 'starting' && input.attempt.status !== 'running') ||
    input.checkpoint.status !== 'waiting_children'
  ) {
    return 'aggregate_state_invalid';
  }
  if (
    input.task.taskId !== input.attempt.taskId ||
    input.task.checkpointId !== input.checkpoint.checkpointId ||
    input.task.sessionId !== input.checkpoint.sessionId ||
    input.task.turnId !== input.checkpoint.turnId ||
    input.task.rootRuntimeId !== input.checkpoint.rootRuntimeId ||
    input.task.currentAttemptId !== input.attempt.attemptId
  ) {
    return 'aggregate_identity_invalid';
  }
  if (
    plan.planHash !== input.task.executionPlanSnapshotHash ||
    plan.planHash !== input.attempt.planHash ||
    input.attempt.currentRuntimeId.trim().length === 0
  ) {
    return 'execution_plan_hash_mismatch';
  }
  const orderedCall = input.checkpoint.continuationSnapshot.orderedToolCalls.find((call): boolean => call.taskId === input.task.taskId);
  if (!orderedCall || orderedCall.toolCallId !== input.task.toolCallId) return 'checkpoint_task_missing';
  return null;
}

/**
 * 创建只含最小 Task 包的内存用户消息。
 * @param input - Child 执行输入
 * @returns 不含 Primary 聊天历史的 user 消息
 */
function createUserMessage(input: ChildRuntimeInput): ChatMessageRecord {
  const packageText = JSON.stringify({
    task: input.task.contractSnapshot.task,
    acceptanceCriteria: input.task.contractSnapshot.acceptanceCriteria,
    resources: input.task.contractSnapshot.resources
  });
  return {
    id: `${input.attempt.attemptId}:user`,
    sessionId: input.task.sessionId,
    role: 'user',
    content: packageText,
    parts: [{ id: `${input.attempt.attemptId}:user:text`, type: 'text', text: packageText }],
    agentId: input.task.agentId,
    runtimeId: input.attempt.currentRuntimeId,
    parentRuntimeId: input.attempt.parentRuntimeId,
    createdAt: input.attempt.startedAt ?? input.attempt.createdAt,
    loading: false,
    finished: true
  };
}

/**
 * 创建仅在内存中更新的 assistant 草稿。
 * @param input - Child 执行输入
 * @returns 空 assistant 草稿
 */
function createAssistant(input: ChildRuntimeInput): ChatMessageRecord {
  return {
    id: `${input.attempt.attemptId}:assistant`,
    sessionId: input.task.sessionId,
    role: 'assistant',
    content: '',
    parts: [],
    agentId: input.task.agentId,
    runtimeId: input.attempt.currentRuntimeId,
    parentRuntimeId: input.attempt.parentRuntimeId,
    createdAt: input.attempt.startedAt ?? input.attempt.createdAt,
    loading: true,
    finished: false
  };
}

/**
 * 创建 Child 专用系统约束。
 * @param plan - 冻结执行计划
 * @returns 最小安全指令
 */
function createSystemPrompt(plan: AgentExecutionPlanSnapshot): string {
  const writeMode = plan.commitPolicy.mode === 'staged';
  return [
    `You are a bounded child agent executing one ${writeMode ? 'controlled-write' : 'read-only'} task contract.`,
    `Use only the explicitly exposed local ${writeMode ? 'pure-read and staged-file' : 'pure-read'} tools and only the declared resource scopes.`,
    writeMode
      ? 'Stage candidate file content only. Do not mutate the workspace directly or request confirmation inside the model stream.'
      : 'Do not write or request confirmation.',
    'Do not access Renderer bridges, call external tools, or delegate another task.',
    `Frozen capabilities: ${plan.capabilitySet.join(', ') || 'none'}.`,
    'Return a concise factual summary for the Primary agent.'
  ].join('\n');
}

/**
 * 读取 assistant 中首个非成功工具结果。
 * @param assistant - 内存 assistant
 * @returns 工具失败投影或 null
 */
function findToolFailure(assistant: ChatMessageRecord): ChildToolFailure | null {
  const part = assistant.parts.find(
    (candidate): candidate is ChatMessageToolPart => candidate.type === 'tool' && candidate.result !== undefined && candidate.result.status !== 'success'
  );
  if (!part?.result || part.result.status === 'success') return null;
  return {
    toolName: part.toolName,
    status: part.result.status,
    ...(part.result.error ? { errorCode: part.result.error.code } : {})
  };
}

/**
 * 解析并验证冻结工作区真实路径。
 * @param dependencies - continuation context 解析依赖
 * @param checkpointId - Checkpoint 身份
 * @returns 真实路径或 null
 */
async function resolveWorkspace(dependencies: ChildExecutorDependencies, checkpointId: string): Promise<string | null> {
  const [contextResult] = await Promise.allSettled([Promise.resolve(dependencies.resolveWorkspaceRoot(checkpointId))]);
  if (contextResult.status === 'rejected' || !contextResult.value?.trim()) return null;
  const [realPathResult] = await Promise.allSettled([fs.realpath(contextResult.value)]);
  return realPathResult.status === 'fulfilled' ? realPathResult.value : null;
}

/**
 * 解析并验证 Main 私有 overlay 真实路径。
 * @param dependencies - overlay context 解析依赖
 * @param checkpointId - Checkpoint 身份
 * @returns 真实路径或 null
 */
async function resolveOverlay(dependencies: ChildExecutorDependencies, checkpointId: string): Promise<string | null> {
  const [contextResult] = await Promise.allSettled([Promise.resolve(dependencies.resolveOverlayRoot(checkpointId))]);
  if (contextResult.status === 'rejected' || !contextResult.value?.trim()) return null;
  const [realPathResult] = await Promise.allSettled([fs.realpath(contextResult.value)]);
  return realPathResult.status === 'fulfilled' ? realPathResult.value : null;
}

/**
 * 执行已经通过静态聚合校验的 Child Runtime。
 * @param dependencies - executor 可信依赖
 * @param input - Child 执行输入
 * @param controller - executor-owned AbortController
 * @param state - 累计状态
 * @param onWriteTools - write overlay 创建后的所有权观察器
 * @returns Child 终态或 changeset preparation
 */
async function executeRuntime(
  dependencies: ChildExecutorDependencies,
  input: ChildRuntimeInput,
  controller: AbortController,
  state: ChildExecutionState,
  onWriteTools: (tools: ChildWriteTools) => void
): Promise<ChildRuntimeExecutionResult> {
  const plan = input.task.executionPlanSnapshot;
  if (!plan) {
    throw new Error('Validated Child Runtime lost its execution plan');
  }
  if (controller.signal.aborted) {
    return {
      outcome: createTerminal(
        createResult(
          dependencies,
          input,
          plan,
          state,
          'cancelled',
          'Child task was cancelled before model execution.',
          createRuntimeError('cancelled', 'user', 'cooperative_cancellation', input.attempt.currentRuntimeId)
        )
      )
    };
  }

  const workspaceRoot = await resolveWorkspace(dependencies, input.checkpoint.checkpointId);
  if (!workspaceRoot) {
    return {
      outcome: createTerminal(
        createResult(
          dependencies,
          input,
          plan,
          state,
          'failed',
          'Child workspace context is unavailable.',
          createRuntimeError('runtime_start_failed', 'runtime', 'workspace_context_unavailable', input.attempt.currentRuntimeId)
        )
      )
    };
  }

  const [resolutionResult] = await Promise.allSettled([dependencies.resolver.resolve(plan.modelSnapshot)]);
  const resolution = resolutionResult.status === 'fulfilled' ? resolutionResult.value : null;
  if (!resolution || resolution.modelId !== plan.modelSnapshot.modelId || resolution.createOptions.providerId !== plan.modelSnapshot.providerId) {
    return {
      outcome: createTerminal(
        createResult(
          dependencies,
          input,
          plan,
          state,
          'failed',
          'Frozen Child model could not be resolved without substitution.',
          createRuntimeError('runtime_start_failed', 'integrity', 'frozen_model_unavailable', input.attempt.currentRuntimeId)
        )
      )
    };
  }

  let writeTools: ChildWriteTools | undefined;
  if (input.task.contractSnapshot.mode === 'write') {
    const overlayRoot = await resolveOverlay(dependencies, input.checkpoint.checkpointId);
    if (!overlayRoot) {
      return {
        outcome: createTerminal(
          createResult(
            dependencies,
            input,
            plan,
            state,
            'failed',
            'Child write overlay context is unavailable.',
            createRuntimeError('runtime_start_failed', 'runtime', 'overlay_context_unavailable', input.attempt.currentRuntimeId)
          )
        )
      };
    }
    writeTools = await createChildWriteTools({
      task: input.task,
      attempt: input.attempt,
      runtimeId: input.attempt.currentRuntimeId,
      plan,
      workspaceRoot,
      overlayRoot,
      signal: controller.signal,
      now: (): string => new Date(dependencies.now()).toISOString(),
      createId: dependencies.createOverlayId
    });
    onWriteTools(writeTools);
  }
  const runtimeTools = writeTools ?? createChildReadTools({ plan, workspaceRoot, signal: controller.signal });
  const runtime: ActiveChatRuntime = {
    runtimeId: input.attempt.currentRuntimeId,
    sessionId: input.task.sessionId,
    turnId: input.task.turnId,
    agentId: input.task.agentId,
    parentAgentId: input.task.parentAgentId,
    parentRuntimeId: input.attempt.parentRuntimeId,
    rootRuntimeId: input.task.rootRuntimeId,
    clientId: 'child-agent-runtime',
    model: plan.modelSnapshot,
    system: createSystemPrompt(plan),
    workspaceRoot,
    tools: runtimeTools.tools,
    status: 'running',
    phase: 'streaming',
    abortController: controller,
    createdAt: state.startedAt,
    resolvedModel: resolution
  };
  const streamExecutor = createRuntimeStreamExecutor({
    resolver: dependencies.resolver,
    streamText: dependencies.streamText,
    executeMainTool: async (toolInput): Promise<AIToolExecutionResult> => {
      const eventIdentity = {
        taskId: input.task.taskId,
        attemptId: input.attempt.attemptId,
        runtimeId: runtime.runtimeId,
        toolCallId: toolInput.toolCallId,
        toolName: toolInput.toolName
      };
      dependencies.recordToolStarted({
        ...eventIdentity,
        occurredAt: new Date(dependencies.now()).toISOString()
      });
      return runtimeTools.executeMainTool(toolInput);
    },
    observeMainTool: (observation): void => {
      dependencies.recordToolCompleted({
        taskId: input.task.taskId,
        attemptId: input.attempt.attemptId,
        runtimeId: observation.runtime.runtimeId,
        toolCallId: observation.toolCallId,
        toolName: observation.toolName,
        resultHash: hashAgentPayload(observation.result),
        occurredAt: new Date(dependencies.now()).toISOString()
      });
    },
    guardToolCall: runtimeTools.guardToolCall
  });
  const userMessage = createUserMessage(input);
  const assistant = createAssistant(input);
  let sourceMessages: ChatMessageRecord[] = [userMessage];

  while (state.modelCalls < CHILD_MODEL_CALL_LIMIT) {
    if (controller.signal.aborted) {
      return disposeRuntimeTools(
        writeTools,
        createTerminal(
          createResult(
            dependencies,
            input,
            plan,
            state,
            'cancelled',
            'Child task was cooperatively cancelled.',
            createRuntimeError('cancelled', 'user', 'cooperative_cancellation', runtime.runtimeId)
          )
        )
      );
    }

    // Child 不注册 message writer；stream 的更新回调只确认内存对象已被原位更新。
    // eslint-disable-next-line no-await-in-loop
    const streamResult = await streamExecutor({ runtime, sourceMessages, userMessage, assistantMessage: assistant }, async (): Promise<void> => undefined);
    state.modelCalls += 1;
    if ((runtime.currentToolStep?.toolCalls.length ?? 0) > 0) state.toolRounds += 1;
    state.usage = addRuntimeUsage(state.usage, streamResult.totalUsage);

    if (controller.signal.aborted) {
      return disposeRuntimeTools(
        writeTools,
        createTerminal(
          createResult(
            dependencies,
            input,
            plan,
            state,
            'cancelled',
            'Child task was cooperatively cancelled.',
            createRuntimeError('cancelled', 'user', 'cooperative_cancellation', runtime.runtimeId)
          )
        )
      );
    }

    const toolFailure = findToolFailure(assistant);
    if (toolFailure?.status === 'cancelled') {
      return disposeRuntimeTools(
        writeTools,
        createTerminal(
          createResult(
            dependencies,
            input,
            plan,
            state,
            'cancelled',
            'Child tool was cancelled.',
            createRuntimeError('cancelled', 'user', 'tool_cancelled', runtime.runtimeId, toolFailure.toolName)
          )
        )
      );
    }
    if (toolFailure) {
      return disposeRuntimeTools(
        writeTools,
        createTerminal(
          createResult(
            dependencies,
            input,
            plan,
            state,
            'failed',
            'Child tool invocation failed the restricted runtime policy.',
            createRuntimeError(
              'protocol_error',
              'protocol',
              toolFailure.errorCode === 'protocol_error' ? 'tool_policy_denied' : 'tool_execution_failed',
              runtime.runtimeId,
              toolFailure.toolName
            )
          )
        )
      );
    }

    if ((state.usage?.totalTokens ?? 0) > plan.budget.tokenLimit) {
      return disposeRuntimeTools(
        writeTools,
        createTerminal(
          createResult(
            dependencies,
            input,
            plan,
            state,
            'failed',
            'Child task exceeded its frozen token budget.',
            createRuntimeError('budget_exceeded', 'policy', 'token_budget_exceeded', runtime.runtimeId)
          )
        )
      );
    }

    if (streamResult.suspension) {
      return disposeRuntimeTools(
        writeTools,
        createTerminal(
          createResult(
            dependencies,
            input,
            plan,
            state,
            'failed',
            'Secondary Child delegation is forbidden.',
            createRuntimeError('protocol_error', 'protocol', 'secondary_delegation_forbidden', runtime.runtimeId)
          )
        )
      );
    }
    if (!streamResult.shouldContinue) {
      runtime.status = 'completed';
      if (!writeTools) {
        return { outcome: createTerminal(createResult(dependencies, input, plan, state, 'completed', assistant.content)) };
      }
      // prepare 必须在模型循环终止点串行冻结 overlay，不能与下一轮模型调用并发。
      // eslint-disable-next-line no-await-in-loop
      const changeset = await writeTools.prepare();
      if (!changeset) {
        return disposeRuntimeTools(writeTools, createTerminal(createResult(dependencies, input, plan, state, 'completed', assistant.content)));
      }
      return {
        outcome: {
          kind: 'changeset_prepared',
          changeset,
          draft: createWriteDraft(dependencies, input, plan, state, assistant.content)
        },
        retainedTools: writeTools
      };
    }

    sourceMessages = [...sourceMessages.filter((message): boolean => message.id !== assistant.id), assistant];
  }

  if (writeTools) await writeTools.dispose();
  return {
    outcome: createTerminal(
      createResult(
        dependencies,
        input,
        plan,
        state,
        'failed',
        'Child task exceeded the bounded model-call limit.',
        createRuntimeError('runtime_failed', 'runtime', 'model_call_limit_exceeded', input.attempt.currentRuntimeId)
      )
    )
  };
}

/**
 * 创建无聊天消息持久化的 Child executor。
 * @param dependencies - 模型、工作区、成本和时钟依赖
 * @returns Child Runtime 执行和取消边界
 */
export function createChildRuntimeExecutor(dependencies: ChildExecutorDependencies): ChildTaskRuntimeExecutor {
  const activeControllers = new Map<string, AbortController>();
  const retainedWriteTools = new Map<string, ChildWriteTools>();

  return {
    async execute(input: ChildRuntimeInput): Promise<ChildExecutionOutcome> {
      const plan = input.task.executionPlanSnapshot;
      const state: ChildExecutionState = {
        modelCalls: 0,
        toolRounds: 0,
        startedAt: dependencies.now()
      };
      if (!plan) {
        throw new Error('Child executor requires an immutable execution plan');
      }

      const validationReason = validateRuntimeInput(input);
      if (validationReason) {
        return createTerminal(
          createResult(
            dependencies,
            input,
            plan,
            state,
            'failed',
            'Child Task, Attempt, and Checkpoint are not a valid execution aggregate.',
            createRuntimeError('runtime_start_failed', 'integrity', validationReason, input.attempt.currentRuntimeId)
          )
        );
      }
      if (activeControllers.has(input.attempt.currentRuntimeId)) {
        return createTerminal(
          createResult(
            dependencies,
            input,
            plan,
            state,
            'failed',
            'Child Runtime identity is already active.',
            createRuntimeError('runtime_start_failed', 'integrity', 'runtime_already_active', input.attempt.currentRuntimeId)
          )
        );
      }

      const controller = new AbortController();
      const relayAbort = (): void => controller.abort(input.signal.reason ?? 'cooperative_cancellation');
      if (input.signal.aborted) relayAbort();
      else input.signal.addEventListener('abort', relayAbort, { once: true });
      activeControllers.set(input.attempt.currentRuntimeId, controller);

      let createdWriteTools: ChildWriteTools | undefined;
      const [executionResult] = await Promise.allSettled([
        executeRuntime(dependencies, input, controller, state, (tools: ChildWriteTools): void => {
          createdWriteTools = tools;
        })
      ]);
      input.signal.removeEventListener('abort', relayAbort);
      if (activeControllers.get(input.attempt.currentRuntimeId) === controller) {
        activeControllers.delete(input.attempt.currentRuntimeId);
      }
      if (executionResult.status === 'fulfilled') {
        if (executionResult.value.retainedTools) {
          retainedWriteTools.set(input.attempt.currentRuntimeId, executionResult.value.retainedTools);
        }
        return executionResult.value.outcome;
      }
      if (createdWriteTools) await Promise.allSettled([createdWriteTools.dispose()]);

      return createTerminal(
        createResult(
          dependencies,
          input,
          plan,
          state,
          controller.signal.aborted ? 'cancelled' : 'failed',
          controller.signal.aborted ? 'Child task was cooperatively cancelled.' : 'Child Runtime execution failed.',
          controller.signal.aborted
            ? createRuntimeError('cancelled', 'user', 'cooperative_cancellation', input.attempt.currentRuntimeId)
            : createRuntimeError('runtime_failed', 'runtime', 'runtime_execution_rejected', input.attempt.currentRuntimeId)
        )
      );
    },
    abort(runtimeId: string, reason: string): void {
      activeControllers.get(runtimeId)?.abort(reason);
    },
    async discard(runtimeId: string): Promise<void> {
      const tools = retainedWriteTools.get(runtimeId);
      if (!tools) return;
      retainedWriteTools.delete(runtimeId);
      await tools.dispose();
    }
  };
}
