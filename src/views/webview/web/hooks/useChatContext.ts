/**
 * @file useChatContext.ts
 * @description 将 WebView 页面能力注册为 ChatRuntime 页面上下文。
 */
import type { WebviewOperateInput, WebviewPressKey, WebviewToolContext } from '../types';
import type { AIToolExecutionError } from 'types/ai';
import type { ChatRuntimeBridgeRequestEvent } from 'types/chat-runtime';
import { ref, type Ref } from 'vue';
import { createOperateWebpageTool, createReadCurrentWebpageTool, OPEN_RESOURCE_TOOL_NAME } from '@/ai/tools/catalog/runtimeTools';
import { useToolContext, type ChatBridgeDispatchResult } from '@/hooks/useChat/useToolContext';
import { asyncTo } from '@/utils/asyncTo';

/** WebView Chat Context 选项。 */
interface UseChatContextOptions {
  /** 当前 WebView 资源 ID。 */
  readonly resourceId: Readonly<Ref<string>>;
  /** 当前 WebView 能力是否可用。 */
  readonly available: Readonly<Ref<boolean>>;
  /** 当前 WebView 强类型工具上下文。 */
  readonly context: WebviewToolContext;
}

/**
 * 创建稳定工具错误。
 * @param code - 工具错误码
 * @param message - 错误消息
 * @returns 带稳定错误码的错误
 */
function createToolError(code: AIToolExecutionError['code'], message: string): Error & { code: AIToolExecutionError['code'] } {
  const error = new Error(message) as Error & { code: AIToolExecutionError['code'] };
  error.code = code;
  return error;
}

/**
 * 判断值是否为对象记录。
 * @param value - 待判断值
 * @returns 是否为对象记录
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 判断值是否为有限数字。
 * @param value - 待判断值
 * @returns 是否为有限数字
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 判断值是否为网页滚动方向。
 * @param value - 待判断值
 * @returns 是否为网页滚动方向
 */
function isScrollDirection(value: unknown): value is 'up' | 'down' | 'left' | 'right' {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

/**
 * 判断值是否为网页按键。
 * @param value - 待判断值
 * @returns 是否为网页按键
 */
function isPressKey(value: unknown): value is WebviewPressKey {
  return (
    value === 'Enter' ||
    value === 'Tab' ||
    value === 'Escape' ||
    value === 'ArrowUp' ||
    value === 'ArrowDown' ||
    value === 'ArrowLeft' ||
    value === 'ArrowRight'
  );
}

/**
 * 判断值是否为 WebView 操作动作。
 * @param value - 待判断值
 * @returns 是否为 WebView 操作动作
 */
function isOperateAction(value: unknown): value is WebviewOperateInput['action'] {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'click') return isFiniteNumber(value.index);
  if (value.type === 'input') {
    return isFiniteNumber(value.index) && typeof value.text === 'string' && (value.clear === undefined || typeof value.clear === 'boolean');
  }
  if (value.type === 'select') return isFiniteNumber(value.index) && typeof value.optionText === 'string';
  if (value.type === 'press') return isFiniteNumber(value.index) && isPressKey(value.key);
  if (value.type === 'scroll') {
    return (
      (value.index === undefined || isFiniteNumber(value.index)) &&
      isScrollDirection(value.direction) &&
      (value.pixels === undefined || isFiniteNumber(value.pixels))
    );
  }
  if (value.type === 'navigate') return typeof value.url === 'string';
  if (value.type === 'wait') return value.seconds === undefined || isFiniteNumber(value.seconds);
  return false;
}

/**
 * 判断 payload 是否为 WebView 操作输入。
 * @param value - 待判断值
 * @returns 是否为 WebView 操作输入
 */
function isOperateInput(value: unknown): value is WebviewOperateInput {
  if (!isRecord(value) || !isOperateAction(value.action)) return false;
  if (value.action.type === 'navigate') {
    return value.snapshotId === undefined || typeof value.snapshotId === 'string';
  }
  return typeof value.snapshotId === 'string' && value.snapshotId.length > 0;
}

/**
 * 注册 WebView Chat 工具上下文。
 * @param options - WebView 工具注册选项
 */
export function useChatContext(options: UseChatContextOptions): void {
  const active = ref<boolean>(true);

  /** 读取网页快照。 */
  async function readSnapshot(): Promise<ChatBridgeDispatchResult> {
    const [error, snapshot] = await asyncTo(options.context.readPageSnapshot());
    if (error) throw error.cause ?? error;
    return { handled: true, data: snapshot };
  }

  /**
   * 操作网页。
   * @param event - Runtime Bridge 请求
   * @returns 网页操作结果
   */
  async function operatePage(event: ChatRuntimeBridgeRequestEvent): Promise<ChatBridgeDispatchResult> {
    if (!isOperateInput(event.payload)) throw createToolError('INVALID_INPUT', '网页操作参数无效');
    const [error, result] = await asyncTo(options.context.operatePage(event.payload));
    if (error) throw error.cause ?? error;
    return { handled: true, data: result };
  }

  useToolContext({
    providerId: 'webview',
    resourceId: options.resourceId,
    available: options.available,
    active,
    getTools: () => [createReadCurrentWebpageTool(), createOperateWebpageTool()],
    hiddenToolNames: [OPEN_RESOURCE_TOOL_NAME],
    bridgeHandlers: {
      'webview-snapshot': readSnapshot,
      'webview-operate': operatePage
    }
  });
}
