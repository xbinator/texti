/**
 * @file executor.mts
 * @description 按冻结源、pending、摘要生成和提交复验顺序原子执行上下文压缩。
 */
import type { SummaryGenerationInput, SummaryGenerationResult, SummaryGenerationErrorCode } from './summary-generator.mjs';
import type { AITransportTool } from 'types/ai';
import type {
  ChatMessageCompactionPart,
  ChatMessagePart,
  ChatMessageRecord,
  CompactionModelSnapshot,
  CompactionValidationErrorCode,
  StructuredContextSummary
} from 'types/chat';
import { isImmutablePart } from './boundary.mjs';
import { buildSourceFingerprint, createFingerprintInput } from './fingerprint.mjs';
import { createCompactionPlan, type CompactionPlan, type CompactionPlanErrorCode, type CompactionPlanInput, type CompactionSkipReason } from './planner.mjs';
import { projectContext } from './projector.mjs';
import { validateStructuredSummary } from './summary-schema.mjs';
import { indexMessageParts } from './topology.mjs';

/** executor 可观察阶段。 */
export type CompactionExecutorStage =
  | 'capture'
  | 'plan'
  | 'write:pending'
  | 'generate'
  | 'validate'
  | 'verify'
  | 'write:success'
  | 'write:failed'
  | 'write:cancelled'
  | 'write:skipped';

/** executor 附加错误码。 */
export type CompactionExecuteErrorCode =
  | CompactionPlanErrorCode
  | SummaryGenerationErrorCode
  | 'CAPTURE_FAILED'
  | 'PERSIST_FAILED'
  | 'MODEL_CHANGED'
  | 'SOURCE_CHANGED'
  | 'TARGET_BUDGET_EXCEEDED';

/**
 * executor 输入。
 */
export interface CompactionExecuteInput {
  /** 当前 Runtime 标识。 */
  runtimeId: string;
  /** 当前 Session 标识。 */
  sessionId: string;
  /** 自动或手动触发。 */
  trigger: 'automatic' | 'manual';
  /** 承载 compaction Part 的 assistant 消息。 */
  assistantMessage: ChatMessageRecord;
  /** 自动请求时必须保持原文的当前用户消息。 */
  currentUserMessageId?: string;
  /** 当前上下文窗口。 */
  contextWindow: number;
  /** 当前最大输出 Token。 */
  maxOutputTokens?: number;
  /** 已解析当前模型的脱敏快照。 */
  modelSnapshot: CompactionModelSnapshot;
  /** 不可压缩系统提示词。 */
  system?: string;
  /** 不可压缩工具 schema。 */
  tools?: AITransportTool[];
  /** 当前 Skill 内容版本。 */
  skillContentHashes?: Record<string, string>;
}

/** executor 结果。 */
export type CompactionExecuteResult =
  | { status: 'success'; checkpoint: ChatMessageCompactionPart & { status: 'success' } }
  | { status: 'skipped'; reason: CompactionSkipReason; checkpoint?: ChatMessageCompactionPart }
  | {
      status: 'failed';
      errorCode: CompactionExecuteErrorCode;
      /** 最后一次摘要校验的脱敏子错误码。 */
      validationErrorCode?: CompactionValidationErrorCode;
      /** 是否执行过一次摘要修复重试。 */
      repairAttempted?: true;
    }
  | { status: 'cancelled'; checkpoint: ChatMessageCompactionPart };

/** 脱敏压缩诊断日志。 */
export interface CompactionDiagnosticLog {
  /** Runtime 标识。 */
  runtimeId: string;
  /** Session 标识。 */
  sessionId: string;
  /** 已创建时的 checkpoint 标识。 */
  checkpointId?: string;
  /** 自动或手动触发。 */
  trigger: 'automatic' | 'manual';
  /** executor 终态。 */
  status: CompactionExecuteResult['status'];
  /** 不足以还原完整指纹的短前缀。 */
  fingerprintPrefix?: string;
  /** 规划时的上下文投影估算。 */
  estimatedTokens?: number;
  /** 压缩成功必须满足的目标预算。 */
  targetTokens?: number;
  /** 成功候选的实际压缩后投影估算。 */
  projectedTokens?: number;
  /** executor 总耗时。 */
  durationMs: number;
  /** 仅包含脱敏字段的模型快照。 */
  modelSnapshot: CompactionModelSnapshot;
  /** 失败、取消或跳过的稳定原因。 */
  errorCode?: string;
  /** 触发修复或最终失败的脱敏摘要校验子错误码。 */
  validationErrorCode?: CompactionValidationErrorCode;
  /** 是否执行过一次摘要修复重试。 */
  repairAttempted?: boolean;
}

/**
 * executor 依赖。
 */
export interface CompactionExecutorDependencies {
  /** 读取当前 session 的完整原始消息。 */
  readMessages: (sessionId: string) => Promise<ChatMessageRecord[]>;
  /** 整条原子写入承载 compaction Part 的消息。 */
  writeMessage: (message: ChatMessageRecord) => Promise<void>;
  /** 使用冻结源生成结构化摘要。 */
  generateSummary: (input: SummaryGenerationInput) => Promise<SummaryGenerationResult>;
  /** 校验当前 runtime 仍持有 session 写 lease。 */
  hasLease: (sessionId: string, runtimeId: string) => boolean;
  /** 中止当前摘要模型请求。 */
  abortSummary?: (runtimeId: string) => Promise<void> | void;
  /** 创建 compaction Part 标识。 */
  createPartId: () => string;
  /** 获取当前时间戳。 */
  now: () => number;
  /** 接收不包含消息正文、摘要、密钥或完整指纹的诊断日志。 */
  diagnosticLog?: (entry: CompactionDiagnosticLog) => void;
  /** 可选执行阶段观察器。 */
  onStage?: (stage: CompactionExecutorStage) => void;
}

/**
 * compaction executor。
 */
export interface CompactionExecutor {
  /**
   * 执行一次上下文压缩。
   * @param input - runtime、模型和承载消息
   * @returns 压缩终态
   */
  execute(input: CompactionExecuteInput): Promise<CompactionExecuteResult>;
  /**
   * 取消指定 runtime 的压缩。
   * @param runtimeId - Runtime 标识
   * @returns pending checkpoint 写入终态后的 Promise
   */
  cancel(runtimeId: string): Promise<void>;
}

/** Promise 归一化结果。 */
type SettledResult<T> = { ok: true; value: T } | { ok: false };

/**
 * 提交前复验结果。
 */
interface VerificationResult {
  /** 当前数据库消息 clone。 */
  messages: ChatMessageRecord[];
  /** 根据当前实际 Part 重算的 fingerprint。 */
  sourceFingerprint: string;
}

/** 单次 executor 的脱敏诊断上下文。 */
interface ActiveDiagnosticState {
  /** Runtime 标识。 */
  runtimeId: string;
  /** Session 标识。 */
  sessionId: string;
  /** 自动或手动触发。 */
  trigger: 'automatic' | 'manual';
  /** 脱敏模型快照。 */
  modelSnapshot: CompactionModelSnapshot;
  /** 开始时间。 */
  startedAt: number;
  /** 已分配 checkpoint ID。 */
  checkpointId?: string;
  /** 规划得到的完整指纹，仅用于截取短前缀。 */
  sourceFingerprint?: string;
  /** 规划时投影估算。 */
  estimatedTokens?: number;
  /** 规划目标预算。 */
  targetTokens?: number;
  /** 成功候选的实际压缩后投影估算。 */
  projectedTokens?: number;
  /** 触发修复或最终失败的脱敏摘要校验子错误码。 */
  validationErrorCode?: CompactionValidationErrorCode;
  /** 是否执行过一次摘要修复重试。 */
  repairAttempted?: boolean;
}

/**
 * 将 Promise rejection 归一化为判别联合。
 * @param promise - 待等待 Promise
 * @returns fulfilled 值或失败标记
 */
async function settlePromise<T>(promise: Promise<T>): Promise<SettledResult<T>> {
  const [result] = await Promise.allSettled([promise]);

  return result.status === 'fulfilled' ? { ok: true, value: result.value } : { ok: false };
}

/**
 * 收集 parent summary 中继承的证据 Part ID。
 * @param summary - parent 结构化摘要
 * @returns 证据 ID
 */
function collectParentSources(summary?: StructuredContextSummary): string[] {
  if (!summary) return [];

  return [
    ...summary.objectives,
    ...summary.facts,
    ...summary.artifacts,
    ...summary.completedActions,
    ...summary.pendingActions,
    ...summary.openQuestions,
    ...summary.failures
  ].flatMap((item): string[] => item.sourcePartIds);
}

/**
 * 判断摘要生成模型与规划时冻结模型是否一致。
 * @param left - 规划模型
 * @param right - 生成模型
 * @returns 是否为同一脱敏模型快照
 */
function isSameModel(left: CompactionModelSnapshot, right: CompactionModelSnapshot): boolean {
  return (
    left.providerType === right.providerType &&
    left.providerId === right.providerId &&
    left.modelId === right.modelId &&
    left.contextWindow === right.contextWindow &&
    left.maxOutputTokens === right.maxOutputTokens
  );
}

/**
 * 递归冻结成功 checkpoint，避免 runtime 后续误改。
 * @param value - 待冻结值
 * @returns 同一冻结值
 */
function freezeCheckpoint<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeCheckpoint(child);

  return Object.freeze(value);
}

/**
 * 将 compaction Part 追加到 assistant 消息尾部。
 * @param message - assistant 消息
 * @param part - compaction Part
 */
function appendCheckpoint(message: ChatMessageRecord, part: ChatMessageCompactionPart): void {
  message.parts.push(part);
}

/**
 * 替换仍为 pending 的 compaction Part。
 * @param message - assistant 消息
 * @param checkpointId - checkpoint 标识
 * @param terminal - 新终态 Part
 * @returns 是否成功替换
 */
function replaceCheckpoint(message: ChatMessageRecord, checkpointId: string, terminal: ChatMessageCompactionPart): boolean {
  const partIndex = message.parts.findIndex(
    (part: ChatMessagePart): boolean => part.id === checkpointId && part.type === 'compaction' && part.status === 'pending'
  );
  if (partIndex < 0) return false;
  message.parts[partIndex] = terminal;

  return true;
}

/**
 * 创建 pending checkpoint。
 * @param input - executor 输入
 * @param plan - 冻结计划
 * @param checkpointId - checkpoint 标识
 * @param createdAt - 创建时间
 * @returns pending Part
 */
function createPendingCheckpoint(input: CompactionExecuteInput, plan: CompactionPlan, checkpointId: string, createdAt: number): ChatMessageCompactionPart {
  return {
    id: checkpointId,
    type: 'compaction',
    status: 'pending',
    trigger: input.trigger,
    boundaryPartId: plan.boundaryPartId,
    parentCheckpointId: plan.parentCheckpointId,
    sourceFingerprint: plan.sourceSnapshot.sourceFingerprint,
    modelSnapshot: structuredClone(plan.modelSnapshot),
    budgetSnapshot: structuredClone(plan.budgetSnapshot),
    createdAt
  };
}

/**
 * 使用当前数据库实际 Part 重算 fingerprint 并校验位置与 lease。
 * @param input - executor 输入
 * @param plan - 冻结计划
 * @param checkpointId - pending checkpoint 标识
 * @param dependencies - executor 依赖
 * @returns 复验结果，源变化时返回 undefined
 */
async function verifySource(
  input: CompactionExecuteInput,
  plan: CompactionPlan,
  checkpointId: string,
  dependencies: CompactionExecutorDependencies
): Promise<VerificationResult | undefined> {
  if (!dependencies.hasLease(input.sessionId, input.runtimeId)) return undefined;
  const readResult = await settlePromise(dependencies.readMessages(input.sessionId));
  if (!readResult.ok) return undefined;
  const messages = readResult.value;
  const indexedParts = indexMessageParts(messages);
  const pendingAbsoluteIndex = indexedParts.findIndex(
    (entry): boolean => entry.part.id === checkpointId && entry.part.type === 'compaction' && entry.part.status === 'pending'
  );
  const boundaryAbsoluteIndex = indexedParts.findIndex((entry): boolean => entry.part.id === plan.boundaryPartId);
  if (pendingAbsoluteIndex < 0 || boundaryAbsoluteIndex < 0 || boundaryAbsoluteIndex >= pendingAbsoluteIndex) return undefined;
  const boundary = indexedParts[boundaryAbsoluteIndex];
  if (!isImmutablePart(boundary.part, messages[boundary.messageIndex])) return undefined;

  const actualSources: Array<{ messageId: string; part: ChatMessagePart }> = [];
  for (const frozenSource of plan.fingerprintSources) {
    const actual = indexedParts.find(
      (entry): boolean => entry.messageId === frozenSource.messageId && entry.part.id === frozenSource.part.id && entry.part.type !== 'compaction'
    );
    if (!actual) return undefined;
    actualSources.push({ messageId: actual.messageId, part: actual.part });
  }
  const sourceFingerprint = buildSourceFingerprint(
    createFingerprintInput({
      modelSnapshot: plan.modelSnapshot,
      budgetSnapshot: plan.budgetSnapshot,
      parentCheckpointId: plan.parentCheckpointId,
      boundaryPartId: plan.boundaryPartId,
      sources: actualSources
    })
  );
  if (sourceFingerprint !== plan.sourceSnapshot.sourceFingerprint) return undefined;

  return { messages, sourceFingerprint };
}

/**
 * 把 pending 更新为非成功终态并持久化。
 * @param input - executor 输入
 * @param pending - pending checkpoint
 * @param status - 失败或取消状态
 * @param dependencies - executor 依赖
 * @param errorCode - 稳定原因码
 * @param validationErrorCode - 可选脱敏摘要校验子错误码
 * @returns 写入后的终态 Part，写入失败时返回 undefined
 */
async function writeTerminalCheckpoint(
  input: CompactionExecuteInput,
  pending: ChatMessageCompactionPart,
  status: 'failed' | 'cancelled',
  dependencies: CompactionExecutorDependencies,
  errorCode?: string,
  validationErrorCode?: CompactionValidationErrorCode
): Promise<ChatMessageCompactionPart | undefined> {
  const terminal: ChatMessageCompactionPart = {
    ...structuredClone(pending),
    status,
    errorCode,
    ...(validationErrorCode ? { validationErrorCode } : {}),
    completedAt: dependencies.now()
  };
  if (!replaceCheckpoint(input.assistantMessage, pending.id, terminal)) return undefined;
  dependencies.onStage?.(status === 'failed' ? 'write:failed' : 'write:cancelled');
  const writeResult = await settlePromise(dependencies.writeMessage(input.assistantMessage));

  return writeResult.ok ? terminal : undefined;
}

/**
 * 为手动 skipped 或规划 blocked 写入直接终态 Part。
 * @param input - executor 输入
 * @param status - skipped 或 failed
 * @param errorCode - 稳定原因码
 * @param dependencies - executor 依赖
 * @returns 写入后的终态，失败时返回 undefined
 */
async function writeDirectCheckpoint(
  input: CompactionExecuteInput,
  status: 'skipped' | 'failed',
  errorCode: string,
  dependencies: CompactionExecutorDependencies
): Promise<ChatMessageCompactionPart | undefined> {
  const createdAt = dependencies.now();
  const checkpoint: ChatMessageCompactionPart = {
    id: dependencies.createPartId(),
    type: 'compaction',
    status,
    trigger: input.trigger,
    errorCode,
    createdAt,
    completedAt: createdAt
  };
  appendCheckpoint(input.assistantMessage, checkpoint);
  dependencies.onStage?.(status === 'skipped' ? 'write:skipped' : 'write:failed');
  const writeResult = await settlePromise(dependencies.writeMessage(input.assistantMessage));

  return writeResult.ok ? checkpoint : undefined;
}

/**
 * 创建原子上下文压缩 executor。
 * @param dependencies - 读取、写入、摘要和 lease 依赖
 * @returns 可执行和取消的 executor
 */
export function createCompactionExecutor(dependencies: CompactionExecutorDependencies): CompactionExecutor {
  const activeControllers = new Map<string, AbortController>();
  const activeDiagnostics = new Map<string, ActiveDiagnosticState>();
  const activeExecutions = new Map<string, Promise<CompactionExecuteResult>>();

  /**
   * 从 executor 结果读取稳定错误或跳过原因。
   * @param result - executor 终态
   * @returns 稳定错误码，不适用时返回 undefined
   */
  function readResultError(result: CompactionExecuteResult): string | undefined {
    if (result.status === 'failed') return result.errorCode;
    if (result.status === 'skipped') return result.reason;
    if (result.status === 'cancelled') return result.checkpoint.errorCode;
    return undefined;
  }

  /**
   * 发送严格白名单化的单条终态诊断日志。
   * @param state - 当前执行诊断上下文
   * @param result - executor 终态
   */
  function emitDiagnostic(state: ActiveDiagnosticState, result: CompactionExecuteResult): void {
    if (!dependencies.diagnosticLog) return;
    const checkpoint = 'checkpoint' in result ? result.checkpoint : undefined;
    const sourceFingerprint = checkpoint?.sourceFingerprint ?? state.sourceFingerprint;
    const entry: CompactionDiagnosticLog = {
      runtimeId: state.runtimeId,
      sessionId: state.sessionId,
      checkpointId: checkpoint?.id ?? state.checkpointId,
      trigger: state.trigger,
      status: result.status,
      fingerprintPrefix: sourceFingerprint ? sourceFingerprint.slice(0, 15) : undefined,
      estimatedTokens: state.estimatedTokens,
      targetTokens: state.targetTokens,
      projectedTokens: state.projectedTokens,
      durationMs: Math.max(0, dependencies.now() - state.startedAt),
      modelSnapshot: structuredClone(state.modelSnapshot),
      errorCode: readResultError(result),
      validationErrorCode: state.validationErrorCode,
      repairAttempted: state.repairAttempted
    };
    try {
      dependencies.diagnosticLog(entry);
    } catch {
      // 诊断日志失败不得改变压缩事务终态。
    }
  }

  /**
   * 清理 runtime controller 并返回结果。
   * @param runtimeId - Runtime 标识
   * @param result - executor 结果
   * @returns 原结果
   */
  function finishExecution(runtimeId: string, result: CompactionExecuteResult): CompactionExecuteResult {
    const diagnostic = activeDiagnostics.get(runtimeId);
    if (diagnostic) emitDiagnostic(diagnostic, result);
    activeControllers.delete(runtimeId);
    activeDiagnostics.delete(runtimeId);
    return result;
  }

  /**
   * 执行一次 compaction。
   * @param input - executor 输入
   * @returns compaction 终态
   */
  async function executeCompaction(input: CompactionExecuteInput): Promise<CompactionExecuteResult> {
    const controller = new AbortController();
    activeControllers.set(input.runtimeId, controller);
    const diagnostic: ActiveDiagnosticState = {
      runtimeId: input.runtimeId,
      sessionId: input.sessionId,
      trigger: input.trigger,
      modelSnapshot: structuredClone(input.modelSnapshot),
      startedAt: dependencies.now()
    };
    activeDiagnostics.set(input.runtimeId, diagnostic);
    dependencies.onStage?.('capture');
    const captureResult = await settlePromise(dependencies.readMessages(input.sessionId));
    if (!captureResult.ok) return finishExecution(input.runtimeId, { status: 'failed', errorCode: 'CAPTURE_FAILED' });

    const planInput: CompactionPlanInput = {
      trigger: input.trigger,
      messages: captureResult.value,
      currentUserMessageId: input.currentUserMessageId,
      contextWindow: input.contextWindow,
      maxOutputTokens: input.maxOutputTokens,
      modelSnapshot: input.modelSnapshot,
      system: input.system,
      tools: input.tools,
      skillContentHashes: input.skillContentHashes
    };
    dependencies.onStage?.('plan');
    const planResult = createCompactionPlan(planInput);
    if (planResult.status === 'skipped') {
      if (input.trigger === 'manual') {
        const checkpoint = await writeDirectCheckpoint(input, 'skipped', planResult.reason, dependencies);
        if (!checkpoint) return finishExecution(input.runtimeId, { status: 'failed', errorCode: 'PERSIST_FAILED' });
        diagnostic.checkpointId = checkpoint.id;
        return finishExecution(input.runtimeId, { status: 'skipped', reason: planResult.reason, checkpoint });
      }
      return finishExecution(input.runtimeId, { status: 'skipped', reason: planResult.reason });
    }
    if (planResult.status === 'blocked') {
      const checkpoint = await writeDirectCheckpoint(input, 'failed', planResult.errorCode, dependencies);
      if (!checkpoint) return finishExecution(input.runtimeId, { status: 'failed', errorCode: 'PERSIST_FAILED' });
      diagnostic.checkpointId = checkpoint.id;
      return finishExecution(input.runtimeId, { status: 'failed', errorCode: planResult.errorCode });
    }

    const { plan } = planResult;
    diagnostic.sourceFingerprint = plan.sourceSnapshot.sourceFingerprint;
    diagnostic.estimatedTokens = plan.projectedTokens;
    diagnostic.targetTokens = plan.budgetSnapshot.targetTokens;
    const pending = createPendingCheckpoint(input, plan, dependencies.createPartId(), dependencies.now());
    diagnostic.checkpointId = pending.id;
    appendCheckpoint(input.assistantMessage, pending);
    dependencies.onStage?.('write:pending');
    const pendingWrite = await settlePromise(dependencies.writeMessage(input.assistantMessage));
    if (!pendingWrite.ok) {
      // 首次写入失败也必须先把共享消息中的 pending 收敛，防止后续整消息更新把它重新带入数据库。
      await writeTerminalCheckpoint(input, pending, 'failed', dependencies, 'PERSIST_FAILED');
      return finishExecution(input.runtimeId, { status: 'failed', errorCode: 'PERSIST_FAILED' });
    }

    dependencies.onStage?.('generate');
    const generationResult = await settlePromise(
      dependencies.generateSummary({
        runtimeId: input.runtimeId,
        contextWindow: input.contextWindow,
        maxOutputTokens: input.maxOutputTokens,
        budgetSnapshot: plan.budgetSnapshot,
        sourceSnapshot: structuredClone(plan.sourceSnapshot)
      })
    );
    if (controller.signal.aborted) {
      const checkpoint = await writeTerminalCheckpoint(input, pending, 'cancelled', dependencies, 'USER_CANCELLED');
      if (!checkpoint) return finishExecution(input.runtimeId, { status: 'failed', errorCode: 'PERSIST_FAILED' });
      return finishExecution(input.runtimeId, { status: 'cancelled', checkpoint });
    }
    if (!generationResult.ok) {
      const errorCode = 'MODEL_CALL_FAILED';
      const checkpoint = await writeTerminalCheckpoint(input, pending, 'failed', dependencies, errorCode);
      if (!checkpoint) return finishExecution(input.runtimeId, { status: 'failed', errorCode: 'PERSIST_FAILED' });
      return finishExecution(input.runtimeId, { status: 'failed', errorCode });
    }
    if (generationResult.value.status === 'failed') {
      const { errorCode, validationErrorCode, repairAttempted } = generationResult.value;
      diagnostic.validationErrorCode = validationErrorCode;
      diagnostic.repairAttempted = repairAttempted;
      const checkpoint = await writeTerminalCheckpoint(input, pending, 'failed', dependencies, errorCode, validationErrorCode);
      if (!checkpoint) return finishExecution(input.runtimeId, { status: 'failed', errorCode: 'PERSIST_FAILED' });
      return finishExecution(input.runtimeId, {
        status: 'failed',
        errorCode,
        ...(validationErrorCode ? { validationErrorCode } : {}),
        ...(repairAttempted ? { repairAttempted } : {})
      });
    }

    dependencies.onStage?.('validate');
    const generation = generationResult.value;
    diagnostic.validationErrorCode = generation.validationErrorCode;
    diagnostic.repairAttempted = generation.repairAttempted;
    if (!isSameModel(plan.modelSnapshot, generation.modelSnapshot)) {
      const checkpoint = await writeTerminalCheckpoint(input, pending, 'failed', dependencies, 'MODEL_CHANGED');
      if (!checkpoint) return finishExecution(input.runtimeId, { status: 'failed', errorCode: 'PERSIST_FAILED' });
      return finishExecution(input.runtimeId, { status: 'failed', errorCode: 'MODEL_CHANGED' });
    }
    const allowedPartIds = new Set<string>([
      ...plan.sourceSnapshot.sourceParts.map((source): string => source.part.id),
      ...collectParentSources(plan.sourceSnapshot.parentCheckpoint)
    ]);
    const summaryValidation = validateStructuredSummary(generation.summary, allowedPartIds);
    if (!summaryValidation.ok) {
      diagnostic.validationErrorCode = summaryValidation.errorCode;
      const checkpoint = await writeTerminalCheckpoint(input, pending, 'failed', dependencies, 'SCHEMA_INVALID', summaryValidation.errorCode);
      if (!checkpoint) return finishExecution(input.runtimeId, { status: 'failed', errorCode: 'PERSIST_FAILED' });
      return finishExecution(input.runtimeId, {
        status: 'failed',
        errorCode: 'SCHEMA_INVALID',
        validationErrorCode: summaryValidation.errorCode,
        ...(generation.repairAttempted ? { repairAttempted: generation.repairAttempted } : {})
      });
    }

    dependencies.onStage?.('verify');
    const verification = await verifySource(input, plan, pending.id, dependencies);
    if (!verification) {
      const checkpoint = await writeTerminalCheckpoint(input, pending, 'failed', dependencies, 'SOURCE_CHANGED');
      if (!checkpoint) return finishExecution(input.runtimeId, { status: 'failed', errorCode: 'PERSIST_FAILED' });
      return finishExecution(input.runtimeId, { status: 'failed', errorCode: 'SOURCE_CHANGED' });
    }

    const successCandidate: ChatMessageCompactionPart & { status: 'success' } = {
      ...structuredClone(pending),
      status: 'success',
      sourceFingerprint: verification.sourceFingerprint,
      summary: structuredClone(summaryValidation.summary),
      completedAt: dependencies.now()
    };
    const candidateMessages = structuredClone(verification.messages);
    const candidatePart = candidateMessages
      .flatMap((message: ChatMessageRecord): ChatMessagePart[] => message.parts)
      .find((part: ChatMessagePart): boolean => part.id === pending.id);
    if (!candidatePart || candidatePart.type !== 'compaction' || candidatePart.status !== 'pending') {
      const checkpoint = await writeTerminalCheckpoint(input, pending, 'failed', dependencies, 'SOURCE_CHANGED');
      if (!checkpoint) return finishExecution(input.runtimeId, { status: 'failed', errorCode: 'PERSIST_FAILED' });
      return finishExecution(input.runtimeId, { status: 'failed', errorCode: 'SOURCE_CHANGED' });
    }
    const candidateMessage = candidateMessages.find((message: ChatMessageRecord): boolean =>
      message.parts.some((part: ChatMessagePart): boolean => part.id === pending.id)
    );
    if (!candidateMessage || !replaceCheckpoint(candidateMessage, pending.id, successCandidate)) {
      const checkpoint = await writeTerminalCheckpoint(input, pending, 'failed', dependencies, 'SOURCE_CHANGED');
      if (!checkpoint) return finishExecution(input.runtimeId, { status: 'failed', errorCode: 'PERSIST_FAILED' });
      return finishExecution(input.runtimeId, { status: 'failed', errorCode: 'SOURCE_CHANGED' });
    }
    let projected = projectContext({
      messages: candidateMessages,
      system: input.system,
      tools: input.tools,
      skillContentHashes: input.skillContentHashes,
      activeTurnToolPruneMode: 'preserve-latest'
    });
    if (projected.estimatedTokens > plan.budgetSnapshot.targetTokens) {
      projected = projectContext({
        messages: candidateMessages,
        system: input.system,
        tools: input.tools,
        skillContentHashes: input.skillContentHashes,
        activeTurnToolPruneMode: 'all-complete'
      });
    }
    diagnostic.projectedTokens = projected.estimatedTokens;
    if (projected.estimatedTokens > plan.budgetSnapshot.targetTokens) {
      const checkpoint = await writeTerminalCheckpoint(input, pending, 'failed', dependencies, 'TARGET_BUDGET_EXCEEDED');
      if (!checkpoint) return finishExecution(input.runtimeId, { status: 'failed', errorCode: 'PERSIST_FAILED' });
      return finishExecution(input.runtimeId, { status: 'failed', errorCode: 'TARGET_BUDGET_EXCEEDED' });
    }

    const successCheckpoint = freezeCheckpoint(successCandidate);
    if (!replaceCheckpoint(input.assistantMessage, pending.id, successCheckpoint)) {
      return finishExecution(input.runtimeId, { status: 'failed', errorCode: 'SOURCE_CHANGED' });
    }
    dependencies.onStage?.('write:success');
    const successWrite = await settlePromise(dependencies.writeMessage(input.assistantMessage));
    if (!successWrite.ok) return finishExecution(input.runtimeId, { status: 'failed', errorCode: 'PERSIST_FAILED' });

    return finishExecution(input.runtimeId, { status: 'success', checkpoint: successCheckpoint });
  }

  /**
   * 跟踪执行 Promise，供取消方等待 pending checkpoint 收敛为终态。
   * @param input - executor 输入
   * @returns 压缩终态
   */
  async function executeTracked(input: CompactionExecuteInput): Promise<CompactionExecuteResult> {
    const execution = executeCompaction(input);
    activeExecutions.set(input.runtimeId, execution);
    try {
      return await execution;
    } finally {
      if (activeExecutions.get(input.runtimeId) === execution) activeExecutions.delete(input.runtimeId);
    }
  }

  return {
    execute: executeTracked,
    async cancel(runtimeId: string): Promise<void> {
      const controller = activeControllers.get(runtimeId);
      if (!controller) return;
      controller.abort();
      const abortSummary = Promise.resolve().then((): Promise<void> | void => dependencies.abortSummary?.(runtimeId));
      const execution = activeExecutions.get(runtimeId);
      await Promise.allSettled(execution ? [abortSummary, execution] : [abortSummary]);
    }
  };
}
