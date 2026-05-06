/**
 * @file coordinator.ts
 * @description 压缩流程协调层：串联 policy、planner、summarizer、assembler，管理会话级压缩状态。
 */
import type { ConversationSummaryRecord, PrepareMessagesInput, PrepareMessagesOutput, SummaryStorage } from './types';
import { findLast } from 'lodash-es';
import type { Message } from '@/components/BChatSidebar/utils/types';
import { assembleContext } from './assembler';
import { CURRENT_SCHEMA_VERSION, RECENT_ROUND_PRESERVE } from './constant';
import { planCompression } from './planner';
import { evaluateCompression } from './policy';
import { ruleTrim, truncateSummaryText } from './summarizer';
import { generateStructuredSummary, generateSummaryText } from './summaryGenerator';

/**
 * 会话级压缩锁，防止同一会话并发压缩。
 */
const sessionLocks = new Map<string, Promise<void>>();

/**
 * 获取会话锁，如果锁已被占用则等待。
 * 返回一个释放锁的函数，以及一个标志表示是否应该继续执行。
 */
async function acquireSessionLock(sessionId: string): Promise<() => void> {
  // 等待现有锁释放
  const existingLock = sessionLocks.get(sessionId);
  if (existingLock) {
    await existingLock;
  }

  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  sessionLocks.set(sessionId, lockPromise);
  return () => {
    sessionLocks.delete(sessionId);
    releaseLock!();
  };
}

/**
 * 基于摘要边界拆分穿透消息和近期原文消息。
 * @param messages - 全量消息列表
 * @param currentUserMessageId - 当前用户消息 ID
 * @param summaryRecord - 当前有效摘要
 * @returns 组装上下文所需的消息分段
 */
function splitMessagesForAssembly(
  messages: Message[],
  currentUserMessageId: string,
  summaryRecord?: ConversationSummaryRecord
): {
  preservedMessages: Message[];
  recentMessages: Message[];
} {
  const messagesWithoutCurrent = messages.filter((message) => message.id !== currentUserMessageId);
  if (!summaryRecord) {
    return {
      preservedMessages: [],
      recentMessages: messagesWithoutCurrent
    };
  }

  const preservedIdSet = new Set(summaryRecord.preservedMessageIds);
  const preservedMessages = messages.filter((message) => preservedIdSet.has(message.id));
  const coveredIndex = messages.findIndex((message) => message.id === summaryRecord.coveredUntilMessageId);
  const boundaryMessages = coveredIndex >= 0 ? messages.slice(coveredIndex + 1) : messagesWithoutCurrent;
  const recentMessages = boundaryMessages.filter((message) => {
    return message.id !== currentUserMessageId && !preservedIdSet.has(message.id);
  });

  return {
    preservedMessages,
    recentMessages
  };
}

/**
 * 生成并持久化摘要记录。
 * @param storage - 摘要存储
 * @param sessionId - 会话 ID
 * @param messages - 全量消息列表
 * @param buildMode - 摘要构建模式
 * @param triggerReason - 触发原因
 * @param currentSummary - 当前有效摘要
 * @param currentUserMessageId - 当前用户消息 ID（自动发送时排除）
 * @param excludeMessageIds - 需要显式排除的消息 ID
 * @returns 新摘要记录及对应的消息分类结果
 */
async function buildSummaryRecord(
  storage: SummaryStorage,
  sessionId: string,
  messages: Message[],
  buildMode: 'incremental' | 'full_rebuild',
  triggerReason: 'message_count' | 'context_size' | 'manual',
  currentSummary?: ConversationSummaryRecord,
  currentUserMessageId?: string,
  excludeMessageIds?: string[]
): Promise<
  | {
      summaryRecord: ConversationSummaryRecord;
      classification: ReturnType<typeof planCompression>;
    }
  | undefined
> {
  const classification = planCompression(messages, RECENT_ROUND_PRESERVE, currentUserMessageId, excludeMessageIds);
  if (classification.compressibleMessages.length === 0) {
    return undefined;
  }

  const trimmed = ruleTrim(classification.compressibleMessages);
  const structuredSummary = await generateStructuredSummary(trimmed.items);
  const summaryText = truncateSummaryText(generateSummaryText(structuredSummary));
  const compressibleIds = classification.compressibleMessages.map((message) => message.id);
  const coveredStartMessageId = compressibleIds[0];
  const coveredEndMessageId = compressibleIds[compressibleIds.length - 1];

  const preservedSet = new Set(classification.preservedMessageIds);
  const lastNonPreserved = findLast(compressibleIds, (id) => !preservedSet.has(id));
  const coveredUntilMessageId = lastNonPreserved ?? coveredEndMessageId;

  const summaryRecord = await storage.createSummary({
    sessionId,
    buildMode,
    derivedFromSummaryId: currentSummary?.id,
    coveredStartMessageId,
    coveredEndMessageId,
    coveredUntilMessageId,
    sourceMessageIds: compressibleIds.filter((id) => !preservedSet.has(id)),
    preservedMessageIds: classification.preservedMessageIds,
    summaryText,
    structuredSummary,
    triggerReason,
    messageCountSnapshot: Math.ceil(messages.filter((message) => message.role === 'user' || message.role === 'assistant').length / 2),
    charCountSnapshot: trimmed.charCount,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    status: 'valid',
    invalidReason: undefined
  });

  if (currentSummary && currentSummary.id !== summaryRecord.id) {
    await storage.updateSummaryStatus(currentSummary.id, 'superseded');
  }

  return {
    summaryRecord,
    classification
  };
}

/**
 * 组装上下文并返回统一结果格式。
 * @param messages - 全量消息
 * @param currentUserMessage - 当前用户消息
 * @param summaryRecord - 摘要记录
 * @param compressed - 是否已压缩
 * @returns 组装后的上下文输出
 */
function assembleAndReturn(
  messages: Message[],
  currentUserMessage: Message,
  summaryRecord: ConversationSummaryRecord | undefined,
  compressed: boolean
): PrepareMessagesOutput {
  const { preservedMessages, recentMessages } = splitMessagesForAssembly(messages, currentUserMessage.id, summaryRecord);
  const assembled = assembleContext({
    summaryRecord,
    preservedMessages,
    recentMessages,
    currentUserMessage
  });
  return {
    modelMessages: assembled.modelMessages,
    compressed
  };
}

/**
 * 创建压缩协调器。
 * @param storage - 摘要存储层接口
 * @returns 协调器对象
 */
export function createCompressionCoordinator(storage: SummaryStorage) {
  return {
    /**
     * 准备发送前的消息上下文。
     * 根据双阈值判断是否压缩，执行压缩流程，失败时降级到原始上下文。
     * @param input - 准备参数
     * @returns 组装后的模型消息列表和压缩标记
     */
    async prepareMessagesBeforeSend(input: PrepareMessagesInput): Promise<PrepareMessagesOutput> {
      const { sessionId, messages, currentUserMessage, excludeMessageIds } = input;

      // 获取当前有效摘要
      const currentSummary = await storage.getValidSummary(sessionId);

      // 判断是否需要压缩
      const policyResult = evaluateCompression(messages, currentSummary);

      // 如果不需要压缩，直接组装原始上下文
      if (!policyResult.shouldCompress) {
        return assembleAndReturn(messages, currentUserMessage, currentSummary, false);
      }

      // 需要压缩，获取会话锁
      const releaseLock = await acquireSessionLock(sessionId);

      try {
        // 再次检查是否需要压缩（可能在等待锁期间已被其他请求压缩）
        const latestSummary = await storage.getValidSummary(sessionId);
        const latestPolicy = evaluateCompression(messages, latestSummary);

        if (!latestPolicy.shouldCompress) {
          return assembleAndReturn(messages, currentUserMessage, latestSummary, false);
        }

        // 执行压缩流程
        try {
          const summaryResult = await buildSummaryRecord(
            storage,
            sessionId,
            messages,
            'incremental',
            policyResult.triggerReason,
            latestSummary,
            currentUserMessage.id,
            excludeMessageIds
          );

          if (!summaryResult) {
            return assembleAndReturn(messages, currentUserMessage, latestSummary, false);
          }

          const savedSummary = summaryResult.summaryRecord;
          return assembleAndReturn(messages, currentUserMessage, savedSummary, true);
        } catch (error) {
          // 压缩失败，降级到原始上下文
          console.error('[压缩] 压缩上下文失败:', error);
          return assembleAndReturn(messages, currentUserMessage, currentSummary, false);
        }
      } finally {
        releaseLock();
      }
    },

    /**
     * 手动触发会话压缩。
     * @param input - 压缩输入参数
     * @returns 新生成的摘要记录；无可压缩内容时返回 undefined
     */
    async compressSessionManually(input: { sessionId: string; messages: Message[] }): Promise<ConversationSummaryRecord | undefined> {
      const { sessionId, messages } = input;
      const releaseLock = await acquireSessionLock(sessionId);

      try {
        const currentSummary = await storage.getValidSummary(sessionId);
        const summaryResult = await buildSummaryRecord(storage, sessionId, messages, 'full_rebuild', 'manual', currentSummary);
        return summaryResult?.summaryRecord;
      } finally {
        releaseLock();
      }
    }
  };
}
