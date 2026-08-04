/**
 * @file bridge.mts
 * @description ChatRuntime renderer bridge 请求等待管理。
 */
import type { ActiveChatRuntime, ChatRuntimeEventEmitter } from '../types.mjs';
import type { AIToolExecutionError } from 'types/ai';
import type {
  ChatRuntimeBridgeRequestEvent,
  ChatRuntimeBridgeResponseInput,
  ChatRuntimeBridgeResult,
  ChatRuntimeRecoveryPendingRequest
} from 'types/chat-runtime';
import { nanoid } from 'nanoid';
import { ChatRuntimeError } from '../errors.mjs';
import { createRuntimeEventBase } from '../types.mjs';

/** Watchdog 可通过 Bridge 等待传播的稳定中止码。 */
const BRIDGE_ABORT_CODES: ReadonlySet<AIToolExecutionError['code']> = new Set([
  'USER_CANCELLED',
  'TOOL_UNRESPONSIVE',
  'EXTERNAL_WAIT_TIMEOUT',
  'RUNTIME_INTERRUPTED'
]);

/**
 * 从中止信号构建保留 Watchdog 原因的 Bridge 结果。
 * @param signal - Bridge 等待使用的中止信号
 * @returns 结构化 Bridge 失败结果
 */
function createAbortedBridgeResult(signal?: AbortSignal): ChatRuntimeBridgeResult {
  const reason: unknown = signal?.reason;
  if (typeof reason === 'object' && reason !== null && 'code' in reason && 'message' in reason) {
    const { code, message } = reason;
    if (typeof code === 'string' && BRIDGE_ABORT_CODES.has(code as AIToolExecutionError['code']) && typeof message === 'string') {
      return { status: 'failure', error: { code: code as AIToolExecutionError['code'], message } };
    }
  }
  return { status: 'failure', error: { code: 'USER_CANCELLED', message: 'Renderer bridge request was aborted' } };
}

/** 活跃 runtime 读取函数。 */
export type RuntimeLookup = (runtimeId: string) => ActiveChatRuntime | undefined;

/** Runtime bridge 请求输入。 */
export interface RuntimeBridgeRequestInput {
  /** Runtime id。 */
  runtimeId: string;
  /** Bridge 请求 id，缺省时自动生成。 */
  requestId?: string;
  /** 关联工具调用 ID。 */
  toolCallId?: string;
  /** Bridge 请求类型。 */
  kind: string;
  /** Bridge 请求载荷。 */
  payload?: unknown;
  /** 关联工具调用的中止信号。 */
  signal?: AbortSignal;
}

/** Bridge 请求管理器依赖。 */
export interface RuntimeBridgeRequestsDependencies {
  /** 向 renderer 发送 runtime 事件。 */
  emit: ChatRuntimeEventEmitter;
  /** 读取活跃 runtime。 */
  getRuntime: RuntimeLookup;
  /** 请求超时时间。 */
  timeoutMs: number;
}

/** Runtime bridge 请求管理器。 */
export interface RuntimeBridgeRequests {
  /**
   * 请求 renderer 执行通用 bridge 操作并等待结果。
   * @param input - bridge 请求输入
   * @returns renderer bridge 结果
   */
  request(input: RuntimeBridgeRequestInput): Promise<ChatRuntimeBridgeResult>;
  /**
   * 提交 renderer bridge 响应。
   * @param input - bridge 响应输入
   */
  submit(input: ChatRuntimeBridgeResponseInput): void;
  /**
   * 拒绝指定 runtime 所有等待中的 bridge 请求。
   * @param runtimeId - runtime id
   * @param reason - 拒绝原因
   */
  rejectRuntime(runtimeId: string, reason: string): void;
  /** 读取待处理 Bridge 事件的可克隆投影。 */
  listPending(runtimeId?: string): Array<Extract<ChatRuntimeRecoveryPendingRequest, { type: 'bridge' }>>;
}

/** 等待 renderer 回传的通用 bridge 请求。 */
interface PendingRuntimeBridgeRequest {
  /** 已发送到 renderer 的 Bridge 请求事件。 */
  event: ChatRuntimeBridgeRequestEvent;
  /** 完成 bridge 请求。 */
  resolve: (result: ChatRuntimeBridgeResult) => void;
  /** 拒绝 bridge 请求。 */
  reject: (error: Error) => void;
  /** 请求超时定时器。 */
  timeoutId: ReturnType<typeof setTimeout>;
  /** 移除中止监听器。 */
  removeAbortListener?: () => void;
}

/**
 * 创建 bridge 请求 key。
 * @param runtimeId - runtime id
 * @param requestId - bridge 请求 id
 * @returns pending key
 */
function createBridgeRequestKey(runtimeId: string, requestId: string): string {
  return `${runtimeId}:${requestId}`;
}

/**
 * 创建 runtime bridge 请求管理器。
 * @param dependencies - 管理器依赖
 * @returns bridge 请求管理器
 */
export function createRuntimeBridgeRequests(dependencies: RuntimeBridgeRequestsDependencies): RuntimeBridgeRequests {
  const pendingBridgeRequests = new Map<string, PendingRuntimeBridgeRequest>();

  return {
    /**
     * 请求 renderer 执行通用 bridge 操作并等待结果。
     * @param input - bridge 请求输入
     * @returns renderer bridge 结果
     */
    request(input: RuntimeBridgeRequestInput): Promise<ChatRuntimeBridgeResult> {
      if (input.signal?.aborted) {
        return Promise.resolve(createAbortedBridgeResult(input.signal));
      }
      const runtime = dependencies.getRuntime(input.runtimeId);
      if (!runtime) {
        throw new ChatRuntimeError('RUNTIME_NOT_ACTIVE', `Runtime ${input.runtimeId} is not active`);
      }

      const requestId = input.requestId ?? `bridge-${nanoid()}`;
      const key = createBridgeRequestKey(input.runtimeId, requestId);
      const event: ChatRuntimeBridgeRequestEvent = {
        ...createRuntimeEventBase(runtime),
        requestId,
        toolCallId: input.toolCallId,
        kind: input.kind,
        payload: input.payload
      };
      return new Promise<ChatRuntimeBridgeResult>((resolve, reject) => {
        let timeoutId: ReturnType<typeof setTimeout>;
        const resolveAborted = (): void => {
          pendingBridgeRequests.delete(key);
          clearTimeout(timeoutId);
          resolve(createAbortedBridgeResult(input.signal));
        };
        timeoutId = setTimeout((): void => {
          pendingBridgeRequests.delete(key);
          input.signal?.removeEventListener('abort', resolveAborted);
          resolve({
            status: 'failure',
            error: { code: 'TOOL_TIMEOUT', message: 'Renderer bridge request timed out' }
          });
        }, dependencies.timeoutMs);
        const removeAbortListener = input.signal ? (): void => input.signal?.removeEventListener('abort', resolveAborted) : undefined;
        input.signal?.addEventListener('abort', resolveAborted, { once: true });
        pendingBridgeRequests.set(key, { event, resolve, reject, timeoutId, removeAbortListener });
        try {
          dependencies.emit('chat:runtime:bridge-requested', event);
        } catch (error: unknown) {
          // Renderer 未收到 Bridge 请求时释放全部等待资源，避免超时前残留幽灵请求。
          pendingBridgeRequests.delete(key);
          clearTimeout(timeoutId);
          removeAbortListener?.();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },

    /**
     * 提交 renderer bridge 响应。
     * @param input - bridge 响应输入
     */
    submit(input: ChatRuntimeBridgeResponseInput): void {
      const key = createBridgeRequestKey(input.runtimeId, input.requestId);
      const pendingRequest = pendingBridgeRequests.get(key);
      if (!pendingRequest) return;

      pendingBridgeRequests.delete(key);
      clearTimeout(pendingRequest.timeoutId);
      pendingRequest.removeAbortListener?.();
      pendingRequest.resolve(input.result);
    },

    /**
     * 拒绝指定 runtime 所有等待中的 bridge 请求。
     * @param runtimeId - runtime id
     * @param reason - 拒绝原因
     */
    rejectRuntime(runtimeId: string, reason: string): void {
      for (const [key, request] of pendingBridgeRequests) {
        if (!key.startsWith(`${runtimeId}:`)) continue;

        clearTimeout(request.timeoutId);
        request.removeAbortListener?.();
        request.reject(new ChatRuntimeError('EDITOR_UNAVAILABLE', reason));
        pendingBridgeRequests.delete(key);
      }
    },

    /** 读取待处理 Bridge 事件。 */
    listPending(runtimeId?: string): Array<Extract<ChatRuntimeRecoveryPendingRequest, { type: 'bridge' }>> {
      return [...pendingBridgeRequests.values()]
        .filter((pending): boolean => !runtimeId || pending.event.runtimeId === runtimeId)
        .map((pending) => ({ type: 'bridge', event: { ...pending.event } }));
    }
  };
}
