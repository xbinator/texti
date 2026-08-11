/**
 * @file runtime-event-test-utils.ts
 * @description BChat runtime 事件监听器测试工具。
 */
import type {
  ChatRuntimeBridgeRequestEvent,
  ChatRuntimeConfirmationRequestEvent,
  ChatRuntimeContextUsageEvent,
  ChatRuntimeEventMap,
  ChatRuntimeMessageDeletedEvent,
  ChatRuntimeMessageDeltaEvent,
  ChatRuntimeMessageEvent,
  ChatRuntimeToolRequestEvent
} from 'types/chat-runtime';

/** Runtime 事件监听器集合。 */
export interface RuntimeEventListeners {
  /** 消息创建监听器。 */
  messageCreated?: (event: ChatRuntimeMessageEvent) => void;
  /** 消息更新监听器。 */
  messageUpdated?: (event: ChatRuntimeMessageEvent) => void;
  /** Assistant 实时增量监听器。 */
  messageDelta?: (event: ChatRuntimeMessageDeltaEvent) => void;
  /** 消息删除监听器。 */
  messageDeleted?: (event: ChatRuntimeMessageDeletedEvent) => void;
  /** 上下文用量监听器。 */
  contextUsage?: (event: ChatRuntimeContextUsageEvent) => void;
  /** 完成监听器。 */
  complete?: (event: ChatRuntimeEventMap['chat:runtime:complete']) => void;
  /** 错误监听器。 */
  error?: (event: ChatRuntimeEventMap['chat:runtime:error']) => void;
  /** 工具请求监听器。 */
  toolRequest?: (event: ChatRuntimeToolRequestEvent) => void;
  /** 确认请求监听器。 */
  confirmationRequest?: (event: ChatRuntimeConfirmationRequestEvent) => void;
  /** Bridge 请求监听器。 */
  bridgeRequest?: (event: ChatRuntimeBridgeRequestEvent) => void;
}

/** Runtime 事件 key。 */
export type RuntimeEventListenerKey = keyof RuntimeEventListeners;

/** Runtime 事件载荷。 */
type RuntimeEventPayload<TKey extends RuntimeEventListenerKey> = Parameters<NonNullable<RuntimeEventListeners[TKey]>>[0];

/**
 * 创建 runtime 事件监听器集合。
 * @returns 空监听器集合
 */
export function createRuntimeEventListeners(): RuntimeEventListeners {
  return {};
}

/**
 * 重置 runtime 事件监听器集合。
 * @param listeners - 监听器集合
 */
export function resetRuntimeEventListeners(listeners: RuntimeEventListeners): void {
  listeners.messageCreated = undefined;
  listeners.messageUpdated = undefined;
  listeners.messageDelta = undefined;
  listeners.messageDeleted = undefined;
  listeners.contextUsage = undefined;
  listeners.complete = undefined;
  listeners.error = undefined;
  listeners.toolRequest = undefined;
  listeners.confirmationRequest = undefined;
  listeners.bridgeRequest = undefined;
}

/**
 * 触发 runtime 事件监听器。
 * @param listeners - 监听器集合
 * @param key - 监听器 key
 * @param event - 事件载荷
 */
export function emitRuntimeEvent<TKey extends RuntimeEventListenerKey>(listeners: RuntimeEventListeners, key: TKey, event: RuntimeEventPayload<TKey>): void {
  const listener = listeners[key] as ((payload: RuntimeEventPayload<TKey>) => void) | undefined;
  listener?.(event);
}
