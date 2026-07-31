/**
 * @file projector.mts
 * @description 将持久化消息投影为 checkpoint 摘要与未压缩原始 tail，且只在投影中软剪枝旧工具结果。
 */
import type { AITransportTool } from 'types/ai';
import type { ChatMessageCompactionPart, ChatMessagePart, ChatMessageRecord } from 'types/chat';
import { invalidateStaleSkillToolResults } from '../context/model-message.mjs';
import type { ActiveTurnToolPruneMode } from '../context/tool-output-prune.mjs';
import { findToolOutputPruneProtectedStartIndex, pruneActiveTurnToolOutputs, pruneMessageToolOutputs } from '../context/tool-output-prune.mjs';
import { estimateRequestTokens } from './token-estimator.mjs';
import { indexMessageParts, validatePartTopology } from './topology.mjs';

/**
 * 上下文投影输入。
 */
export interface ContextProjectionInput {
  /** 原始持久化消息，不会被投影过程修改。 */
  messages: ChatMessageRecord[];
  /** 系统提示词，用于计算投影后的请求预算。 */
  system?: string;
  /** 当前模型可用工具，用于计算投影后的请求预算。 */
  tools?: AITransportTool[];
  /** 当前 Skill 内容版本。 */
  skillContentHashes?: Record<string, string>;
  /** 上下文高压时裁剪当前 Agent 轮次完整工具结果的级别。 */
  activeTurnToolPruneMode?: ActiveTurnToolPruneMode;
}

/**
 * 上下文投影结果。
 */
export interface ContextProjection {
  /** 供模型转换使用的消息 clone。 */
  messages: ChatMessageRecord[];
  /** 实际采用的成功 checkpoint 标识。 */
  checkpointId?: string;
  /** 完整投影请求的确定性 Token 估算。 */
  estimatedTokens: number;
}

/**
 * checkpoint 及其持久化位置。
 */
interface LocatedCheckpoint {
  /** 成功 checkpoint。 */
  checkpoint: ChatMessageCompactionPart & { status: 'success' };
  /** checkpoint 所属消息。 */
  message: ChatMessageRecord;
}

/**
 * Part 在消息拓扑中的位置。
 */
interface PartLocation {
  /** Part 所属消息索引。 */
  messageIndex: number;
  /** Part 在消息中的索引。 */
  partIndex: number;
}

/**
 * 查找拓扑有效的最新成功 checkpoint。
 * @param messages - 原始消息
 * @returns 最新有效 checkpoint，不存在时返回 undefined
 */
function findLatestCheckpoint(messages: ChatMessageRecord[]): LocatedCheckpoint | undefined {
  const topology = validatePartTopology(messages);

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (part.type !== 'compaction' || part.status !== 'success' || !topology.validCheckpointIds.has(part.id)) continue;

      return { checkpoint: part as ChatMessageCompactionPart & { status: 'success' }, message };
    }
  }

  return undefined;
}

/**
 * 查找指定 Part 的消息位置。
 * @param messages - 原始消息
 * @param partId - Part 标识
 * @returns Part 位置，不存在时返回 undefined
 */
function findPartLocation(messages: ChatMessageRecord[], partId: string): PartLocation | undefined {
  const indexed = indexMessageParts(messages).find((entry): boolean => entry.part.id === partId);

  return indexed ? { messageIndex: indexed.messageIndex, partIndex: indexed.partIndex } : undefined;
}

/**
 * 移除仅用于持久化与 UI 的 compaction Part。
 * @param message - 原始消息
 * @param startPartIndex - 需要保留的第一个 Part 索引
 * @returns 投影消息，无模型内容时返回 undefined
 */
function stripCompactionParts(message: ChatMessageRecord, startPartIndex = 0): ChatMessageRecord | undefined {
  const parts = message.parts
    .slice(startPartIndex)
    .filter((part: ChatMessagePart): boolean => part.type !== 'compaction')
    .map((part: ChatMessagePart): ChatMessagePart => structuredClone(part));
  const preservesLegacyContent = message.parts.length === 0;
  const content = parts.length > 0 || preservesLegacyContent ? message.content : '';

  if (parts.length === 0 && !content.trim()) return undefined;

  return {
    ...structuredClone(message),
    content,
    parts
  };
}

/**
 * 创建模型可见的结构化摘要合成消息。
 * @param located - checkpoint 及所属消息
 * @returns 不写入数据库的 assistant 摘要消息
 */
function createSummaryMessage(located: LocatedCheckpoint): ChatMessageRecord {
  const { checkpoint, message } = located;
  const summaryText = [
    `<context_checkpoint schema_version="${checkpoint.summary?.schemaVersion ?? 1}">`,
    JSON.stringify(checkpoint.summary),
    '</context_checkpoint>'
  ].join('\n');

  return {
    id: `context-checkpoint:${checkpoint.id}`,
    sessionId: message.sessionId,
    role: 'assistant',
    content: summaryText,
    parts: [{ id: `context-checkpoint-text:${checkpoint.id}`, type: 'text', text: summaryText }],
    createdAt: message.createdAt,
    loading: false,
    finished: true
  };
}

/**
 * 从 boundary 之后创建未压缩 tail。
 * @param messages - 原始消息
 * @param boundary - boundary 位置
 * @returns 移除 compaction Part 后的消息 tail
 */
function createRawTail(messages: ChatMessageRecord[], boundary: PartLocation): ChatMessageRecord[] {
  const tail: ChatMessageRecord[] = [];
  const { messageIndex: boundaryMessageIndex, partIndex: boundaryPartIndex } = boundary;

  for (let messageIndex = boundaryMessageIndex; messageIndex < messages.length; messageIndex += 1) {
    const startPartIndex = messageIndex === boundaryMessageIndex ? boundaryPartIndex + 1 : 0;
    const projected = stripCompactionParts(messages[messageIndex], startPartIndex);
    if (projected) tail.push(projected);
  }

  return tail;
}

/**
 * 创建不含 compaction 生命周期 Part 的完整消息 clone。
 * @param messages - 原始消息
 * @returns 模型投影消息
 */
function createRawProjection(messages: ChatMessageRecord[]): ChatMessageRecord[] {
  return messages.map((message: ChatMessageRecord): ChatMessageRecord | undefined => stripCompactionParts(message)).filter(Boolean) as ChatMessageRecord[];
}

/**
 * 仅对最近两个用户轮次之前的大型工具结果执行软剪枝。
 * @param messages - 已 clone 的模型投影消息
 * @returns 工具结果经过预算裁剪的消息
 */
function pruneProjection(messages: ChatMessageRecord[]): ChatMessageRecord[] {
  const protectedStartIndex = findToolOutputPruneProtectedStartIndex(messages);

  return messages.map((message: ChatMessageRecord, messageIndex: number): ChatMessageRecord => {
    if (messageIndex >= protectedStartIndex) return message;

    return pruneMessageToolOutputs(message) ?? message;
  });
}

/**
 * 将持久化历史投影为最新有效摘要与 boundary 后原始 tail。
 * @param input - 投影输入
 * @returns 模型上下文投影
 */
export function projectContext(input: ContextProjectionInput): ContextProjection {
  const located = findLatestCheckpoint(input.messages);
  const boundary = located?.checkpoint.boundaryPartId ? findPartLocation(input.messages, located.checkpoint.boundaryPartId) : undefined;
  const rawMessages = located && boundary ? [createSummaryMessage(located), ...createRawTail(input.messages, boundary)] : createRawProjection(input.messages);
  const skillProjectedMessages = invalidateStaleSkillToolResults(rawMessages, input.skillContentHashes);
  const oldToolPrunedMessages = pruneProjection(skillProjectedMessages);
  const messages = input.activeTurnToolPruneMode ? pruneActiveTurnToolOutputs(oldToolPrunedMessages, input.activeTurnToolPruneMode) : oldToolPrunedMessages;
  const estimatedTokens = estimateRequestTokens({
    messages,
    system: input.system,
    tools: input.tools,
    skillContentHashes: input.skillContentHashes
  });

  return {
    messages,
    checkpointId: located && boundary ? located.checkpoint.id : undefined,
    estimatedTokens
  };
}
