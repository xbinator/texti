/**
 * @file planner.mts
 * @description 纯函数规划上下文压缩 boundary、预算、冻结源和 source fingerprint。
 */
import type { CompactionSourceSnapshot, ImmutableChatPart } from './types.mjs';
import type { ActiveTurnToolPruneMode } from '../context/tool-output-prune.mjs';
import type { AITransportTool } from 'types/ai';
import type { ChatMessageCompactionPart, ChatMessagePart, ChatMessageRecord, CompactionBudgetSnapshot, CompactionModelSnapshot } from 'types/chat';
import type { ChatRendererToolDescriptor } from 'types/chat-runtime';
import { projectHistoricalRendererPart } from '../context/renderer-tool-output.mjs';
import { pruneActiveTurnToolOutputs, pruneMessageToolOutputs } from '../context/tool-output-prune.mjs';
import { findSafeBoundary } from './boundary.mjs';
import { canGenerateSummary, createCompactionBudget, hasSummaryCapacity, shouldAutoCompact } from './budget.mjs';
import { buildSourceFingerprint, createFingerprintInput } from './fingerprint.mjs';
import { projectContext } from './projector.mjs';
import { createSummaryPrompt } from './summary-generator.mjs';
import { estimateRequestTokens, estimateTextTokens } from './token-estimator.mjs';
import { indexMessageParts, validatePartTopology } from './topology.mjs';

/** 压缩无需执行的稳定原因。 */
export type CompactionSkipReason = 'BELOW_THRESHOLD' | 'NO_SAFE_BOUNDARY' | 'NO_NEW_CONTENT' | 'REPEATED_FAILURE';

/** 规划阶段阻止压缩的稳定错误码。 */
export type CompactionPlanErrorCode = 'CONTEXT_WINDOW_UNAVAILABLE' | 'NONCOMPRESSIBLE_CONTEXT_TOO_LARGE' | 'SUMMARY_REQUEST_TOO_LARGE';

/**
 * 压缩规划器输入。
 */
export interface CompactionPlanInput {
  /** 自动或手动触发。 */
  trigger: 'automatic' | 'manual';
  /** 当前完整原始消息。 */
  messages: ChatMessageRecord[];
  /** 自动请求时必须保持原文的当前用户消息。 */
  currentUserMessageId?: string;
  /** 当前模型上下文窗口。 */
  contextWindow: number;
  /** 当前请求最大输出 Token。 */
  maxOutputTokens?: number;
  /** 当前选中模型的脱敏快照。 */
  modelSnapshot: CompactionModelSnapshot;
  /** 不可压缩的系统提示词。 */
  system?: string;
  /** 不可压缩的工具 schema。 */
  tools?: AITransportTool[];
  /** 当前 Skill 内容版本。 */
  skillContentHashes?: Record<string, string>;
  /** 迁移前工具 Part 使用的 Renderer 历史策略。 */
  rendererTools?: readonly ChatRendererToolDescriptor[];
}

/**
 * 可执行压缩计划。
 */
export interface CompactionPlan {
  /** 自动或手动触发。 */
  trigger: 'automatic' | 'manual';
  /** 被摘要范围内最后一个 immutable Part。 */
  boundaryPartId: string;
  /** 上一个拓扑有效 checkpoint。 */
  parentCheckpointId?: string;
  /** 进入摘要模型的冻结源，可能包含仅投影的工具结果软剪枝。 */
  sourceSnapshot: CompactionSourceSnapshot;
  /** 用于提交前重新计算 fingerprint 的原始 Part clone。 */
  fingerprintSources: ImmutableChatPart[];
  /** boundary 后必须保持原文的消息 tail。 */
  rawTailMessages: ChatMessageRecord[];
  /** 因摘要容量不足采用的当前 Agent 轮次工具结果裁剪级别。 */
  activeTurnToolPruneMode?: ActiveTurnToolPruneMode;
  /** 脱敏模型快照。 */
  modelSnapshot: CompactionModelSnapshot;
  /** 完整预算快照。 */
  budgetSnapshot: CompactionBudgetSnapshot;
  /** 当前模型投影估算。 */
  projectedTokens: number;
  /** system、tools 和 raw tail 的 Token 估算。 */
  noncompressibleTokens: number;
  /** 实际送入摘要请求的源 Token 估算。 */
  summarySourceTokens: number;
}

/** 压缩规划结果。 */
export type CompactionPlanResult =
  | { status: 'ready'; plan: CompactionPlan }
  | { status: 'skipped'; reason: CompactionSkipReason }
  | { status: 'blocked'; errorCode: CompactionPlanErrorCode };

/**
 * 已定位的 parent checkpoint。
 */
interface ParentCheckpoint {
  /** 成功 checkpoint。 */
  part: ChatMessageCompactionPart & { status: 'success' };
  /** parent boundary 的全局 Part 索引。 */
  boundaryAbsoluteIndex: number;
}

/**
 * 查找最新拓扑有效 checkpoint 及其 boundary。
 * @param messages - 原始消息
 * @returns parent checkpoint，不存在时返回 undefined
 */
function findParentCheckpoint(messages: ChatMessageRecord[]): ParentCheckpoint | undefined {
  const topology = validatePartTopology(messages);
  const indexedParts = indexMessageParts(messages);
  const positions = new Map(indexedParts.map((entry, absoluteIndex): [string, number] => [entry.part.id, absoluteIndex]));

  for (let absoluteIndex = indexedParts.length - 1; absoluteIndex >= 0; absoluteIndex -= 1) {
    const { part } = indexedParts[absoluteIndex];
    if (part.type !== 'compaction' || part.status !== 'success' || !topology.validCheckpointIds.has(part.id) || !part.boundaryPartId) continue;
    const boundaryAbsoluteIndex = positions.get(part.boundaryPartId);
    if (boundaryAbsoluteIndex === undefined) continue;

    return { part: part as ChatMessageCompactionPart & { status: 'success' }, boundaryAbsoluteIndex };
  }

  return undefined;
}

/**
 * 克隆 boundary 后的原始 tail 并移除 compaction 生命周期 Part。
 * @param messages - 原始消息
 * @param boundaryMessageIndex - boundary 消息索引
 * @param boundaryPartIndex - boundary Part 索引
 * @returns 原始 tail clone
 */
function createRawTail(messages: ChatMessageRecord[], boundaryMessageIndex: number, boundaryPartIndex: number): ChatMessageRecord[] {
  const tail: ChatMessageRecord[] = [];

  for (let messageIndex = boundaryMessageIndex; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    const startPartIndex = messageIndex === boundaryMessageIndex ? boundaryPartIndex + 1 : 0;
    const parts = message.parts
      .slice(startPartIndex)
      .filter((part: ChatMessagePart): boolean => part.type !== 'compaction')
      .map((part: ChatMessagePart): ChatMessagePart => structuredClone(part));
    const content = parts.length > 0 || message.parts.length === 0 ? message.content : '';
    if (parts.length === 0 && !content.trim()) continue;
    tail.push({ ...structuredClone(message), content, parts });
  }

  return tail;
}

/**
 * 收集 parent boundary 后到新 boundary 的增量 immutable 源。
 * @param messages - 原始消息
 * @param boundaryPartId - 新 boundary 标识
 * @param parent - parent checkpoint
 * @returns 原始增量源 clone
 */
function collectSourceParts(messages: ChatMessageRecord[], boundaryPartId: string, parent?: ParentCheckpoint): ImmutableChatPart[] {
  const indexedParts = indexMessageParts(messages);
  const boundaryAbsoluteIndex = indexedParts.findIndex((entry): boolean => entry.part.id === boundaryPartId);
  const startAbsoluteIndex = parent?.boundaryAbsoluteIndex ?? -1;

  return indexedParts
    .slice(startAbsoluteIndex + 1, boundaryAbsoluteIndex + 1)
    .filter((entry): boolean => entry.part.type !== 'compaction')
    .map(
      (entry): ImmutableChatPart => ({
        messageId: entry.messageId,
        part: structuredClone(entry.part)
      })
    );
}

/**
 * 按摘要生成器实际序列化文本估算完整 prompt。
 * @param snapshot - parent、增量 Part 与 boundary 的冻结快照
 * @returns 完整摘要 prompt 估算
 */
function estimateSummaryTokens(snapshot: CompactionSourceSnapshot): number {
  return estimateTextTokens(createSummaryPrompt(snapshot));
}

/**
 * 将摘要源中的 Renderer 工具 Part 全部投影为声明式历史语义。
 * @param sourceParts - 原始冻结源
 * @param rendererTools - 迁移前 Part 使用的 Runtime fallback 描述符
 * @returns 不含页面声明敏感字段和 latest-only 完整结果的摘要源 clone
 */
function projectSummarySources(sourceParts: ImmutableChatPart[], rendererTools: readonly ChatRendererToolDescriptor[] = []): ImmutableChatPart[] {
  return sourceParts.map(
    (source): ImmutableChatPart => ({
      messageId: source.messageId,
      part: projectHistoricalRendererPart(source.part, rendererTools)
    })
  );
}

/**
 * 对摘要请求中的大型工具结果执行仅投影软剪枝。
 * @param sourceParts - 原始冻结源
 * @returns 不修改输入的摘要源 clone
 */
function pruneSummarySources(sourceParts: ImmutableChatPart[]): ImmutableChatPart[] {
  return sourceParts.map((source): ImmutableChatPart => {
    if (source.part.type !== 'tool') return structuredClone(source);
    const syntheticMessage: ChatMessageRecord = {
      id: source.messageId,
      sessionId: 'compaction-source',
      role: 'assistant',
      content: '',
      parts: [structuredClone(source.part)],
      createdAt: '',
      finished: true
    };
    const prunedMessage = pruneMessageToolOutputs(syntheticMessage);

    return {
      messageId: source.messageId,
      part: structuredClone(prunedMessage?.parts[0] ?? source.part)
    };
  });
}

/**
 * 判断是否已经对相同 fingerprint 自动失败。
 * @param messages - 原始消息
 * @param sourceFingerprint - 当前规划 fingerprint
 * @returns 是否存在相同失败记录
 */
function hasFailedFingerprint(messages: ChatMessageRecord[], sourceFingerprint: string): boolean {
  return messages.some((message: ChatMessageRecord): boolean =>
    message.parts.some(
      (part: ChatMessagePart): boolean => part.type === 'compaction' && part.status === 'failed' && part.sourceFingerprint === sourceFingerprint
    )
  );
}

/**
 * 创建纯上下文压缩计划。
 * @param input - 当前消息、模型和不可压缩上下文
 * @returns ready、skipped 或 blocked 规划结果
 */
export function createCompactionPlan(input: CompactionPlanInput): CompactionPlanResult {
  if (!Number.isFinite(input.contextWindow) || input.contextWindow < 1) {
    return { status: 'blocked', errorCode: 'CONTEXT_WINDOW_UNAVAILABLE' };
  }

  const boundary = findSafeBoundary(input.messages, { currentUserMessageId: input.currentUserMessageId });
  if (!boundary) return { status: 'skipped', reason: 'NO_SAFE_BOUNDARY' };

  const parent = findParentCheckpoint(input.messages);
  const fingerprintSources = collectSourceParts(input.messages, boundary.partId, parent);
  if (fingerprintSources.length === 0) return { status: 'skipped', reason: 'NO_NEW_CONTENT' };

  let rawTailMessages = createRawTail(input.messages, boundary.messageIndex, boundary.partIndex);
  let noncompressibleTokens = estimateRequestTokens({
    system: input.system,
    tools: input.tools,
    messages: rawTailMessages,
    skillContentHashes: input.skillContentHashes
  });
  let budgetSnapshot = createCompactionBudget({
    contextWindow: input.contextWindow,
    maxOutputTokens: input.maxOutputTokens,
    noncompressibleTokens
  });
  const projection = projectContext({
    messages: input.messages,
    system: input.system,
    tools: input.tools,
    skillContentHashes: input.skillContentHashes,
    rendererTools: input.rendererTools
  });
  if (input.trigger === 'automatic' && !shouldAutoCompact(projection.estimatedTokens, budgetSnapshot)) {
    return { status: 'skipped', reason: 'BELOW_THRESHOLD' };
  }
  let activeTurnToolPruneMode: ActiveTurnToolPruneMode | undefined;
  const activeTurnPruneModes: ActiveTurnToolPruneMode[] = ['preserve-latest', 'all-complete'];
  for (const pruneMode of activeTurnPruneModes) {
    if (hasSummaryCapacity(budgetSnapshot)) break;
    const prunedRawTail = pruneActiveTurnToolOutputs(rawTailMessages, pruneMode);
    const prunedTokens = estimateRequestTokens({
      system: input.system,
      tools: input.tools,
      messages: prunedRawTail,
      skillContentHashes: input.skillContentHashes
    });
    if (prunedTokens < noncompressibleTokens) {
      rawTailMessages = prunedRawTail;
      noncompressibleTokens = prunedTokens;
      budgetSnapshot = createCompactionBudget({
        contextWindow: input.contextWindow,
        maxOutputTokens: input.maxOutputTokens,
        noncompressibleTokens
      });
      activeTurnToolPruneMode = pruneMode;
    }
  }
  if (!hasSummaryCapacity(budgetSnapshot)) {
    return { status: 'blocked', errorCode: 'NONCOMPRESSIBLE_CONTEXT_TOO_LARGE' };
  }

  const modelSnapshot: CompactionModelSnapshot = {
    ...structuredClone(input.modelSnapshot),
    contextWindow: input.contextWindow,
    maxOutputTokens: input.maxOutputTokens ?? input.modelSnapshot.maxOutputTokens
  };
  const parentCheckpointId = parent?.part.id;
  const fingerprintInput = createFingerprintInput({
    modelSnapshot,
    budgetSnapshot,
    parentCheckpointId,
    boundaryPartId: boundary.partId,
    sources: fingerprintSources.map((source): { messageId: string; part: ChatMessagePart } => structuredClone(source))
  });
  const sourceFingerprint = buildSourceFingerprint(fingerprintInput);
  if (input.trigger === 'automatic' && hasFailedFingerprint(input.messages, sourceFingerprint)) {
    return { status: 'skipped', reason: 'REPEATED_FAILURE' };
  }

  const parentSummary = parent?.part.summary ? structuredClone(parent.part.summary) : undefined;
  let summarySources = projectSummarySources(fingerprintSources, input.rendererTools);
  let sourceSnapshot: CompactionSourceSnapshot = {
    parentCheckpoint: parentSummary,
    sourceParts: summarySources,
    boundaryPartId: boundary.partId,
    sourceFingerprint
  };
  let summarySourceTokens = estimateSummaryTokens(sourceSnapshot);
  if (
    !canGenerateSummary({
      contextWindow: input.contextWindow,
      sourceTokens: summarySourceTokens,
      promptTokens: 0,
      budget: budgetSnapshot
    })
  ) {
    summarySources = pruneSummarySources(summarySources);
    sourceSnapshot = { ...sourceSnapshot, sourceParts: summarySources };
    summarySourceTokens = estimateSummaryTokens(sourceSnapshot);
  }
  if (
    !canGenerateSummary({
      contextWindow: input.contextWindow,
      sourceTokens: summarySourceTokens,
      promptTokens: 0,
      budget: budgetSnapshot
    })
  ) {
    return { status: 'blocked', errorCode: 'SUMMARY_REQUEST_TOO_LARGE' };
  }

  return {
    status: 'ready',
    plan: {
      trigger: input.trigger,
      boundaryPartId: boundary.partId,
      parentCheckpointId,
      sourceSnapshot,
      fingerprintSources,
      rawTailMessages,
      activeTurnToolPruneMode,
      modelSnapshot,
      budgetSnapshot,
      projectedTokens: projection.estimatedTokens,
      noncompressibleTokens,
      summarySourceTokens
    }
  };
}
