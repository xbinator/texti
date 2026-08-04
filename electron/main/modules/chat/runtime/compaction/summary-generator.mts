/**
 * @file summary-generator.mts
 * @description 使用当前会话模型从冻结源生成结构化上下文摘要。
 */
import type { CompactionSourceSnapshot } from './types.mjs';
import type { ChatModelResolution } from '../model/resolver.mjs';
import type { AICreateOptions, AIInvokeResult, AIRequestOptions, AIServiceError, AIUsage } from 'types/ai';
import type { CompactionBudgetSnapshot, CompactionModelSnapshot, CompactionValidationErrorCode, StructuredContextSummary } from 'types/chat';
import { structuredSummarySchema, validateStructuredSummary } from './summary-schema.mjs';

/** 摘要生成失败码。 */
export type SummaryGenerationErrorCode = 'MODEL_NOT_FOUND' | 'MODEL_RESOLUTION_FAILED' | 'MODEL_CALL_FAILED' | 'SCHEMA_INVALID';

/**
 * 摘要生成输入。
 */
export interface SummaryGenerationInput {
  /** 当前 Runtime ID，同时作为 AI 请求 ID。 */
  runtimeId: string;
  /** 当前模型上下文窗口。 */
  contextWindow?: number;
  /** 当前模型默认最大输出 Token。 */
  maxOutputTokens?: number;
  /** 已冻结的压缩预算。 */
  budgetSnapshot: CompactionBudgetSnapshot;
  /** 插入 pending 前冻结的摘要源。 */
  sourceSnapshot: CompactionSourceSnapshot;
}

/**
 * 摘要生成依赖。
 */
export interface SummaryGeneratorDependencies {
  /** 解析当前会话选中的模型。 */
  resolveModel: () => Promise<ChatModelResolution | null>;
  /** 调用 AI SDK 同步结构化生成。 */
  generateText: (createOptions: AICreateOptions, request: AIRequestOptions) => Promise<[AIServiceError] | [undefined, AIInvokeResult]>;
}

/** 摘要生成结果。 */
export type SummaryGenerationResult =
  | {
      status: 'success';
      summary: StructuredContextSummary;
      modelSnapshot: CompactionModelSnapshot;
      usage?: AIUsage;
      /** 是否因首次校验失败执行过一次修复重试。 */
      repairAttempted?: true;
      /** 触发修复重试的脱敏校验子错误码。 */
      validationErrorCode?: CompactionValidationErrorCode;
    }
  | {
      status: 'failed';
      errorCode: SummaryGenerationErrorCode;
      /** 是否执行过一次修复重试。 */
      repairAttempted?: true;
      /** 最后一次摘要校验的脱敏子错误码。 */
      validationErrorCode?: CompactionValidationErrorCode;
    };

/** 单次模型摘要调用结果。 */
type SummaryInvokeResult = { status: 'success'; output: unknown; usage?: AIUsage } | { status: 'failed' };

/** 校验失败后的定向修复提示。 */
const REPAIR_HINTS: Record<CompactionValidationErrorCode, string> = {
  INVALID_SHAPE: '严格输出 schema 要求的全部根字段和字段类型，不得增加额外字段；必填字符串和 sourcePartIds 不得为空。',
  INVALID_REFERENCE: '逐项检查所有 sourcePartIds，只能逐字复制输入中实际存在的 Part ID，不得生成、缩写或改写 ID。',
  INVALID_OBJECTIVE_RELATION:
    '确保 objective.id 唯一；activeObjectiveId 只能指向 active 目标；parentId 和 supersededById 必须指向其他已存在目标，superseded 目标必须包含 supersededById。'
};

/**
 * 创建脱敏模型快照。
 * @param resolution - 当前模型解析结果
 * @param input - 摘要生成输入
 * @returns 不含 secret 的模型快照
 */
function createModelSnapshot(resolution: ChatModelResolution, input: SummaryGenerationInput): CompactionModelSnapshot {
  return {
    providerType: resolution.createOptions.providerType,
    providerId: resolution.createOptions.providerId,
    modelId: resolution.modelId,
    contextWindow: input.contextWindow,
    maxOutputTokens: input.maxOutputTokens
  };
}

/**
 * 收集 parent summary 中保留的历史证据 Part ID。
 * @param summary - 上一个成功 checkpoint 摘要
 * @returns 历史证据 Part ID
 */
function collectParentSources(summary: StructuredContextSummary | undefined): string[] {
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
 * 创建结构化摘要提示词。
 * @param snapshot - 插入 pending 前冻结的摘要源
 * @returns 模型提示词
 */
export function createSummaryPrompt(snapshot: CompactionSourceSnapshot): string {
  const source = {
    previousSummary: snapshot.parentCheckpoint,
    sourceParts: snapshot.sourceParts,
    boundaryPartId: snapshot.boundaryPartId
  };

  return [
    '将给定历史上下文压缩为结构化 checkpoint。',
    '同一目标被细化时更新原目标；明确替换目标时标记 superseded 并连接 supersededById。',
    '每个 objective 必须保留明确 successCriteria。pendingActions.owner 表示执行者，openQuestions.owner 表示回答者。',
    'ArtifactState.id 是稳定身份，path 只是可变当前位置；不要按文件名猜测移动关系。',
    '所有 sourcePartIds 只能引用输入中的 Part ID。不要添加输入之外的事实。',
    JSON.stringify(source)
  ].join('\n\n');
}

/**
 * 创建结构化摘要修复提示词。
 * @param snapshot - 与首次调用完全相同的冻结摘要源
 * @param errorCode - 首次运行时校验的脱敏子错误码
 * @returns 要求重新生成完整摘要的修复提示词
 */
function createRepairPrompt(snapshot: CompactionSourceSnapshot, errorCode: CompactionValidationErrorCode): string {
  return [
    createSummaryPrompt(snapshot),
    `上一次完整输出未通过 Tibis 校验，错误码为 ${errorCode}。`,
    REPAIR_HINTS[errorCode],
    '请重新生成完整的结构化 checkpoint，不要解释错误，也不要输出 Markdown。'
  ].join('\n\n');
}

/**
 * 合并两次摘要调用的 Token 使用量。
 * @param first - 首次调用使用量
 * @param second - 修复调用使用量
 * @returns 合计使用量；两次均缺失时返回 undefined
 */
function mergeUsage(first?: AIUsage, second?: AIUsage): AIUsage | undefined {
  if (!first && !second) return undefined;

  return {
    inputTokens: (first?.inputTokens ?? 0) + (second?.inputTokens ?? 0),
    outputTokens: (first?.outputTokens ?? 0) + (second?.outputTokens ?? 0),
    totalTokens: (first?.totalTokens ?? 0) + (second?.totalTokens ?? 0)
  };
}

/**
 * 执行单次结构化摘要模型调用。
 * @param input - 冻结摘要输入
 * @param resolution - 已解析的当前模型
 * @param prompt - 首次或修复提示词
 * @param dependencies - 摘要生成依赖
 * @returns 结构化输出或稳定调用失败标记
 */
async function invokeSummary(
  input: SummaryGenerationInput,
  resolution: ChatModelResolution,
  prompt: string,
  dependencies: SummaryGeneratorDependencies
): Promise<SummaryInvokeResult> {
  const request: AIRequestOptions = {
    requestId: input.runtimeId,
    modelId: resolution.modelId,
    prompt,
    maxOutputTokens: input.budgetSnapshot.summaryMaxTokens,
    output: {
      schema: structuredSummarySchema,
      name: 'context_compaction',
      description: 'Tibis rolling context checkpoint'
    }
  };
  const [generationResult] = await Promise.allSettled([dependencies.generateText(resolution.createOptions, request)]);
  if (generationResult.status === 'rejected') return { status: 'failed' };

  const [serviceError, invokeResult] = generationResult.value;
  if (serviceError || !invokeResult) return { status: 'failed' };

  return {
    status: 'success',
    output: invokeResult.output,
    ...(invokeResult.totalUsage ? { usage: invokeResult.totalUsage } : {})
  };
}

/**
 * 使用当前会话模型生成结构化摘要。
 * @param input - 冻结源和预算
 * @param dependencies - 模型解析与生成依赖
 * @returns 成功摘要或稳定失败码
 */
export async function generateStructuredSummary(input: SummaryGenerationInput, dependencies: SummaryGeneratorDependencies): Promise<SummaryGenerationResult> {
  const [resolutionResult] = await Promise.allSettled([dependencies.resolveModel()]);
  if (resolutionResult.status === 'rejected') return { status: 'failed', errorCode: 'MODEL_RESOLUTION_FAILED' };
  if (!resolutionResult.value) return { status: 'failed', errorCode: 'MODEL_NOT_FOUND' };

  const resolution = resolutionResult.value;
  const modelSnapshot = createModelSnapshot(resolution, input);
  const allowedPartIds = new Set<string>([
    ...input.sourceSnapshot.sourceParts.map((sourcePart) => sourcePart.part.id),
    ...collectParentSources(input.sourceSnapshot.parentCheckpoint)
  ]);
  const firstInvocation = await invokeSummary(input, resolution, createSummaryPrompt(input.sourceSnapshot), dependencies);
  if (firstInvocation.status === 'failed') return { status: 'failed', errorCode: 'MODEL_CALL_FAILED' };

  const firstValidation = validateStructuredSummary(firstInvocation.output, allowedPartIds);
  if (firstValidation.ok) {
    return {
      status: 'success',
      summary: firstValidation.summary,
      modelSnapshot,
      ...(firstInvocation.usage ? { usage: firstInvocation.usage } : {})
    };
  }

  // Provider 兼容模式可能只把 JSON Schema 注入提示词；首次语义校验失败时仅定向重试一次，避免无限调用。
  const repairInvocation = await invokeSummary(input, resolution, createRepairPrompt(input.sourceSnapshot, firstValidation.errorCode), dependencies);
  if (repairInvocation.status === 'failed') return { status: 'failed', errorCode: 'MODEL_CALL_FAILED', repairAttempted: true };

  const repairValidation = validateStructuredSummary(repairInvocation.output, allowedPartIds);
  if (!repairValidation.ok) {
    return {
      status: 'failed',
      errorCode: 'SCHEMA_INVALID',
      repairAttempted: true,
      validationErrorCode: repairValidation.errorCode
    };
  }

  const usage = mergeUsage(firstInvocation.usage, repairInvocation.usage);

  return {
    status: 'success',
    summary: repairValidation.summary,
    modelSnapshot,
    ...(usage ? { usage } : {}),
    repairAttempted: true,
    validationErrorCode: firstValidation.errorCode
  };
}
