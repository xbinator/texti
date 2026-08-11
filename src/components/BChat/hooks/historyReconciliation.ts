/**
 * @file historyReconciliation.ts
 * @description 协调持久历史快照与 Runtime 实时消息的 revision 竞争。
 */
import type { Message } from '../utils/types';
import type { ChatMessagePart, ChatMessageToolPart } from 'types/chat';
import type { ChatRuntimeMessageDelta } from 'types/chat-runtime';
import { keyBy } from 'lodash-es';
import { userChoice } from '../utils/messageHelper';
import { applyMutations, validateMutations } from './liveMessageProjection';

/** Renderer 实际接收的带可选 Runtime 身份的增量。 */
export interface RuntimeAddressedDelta extends ChatRuntimeMessageDelta {
  /** 产生增量的具体 Runtime 身份。 */
  runtimeId?: string;
}

/** 单条 Assistant 在一个具体 Runtime 内的修订位置。 */
export interface RuntimeMessageRevision {
  /** 产生该修订号的 Runtime；旧事件可能暂时缺失。 */
  runtimeId?: string;
  /** Runtime 内单调递增修订号。 */
  revision: number;
}

/** 历史快照与实时事件的竞争状态。 */
export interface HistoryReconciliationState {
  /** Renderer 本地单调变更序号。 */
  messageRevision: number;
  /** 每条消息最近实时写入序号。 */
  liveMessageRevisions: Map<string, number>;
  /** 每条消息最近实时删除序号。 */
  deletedMessageRevisions: Map<string, number>;
  /** 每条活跃 Assistant 最近应用的 Main Runtime 修订位置。 */
  runtimeMessageRevisions: Map<string, RuntimeMessageRevision>;
}

/**
 * 创建空的历史竞争状态。
 * @returns 可跨历史请求保留的状态
 */
export function createHistoryState(): HistoryReconciliationState {
  return {
    messageRevision: 0,
    liveMessageRevisions: new Map<string, number>(),
    deletedMessageRevisions: new Map<string, number>(),
    runtimeMessageRevisions: new Map<string, RuntimeMessageRevision>()
  };
}

/**
 * 归一化从持久化层读取的消息状态。
 * @param loadedMessages - 持久消息
 * @returns 可直接展示的消息
 */
export function normalizeLoadedMessages(loadedMessages: Message[]): Message[] {
  return loadedMessages.map(userChoice.normalizePendingState);
}

/**
 * 在 Main 权威消息更新中保留执行中 Shell 的 Renderer 临时状态。
 * @param current - Renderer 当前消息
 * @param next - Runtime 最新消息
 * @returns 只补回缺失 Shell 临时字段的最新消息
 */
function preserveShellState(current: Message, next: Message): Message {
  const currentTools = keyBy(
    current.parts.filter((part: ChatMessagePart): part is ChatMessageToolPart => part.type === 'tool' && part.toolName === 'run_shell_command'),
    'toolCallId'
  );
  const parts = next.parts.map((part: ChatMessagePart): ChatMessagePart => {
    if (part.type !== 'tool' || part.toolName !== 'run_shell_command' || part.status === 'done') return part;
    const previous = currentTools[part.toolCallId];
    if (!previous) return part;
    return {
      ...part,
      ...(part.shellOutput === undefined && previous.shellOutput !== undefined ? { shellOutput: previous.shellOutput } : {}),
      ...(part.shellRunState === undefined && previous.shellRunState !== undefined ? { shellRunState: previous.shellRunState } : {})
    };
  });
  return { ...next, parts };
}

/**
 * 用持久消息显式替换当前会话并推进本地序号。
 * @param state - 历史竞争状态
 * @param currentMessages - 替换前当前消息
 * @param loadedMessages - 持久化消息
 * @returns 归一化后的新消息列表
 */
export function replaceLoadedMessages(state: HistoryReconciliationState, currentMessages: Message[], loadedMessages: Message[]): Message[] {
  const normalizedMessages = normalizeLoadedMessages(loadedMessages);
  const nextIds = new Set(normalizedMessages.map((message: Message): string => message.id));
  state.messageRevision += 1;
  currentMessages.forEach((message: Message): void => {
    if (nextIds.has(message.id)) return;
    state.liveMessageRevisions.delete(message.id);
    state.deletedMessageRevisions.set(message.id, state.messageRevision);
  });
  normalizedMessages.forEach((message: Message): void => {
    state.liveMessageRevisions.set(message.id, state.messageRevision);
    state.deletedMessageRevisions.delete(message.id);
  });
  state.runtimeMessageRevisions.clear();
  return normalizedMessages;
}

/**
 * 清理已被持久快照吸收的本地竞争序号。
 * @param revisions - 实时写入或删除序号
 * @param baselineRevision - 历史请求发起时序号
 */
function pruneHistoryRevisions(revisions: Map<string, number>, baselineRevision: number): void {
  [...revisions.entries()].forEach(([messageId, revision]: [string, number]): void => {
    if (revision <= baselineRevision) revisions.delete(messageId);
  });
}

/**
 * 合并持久历史，并让请求发起后的实时消息与删除事件胜出。
 * @param state - 历史竞争状态
 * @param currentMessages - 当前 Renderer 消息
 * @param loadedMessages - 持久层返回的消息
 * @param baselineRevision - 历史请求发起时序号
 * @returns 合并后消息
 */
export function mergeLoadedMessages(
  state: HistoryReconciliationState,
  currentMessages: Message[],
  loadedMessages: Message[],
  baselineRevision: number
): Message[] {
  const normalizedMessages = normalizeLoadedMessages(loadedMessages);
  if (state.messageRevision === baselineRevision) {
    state.liveMessageRevisions.clear();
    state.deletedMessageRevisions.clear();
    return normalizedMessages;
  }

  const currentById = new Map(currentMessages.map((message: Message): [string, Message] => [message.id, message]));
  const loadedIds = new Set(normalizedMessages.map((message: Message): string => message.id));
  const mergedMessages = normalizedMessages
    .filter((message: Message): boolean => (state.deletedMessageRevisions.get(message.id) ?? -1) <= baselineRevision)
    .map(
      (message: Message): Message => ((state.liveMessageRevisions.get(message.id) ?? -1) > baselineRevision ? currentById.get(message.id) ?? message : message)
    );
  const appendedLiveMessages = currentMessages.filter(
    (message: Message): boolean => !loadedIds.has(message.id) && (state.liveMessageRevisions.get(message.id) ?? -1) > baselineRevision
  );
  pruneHistoryRevisions(state.liveMessageRevisions, baselineRevision);
  pruneHistoryRevisions(state.deletedMessageRevisions, baselineRevision);
  return [...mergedMessages, ...appendedLiveMessages];
}

/**
 * 判断权威检查点是否来自替换 Runtime。
 * @param current - 当前 Runtime 修订位置
 * @param nextMessage - 新检查点
 * @returns 是否需要重置 Runtime 内修订号
 */
function hasRuntimeChanged(current: RuntimeMessageRevision | undefined, nextMessage: Message): boolean {
  return current !== undefined && nextMessage.runtimeId !== undefined && current.runtimeId !== nextMessage.runtimeId;
}

/**
 * 记录已接受权威检查点的 Runtime 修订位置。
 * @param state - 历史竞争状态
 * @param nextMessage - 新检查点
 * @param runtimeRevision - Runtime 内修订号
 * @param runtimeChanged - 是否来自替换 Runtime
 */
function recordRuntimeRevision(state: HistoryReconciliationState, nextMessage: Message, runtimeRevision: number | undefined, runtimeChanged: boolean): void {
  const currentRevision = state.runtimeMessageRevisions.get(nextMessage.id);
  if (runtimeRevision === undefined && !runtimeChanged && (currentRevision !== undefined || nextMessage.runtimeId === undefined)) return;
  state.runtimeMessageRevisions.set(nextMessage.id, {
    ...(nextMessage.runtimeId ? { runtimeId: nextMessage.runtimeId } : {}),
    revision: runtimeRevision ?? 0
  });
}

/**
 * 新增或合并一条 Runtime 实时消息并推进竞争序号。
 * @param state - 历史竞争状态
 * @param messages - 可原位更新的 Renderer 消息列表
 * @param nextMessage - Runtime 最新消息
 * @param runtimeRevision - Runtime 内修订号
 */
export function upsertLiveMessage(state: HistoryReconciliationState, messages: Message[], nextMessage: Message, runtimeRevision?: number): void {
  const currentRuntimeRevision = state.runtimeMessageRevisions.get(nextMessage.id);
  const runtimeChanged = hasRuntimeChanged(currentRuntimeRevision, nextMessage);
  if (runtimeRevision !== undefined && currentRuntimeRevision !== undefined && !runtimeChanged && runtimeRevision < currentRuntimeRevision.revision) return;
  state.messageRevision += 1;
  state.liveMessageRevisions.set(nextMessage.id, state.messageRevision);
  state.deletedMessageRevisions.delete(nextMessage.id);
  recordRuntimeRevision(state, nextMessage, runtimeRevision, runtimeChanged);

  const normalizedMessage = userChoice.normalizePendingState(nextMessage);
  const index = messages.findIndex((message: Message): boolean => message.id === normalizedMessage.id);
  if (index < 0) messages.push(normalizedMessage);
  else {
    const mergedMessage = preserveShellState(messages[index], normalizedMessage);
    messages.splice(index, 1, { ...messages[index], ...mergedMessage });
  }
}

/**
 * 删除一条 Runtime 实时消息并记录防止旧历史将其复活的序号。
 * @param state - 历史竞争状态
 * @param messages - 可原位更新的 Renderer 消息列表
 * @param messageId - 待删除消息 ID
 */
export function removeLiveMessage(state: HistoryReconciliationState, messages: Message[], messageId: string): void {
  state.messageRevision += 1;
  state.liveMessageRevisions.delete(messageId);
  state.deletedMessageRevisions.set(messageId, state.messageRevision);
  state.runtimeMessageRevisions.delete(messageId);
  const index = messages.findIndex((message: Message): boolean => message.id === messageId);
  if (index >= 0) messages.splice(index, 1);
}

/**
 * 判断增量是否紧接当前 Runtime 修订位置。
 * @param current - 当前 Runtime 修订位置
 * @param delta - 待应用增量
 * @returns 修订号与 Runtime 身份均连续时返回 true
 */
function isContinuousDelta(current: RuntimeMessageRevision | undefined, delta: RuntimeAddressedDelta): current is RuntimeMessageRevision {
  if (!current || current.revision !== delta.baseRevision || delta.revision <= delta.baseRevision) return false;
  return delta.runtimeId === undefined || current.runtimeId === undefined || delta.runtimeId === current.runtimeId;
}

/**
 * 连续应用 Main Runtime 的小型 Assistant 增量并推进竞争序号。
 * @param state - 历史竞争状态
 * @param messages - 可原位更新的 Renderer 消息列表
 * @param delta - 带消息修订号的追加变更
 * @returns 增量已完整应用时返回 true
 */
export function applyRuntimeDelta(state: HistoryReconciliationState, messages: Message[], delta: RuntimeAddressedDelta): boolean {
  const runtimeRevision = state.runtimeMessageRevisions.get(delta.messageId);
  const message = messages.find((candidate: Message): boolean => candidate.id === delta.messageId);
  if (!message || !isContinuousDelta(runtimeRevision, delta) || !validateMutations(message, delta.mutations)) return false;

  applyMutations(message, delta.mutations);
  message.finished = false;
  state.runtimeMessageRevisions.set(delta.messageId, {
    ...(delta.runtimeId ?? runtimeRevision.runtimeId ? { runtimeId: delta.runtimeId ?? runtimeRevision.runtimeId } : {}),
    revision: delta.revision
  });
  state.messageRevision += 1;
  state.liveMessageRevisions.set(delta.messageId, state.messageRevision);
  state.deletedMessageRevisions.delete(delta.messageId);
  return true;
}
