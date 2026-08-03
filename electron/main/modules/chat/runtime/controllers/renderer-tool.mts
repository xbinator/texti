/**
 * @file renderer-tool.mts
 * @description ChatRuntime renderer 本地工具请求等待管理。
 */
import type { ActiveChatRuntime, ChatRuntimeEventEmitter, ChatRuntimeRendererToolExecutionInput } from '../types.mjs';
import type { AIToolExecutionResult } from 'types/ai';
import type { ChatRuntimeRecoveryPendingRequest, ChatRuntimeSubmitToolResultInput, ChatRuntimeToolRequestEvent } from 'types/chat-runtime';
import { ChatRuntimeError } from '../errors.mjs';
import { createRuntimeEventBase } from '../types.mjs';

/** 活跃 runtime 读取函数。 */
export type RuntimeLookup = (runtimeId: string) => ActiveChatRuntime | undefined;

/** Renderer 工具请求管理器依赖。 */
export interface RuntimeRendererToolRequestsDependencies {
  /** 向 renderer 发送 runtime 事件。 */
  emit: ChatRuntimeEventEmitter;
  /** 读取活跃 runtime。 */
  getRuntime: RuntimeLookup;
  /** 请求超时时间。 */
  timeoutMs: number;
}

/** Renderer 工具请求管理器。 */
export interface RuntimeRendererToolRequests {
  /**
   * 请求 renderer 执行本地工具。
   * @param input - 工具执行输入
   * @returns 工具执行结果
   */
  request(input: ChatRuntimeRendererToolExecutionInput): Promise<AIToolExecutionResult>;
  /**
   * 提交 renderer 本地工具执行结果。
   * @param input - 工具结果
   */
  submit(input: ChatRuntimeSubmitToolResultInput): void;
  /**
   * 拒绝指定 runtime 所有等待中的工具请求。
   * @param runtimeId - runtime id
   * @param reason - 拒绝原因
   */
  rejectRuntime(runtimeId: string, reason: string): void;
  /** 读取待处理工具事件的可克隆投影。 */
  listPending(runtimeId?: string): Array<Extract<ChatRuntimeRecoveryPendingRequest, { type: 'tool' }>>;
}

/** 等待 renderer 回传的工具请求。 */
interface PendingRendererToolRequest {
  /** 已发送到 renderer 的工具请求事件。 */
  event: ChatRuntimeToolRequestEvent;
  /** 完成工具请求。 */
  resolve: (result: AIToolExecutionResult) => void;
  /** 拒绝工具请求。 */
  reject: (error: Error) => void;
  /** 请求超时定时器。 */
  timeoutId: ReturnType<typeof setTimeout>;
  /** 移除工具级中止监听器。 */
  removeAbortListener?: () => void;
}

/**
 * 创建 renderer 工具请求 key。
 * @param runtimeId - runtime id
 * @param toolCallId - 工具调用 id
 * @returns pending key
 */
function createToolRequestKey(runtimeId: string, toolCallId: string): string {
  return `${runtimeId}:${toolCallId}`;
}

/**
 * 创建 renderer 工具请求管理器。
 * @param dependencies - 管理器依赖
 * @returns renderer 工具请求管理器
 */
export function createRuntimeRendererToolRequests(dependencies: RuntimeRendererToolRequestsDependencies): RuntimeRendererToolRequests {
  const pendingRendererToolRequests = new Map<string, PendingRendererToolRequest>();

  /**
   * 通知 renderer 停止尚未结束的本地工具工作。
   * @param event - 原工具请求事件
   */
  function emitToolCancelled(event: ChatRuntimeToolRequestEvent): void {
    try {
      dependencies.emit('chat:runtime:tool-cancelled', {
        runtimeId: event.runtimeId,
        sessionId: event.sessionId,
        turnId: event.turnId,
        clientId: event.clientId,
        agentId: event.agentId,
        parentAgentId: event.parentAgentId,
        parentRuntimeId: event.parentRuntimeId,
        rootRuntimeId: event.rootRuntimeId,
        continuationOfRuntimeId: event.continuationOfRuntimeId,
        toolCallId: event.toolCallId
      });
    } catch {
      // 取消通知是旁路信号，不能阻止 pending 请求终结或 Runtime 释放资源。
    }
  }

  return {
    /**
     * 请求 renderer 执行本地工具。
     * @param input - 工具执行输入
     * @returns 工具执行结果
     */
    request(input: ChatRuntimeRendererToolExecutionInput): Promise<AIToolExecutionResult> {
      if (input.signal?.aborted) {
        return Promise.resolve({
          toolName: input.toolName,
          status: 'failure',
          error: { code: 'TOOL_TIMEOUT', message: 'Renderer tool request was aborted' }
        });
      }
      if (!dependencies.getRuntime(input.runtime.runtimeId)) {
        throw new ChatRuntimeError('RUNTIME_NOT_ACTIVE', `Runtime ${input.runtime.runtimeId} is not active`);
      }

      const key = createToolRequestKey(input.runtime.runtimeId, input.toolCallId);
      const event: ChatRuntimeToolRequestEvent = {
        ...createRuntimeEventBase(input.runtime),
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        input: input.input
      };
      return new Promise<AIToolExecutionResult>((resolve, reject) => {
        let timeoutId: ReturnType<typeof setTimeout>;
        const resolveAborted = (): void => {
          pendingRendererToolRequests.delete(key);
          clearTimeout(timeoutId);
          resolve({
            toolName: input.toolName,
            status: 'failure',
            error: { code: 'TOOL_TIMEOUT', message: 'Renderer tool request was aborted' }
          });
          emitToolCancelled(event);
        };
        timeoutId = setTimeout((): void => {
          pendingRendererToolRequests.delete(key);
          input.signal?.removeEventListener('abort', resolveAborted);
          resolve({
            toolName: input.toolName,
            status: 'failure',
            error: { code: 'TOOL_TIMEOUT', message: 'Renderer tool request timed out' }
          });
          emitToolCancelled(event);
        }, dependencies.timeoutMs);
        const removeAbortListener = input.signal ? (): void => input.signal?.removeEventListener('abort', resolveAborted) : undefined;
        input.signal?.addEventListener('abort', resolveAborted, { once: true });
        pendingRendererToolRequests.set(key, { event, resolve, reject, timeoutId, removeAbortListener });
        try {
          dependencies.emit('chat:runtime:tool-request', event);
        } catch (error: unknown) {
          // 初始通知失败时回滚全部资源，避免留下永远无法由 Renderer 响应的请求。
          pendingRendererToolRequests.delete(key);
          clearTimeout(timeoutId);
          removeAbortListener?.();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },

    /**
     * 提交 renderer 本地工具执行结果。
     * @param input - 工具结果
     */
    submit(input: ChatRuntimeSubmitToolResultInput): void {
      const key = createToolRequestKey(input.runtimeId, input.toolCallId);
      const pendingRequest = pendingRendererToolRequests.get(key);
      if (!pendingRequest) return;

      pendingRendererToolRequests.delete(key);
      clearTimeout(pendingRequest.timeoutId);
      pendingRequest.removeAbortListener?.();
      pendingRequest.resolve(input.result);
    },

    /**
     * 拒绝指定 runtime 所有等待中的工具请求。
     * @param runtimeId - runtime id
     * @param reason - 拒绝原因
     */
    rejectRuntime(runtimeId: string, reason: string): void {
      for (const [key, request] of pendingRendererToolRequests) {
        if (!key.startsWith(`${runtimeId}:`)) continue;

        clearTimeout(request.timeoutId);
        request.removeAbortListener?.();
        request.reject(new ChatRuntimeError('TOOL_REQUEST_CANCELLED', reason));
        pendingRendererToolRequests.delete(key);
        emitToolCancelled(request.event);
      }
    },

    /** 读取待处理工具事件。 */
    listPending(runtimeId?: string): Array<Extract<ChatRuntimeRecoveryPendingRequest, { type: 'tool' }>> {
      return [...pendingRendererToolRequests.values()]
        .filter((pending): boolean => !runtimeId || pending.event.runtimeId === runtimeId)
        .map((pending) => ({ type: 'tool', event: { ...pending.event } }));
    }
  };
}
