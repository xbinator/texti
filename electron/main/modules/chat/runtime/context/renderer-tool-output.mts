/**
 * @file renderer-tool-output.mts
 * @description 按工具调用携带的声明式策略投影 Renderer 工具历史。
 */
import type { AIToolExecutionResult } from 'types/ai';
import type { ChatMessagePart, ChatMessageRecord, ChatMessageToolPart } from 'types/chat';
import type { ChatRendererToolDescriptor, ChatRendererToolHistoryPolicy } from 'types/chat-runtime';

/** Renderer 历史结果默认占位说明。 */
const DEFAULT_HISTORY_PLACEHOLDER = 'Previous tool result omitted. Call the tool again if current data is required.';

/** 禁止参与自有属性遍历的路径片段。 */
const FORBIDDEN_PATH_SEGMENTS = new Set<string>(['__proto__', 'prototype', 'constructor']);

/** 工具 Part 在消息列表中的位置。 */
interface ToolPartLocation {
  /** 消息索引。 */
  readonly messageIndex: number;
  /** Part 索引。 */
  readonly partIndex: number;
}

/**
 * 判断路径是否可以安全遍历自有属性。
 * @param path - 声明式点路径
 * @returns 是否为安全路径
 */
function isSafePath(path: string): boolean {
  if (!path || path.length > 256) return false;
  const segments = path.split('.');
  return segments.every((segment: string): boolean => Boolean(segment) && !FORBIDDEN_PATH_SEGMENTS.has(segment) && /^[A-Za-z0-9_$-]+$/.test(segment));
}

/**
 * 从克隆输入中删除单条自有属性路径。
 * @param input - 已克隆工具输入
 * @param path - 待删除点路径
 */
function redactOwnPath(input: unknown, path: string): void {
  if (!isSafePath(path) || (typeof input !== 'object' && typeof input !== 'function') || input === null) return;
  const segments = path.split('.');
  let target: object = input;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!Object.prototype.hasOwnProperty.call(target, segment)) return;
    const next = Reflect.get(target, segment);
    if ((typeof next !== 'object' && typeof next !== 'function') || next === null) return;
    target = next;
  }

  const finalSegment = segments[segments.length - 1];
  if (finalSegment && Object.prototype.hasOwnProperty.call(target, finalSegment)) Reflect.deleteProperty(target, finalSegment);
}

/**
 * 创建工具名到 Runtime fallback 策略的索引。
 * @param descriptors - 当前 Runtime Renderer 工具描述符
 * @returns 历史策略索引
 */
function createPolicyIndex(descriptors: readonly ChatRendererToolDescriptor[]): Map<string, ChatRendererToolHistoryPolicy> {
  const policies = new Map<string, ChatRendererToolHistoryPolicy>();
  descriptors.forEach((descriptor: ChatRendererToolDescriptor): void => {
    if (descriptor.history && !policies.has(descriptor.name)) policies.set(descriptor.name, descriptor.history);
  });
  return policies;
}

/**
 * 解析单个工具 Part 的权威历史策略。
 * @param part - 工具 Part
 * @param fallbackPolicies - 迁移前消息使用的 Runtime 策略
 * @returns 当前 Part 的策略
 */
function resolveHistory(
  part: ChatMessageToolPart,
  fallbackPolicies: ReadonlyMap<string, ChatRendererToolHistoryPolicy>
): ChatRendererToolHistoryPolicy | undefined {
  return part.rendererHistory ?? fallbackPolicies.get(part.toolName);
}

/**
 * 创建旧工具结果的通用占位结果。
 * @param result - 原始工具结果
 * @param placeholder - 页面声明的占位说明
 * @returns 不含原始结果正文的工具结果
 */
function pruneResult(result: AIToolExecutionResult, placeholder: string): AIToolExecutionResult {
  if (result.status === 'success') {
    return {
      ...result,
      data: { pruned: true, pruneReason: 'renderer_history_latest_only', summary: placeholder }
    };
  }
  if (result.status === 'failure' || result.status === 'cancelled') {
    return { ...result, error: { code: result.error.code, message: placeholder } };
  }
  return result;
}

/**
 * 收集每个 latest-only 工具最后一个完整终态结果的位置。
 * @param messages - 已克隆模型投影消息
 * @param fallbackPolicies - Runtime fallback 策略
 * @returns 工具名到最后位置的索引
 */
function findLatestLocations(
  messages: ChatMessageRecord[],
  fallbackPolicies: ReadonlyMap<string, ChatRendererToolHistoryPolicy>
): Map<string, ToolPartLocation> {
  const locations = new Map<string, ToolPartLocation>();
  messages.forEach((message: ChatMessageRecord, messageIndex: number): void => {
    message.parts.forEach((part: ChatMessagePart, partIndex: number): void => {
      if (part.type !== 'tool' || part.status !== 'done' || !part.result || part.result.status === 'awaiting_user_input') return;
      if (resolveHistory(part, fallbackPolicies)?.mode === 'latest-only') locations.set(part.toolName, { messageIndex, partIndex });
    });
  });
  return locations;
}

/**
 * 判断两个工具 Part 位置是否相同。
 * @param location - 最新完整结果位置
 * @param messageIndex - 当前消息索引
 * @param partIndex - 当前 Part 索引
 * @returns 是否为同一位置
 */
function isSameLocation(location: ToolPartLocation | undefined, messageIndex: number, partIndex: number): boolean {
  return location?.messageIndex === messageIndex && location.partIndex === partIndex;
}

/**
 * 将单个 Renderer 工具 Part 作为历史摘要源投影。
 * @param part - 原始消息 Part
 * @param descriptors - 迁移前 Part 使用的 Runtime fallback 描述符
 * @returns 不含声明式敏感输入与 latest-only 完整结果的 clone
 */
export function projectHistoricalRendererPart(part: ChatMessagePart, descriptors: readonly ChatRendererToolDescriptor[] = []): ChatMessagePart {
  const cloned = structuredClone(part);
  if (cloned.type !== 'tool') return cloned;
  const history = resolveHistory(cloned, createPolicyIndex(descriptors));
  if (!history) return cloned;
  const input = structuredClone(cloned.input);
  history.redactInputPaths?.slice(0, 32).forEach((path: string): void => redactOwnPath(input, path));
  const safePart: ChatMessageToolPart = { ...cloned, input };
  delete safePart.inputText;
  delete safePart.providerMetadata;
  delete safePart.shellOutput;
  delete safePart.shellRunState;
  if (history.mode === 'latest-only' && safePart.status === 'done' && safePart.result && safePart.result.status !== 'awaiting_user_input') {
    return {
      ...safePart,
      result: pruneResult(safePart.result, history.placeholder?.slice(0, 500) || DEFAULT_HISTORY_PLACEHOLDER)
    };
  }
  return safePart;
}

/**
 * 投影 Renderer 工具历史，不修改持久化输入。
 * @param messages - 原始消息
 * @param descriptors - 当前 Runtime 描述符，用于迁移前消息回退
 * @returns 已脱敏并按策略裁剪的消息 clone
 */
export function projectRendererToolOutputs(messages: ChatMessageRecord[], descriptors: readonly ChatRendererToolDescriptor[] = []): ChatMessageRecord[] {
  const projected = structuredClone(messages);
  const fallbackPolicies = createPolicyIndex(descriptors);
  const latestLocations = findLatestLocations(projected, fallbackPolicies);

  return projected.map(
    (message: ChatMessageRecord, messageIndex: number): ChatMessageRecord => ({
      ...message,
      parts: message.parts.map((part: ChatMessagePart, partIndex: number): ChatMessagePart => {
        if (part.type !== 'tool') return part;
        const history = resolveHistory(part, fallbackPolicies);
        if (!history) return part;
        const input = structuredClone(part.input);
        history.redactInputPaths?.slice(0, 32).forEach((path: string): void => redactOwnPath(input, path));
        const safePart: ChatMessageToolPart = {
          ...part,
          input
        };
        delete safePart.inputText;
        delete safePart.providerMetadata;
        delete safePart.shellOutput;
        delete safePart.shellRunState;

        if (
          history.mode !== 'latest-only' ||
          safePart.status !== 'done' ||
          !safePart.result ||
          safePart.result.status === 'awaiting_user_input' ||
          isSameLocation(latestLocations.get(safePart.toolName), messageIndex, partIndex)
        ) {
          return safePart;
        }

        return {
          ...safePart,
          result: pruneResult(safePart.result, history.placeholder?.slice(0, 500) || DEFAULT_HISTORY_PLACEHOLDER)
        };
      })
    })
  );
}
