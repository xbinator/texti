/**
 * @file confirmation.mts
 * @description ChatRuntime renderer 确认请求等待管理。
 */
import type { ActiveChatRuntime, ChatRuntimeEventEmitter } from '../types.mjs';
import type {
  ChatRuntimeConfirmationDecision,
  ChatRuntimeConfirmationRequest,
  ChatRuntimeConfirmationRequestEvent,
  ChatRuntimeRecoveryPendingRequest,
  ChatRuntimeSubmitConfirmationInput
} from 'types/chat-runtime';
import { nanoid } from 'nanoid';
import { ChatRuntimeError } from '../errors.mjs';
import { pauseRuntimeTaskClock, resumeRuntimeTaskClock } from '../task-clock.mjs';
import { createRuntimeEventBase } from '../types.mjs';

/** 活跃 runtime 读取函数。 */
export type RuntimeLookup = (runtimeId: string) => ActiveChatRuntime | undefined;

/** Runtime 确认请求输入。 */
export interface RuntimeConfirmationRequestInput {
  /** Runtime id。 */
  runtimeId: string;
  /** 关联工具调用 ID。 */
  toolCallId?: string;
  /** 确认请求 id，缺省时自动生成。 */
  confirmationId?: string;
  /** 确认请求详情。 */
  request: ChatRuntimeConfirmationRequest;
  /** 关联工具调用的中止信号。 */
  signal?: AbortSignal;
}

/** 确认请求管理器依赖。 */
export interface RuntimeConfirmationRequestsDependencies {
  /** 向 renderer 发送 runtime 事件。 */
  emit: ChatRuntimeEventEmitter;
  /** 读取活跃 runtime。 */
  getRuntime: RuntimeLookup;
}

/** Runtime 确认请求管理器。 */
export interface RuntimeConfirmationRequests {
  /**
   * 请求 renderer 展示确认弹窗并等待决策。
   * @param input - 确认请求输入
   * @returns renderer 确认决策
   */
  request(input: RuntimeConfirmationRequestInput): Promise<ChatRuntimeConfirmationDecision>;
  /**
   * 提交 renderer 确认决策。
   * @param input - 确认决策输入
   */
  submit(input: ChatRuntimeSubmitConfirmationInput): void;
  /**
   * 拒绝指定 runtime 所有等待中的确认请求。
   * @param runtimeId - runtime id
   * @param reason - 拒绝原因
   */
  rejectRuntime(runtimeId: string, reason: string): void;
  /** 读取待处理确认事件的可克隆投影。 */
  listPending(runtimeId?: string): Array<Extract<ChatRuntimeRecoveryPendingRequest, { type: 'confirmation' }>>;
}

/** 等待 renderer 回传的确认请求。 */
interface PendingRuntimeConfirmationRequest {
  /** 已发送到 renderer 的确认事件。 */
  event: ChatRuntimeConfirmationRequestEvent;
  /** 完成确认请求。 */
  resolve: (decision: ChatRuntimeConfirmationDecision) => void;
  /** 拒绝确认请求。 */
  reject: (error: Error) => void;
  /** 请求超时定时器。 */
  timeoutId?: ReturnType<typeof setTimeout>;
  /** 移除中止监听器。 */
  removeAbortListener?: () => void;
  /** 恢复 runtime 任务级执行时钟。 */
  resumeTaskClock?: () => void;
}

/**
 * 创建确认请求 key。
 * @param runtimeId - runtime id
 * @param confirmationId - 确认请求 id
 * @returns pending key
 */
function createConfirmationRequestKey(runtimeId: string, confirmationId: string): string {
  return `${runtimeId}:${confirmationId}`;
}

/**
 * 创建 runtime 确认请求管理器。
 * @param dependencies - 管理器依赖
 * @returns 确认请求管理器
 */
export function createRuntimeConfirmationRequests(dependencies: RuntimeConfirmationRequestsDependencies): RuntimeConfirmationRequests {
  const pendingConfirmationRequests = new Map<string, PendingRuntimeConfirmationRequest>();

  return {
    /**
     * 请求 renderer 展示确认弹窗并等待决策。
     * @param input - 确认请求输入
     * @returns renderer 确认决策
     */
    request(input: RuntimeConfirmationRequestInput): Promise<ChatRuntimeConfirmationDecision> {
      if (input.signal?.aborted) {
        return Promise.reject(new ChatRuntimeError('CONFIRMATION_DISMISSED', 'Tool confirmation request was aborted'));
      }
      const runtime = dependencies.getRuntime(input.runtimeId);
      if (!runtime) {
        throw new ChatRuntimeError('RUNTIME_NOT_ACTIVE', `Runtime ${input.runtimeId} is not active`);
      }

      const confirmationId = input.confirmationId ?? `confirmation-${nanoid()}`;
      const key = createConfirmationRequestKey(input.runtimeId, confirmationId);
      const event: ChatRuntimeConfirmationRequestEvent = {
        ...createRuntimeEventBase(runtime),
        confirmationId,
        toolCallId: input.toolCallId,
        request: input.request
      };
      return new Promise<ChatRuntimeConfirmationDecision>((resolve, reject) => {
        pauseRuntimeTaskClock(runtime);
        const resumeTaskClock = (): void => resumeRuntimeTaskClock(runtime);
        const rejectAborted = (): void => {
          pendingConfirmationRequests.delete(key);
          resumeTaskClock();
          reject(new ChatRuntimeError('CONFIRMATION_DISMISSED', 'Tool confirmation request was aborted'));
        };
        const removeAbortListener = input.signal ? (): void => input.signal?.removeEventListener('abort', rejectAborted) : undefined;
        input.signal?.addEventListener('abort', rejectAborted, { once: true });
        pendingConfirmationRequests.set(key, { event, resolve, reject, removeAbortListener, resumeTaskClock });
        dependencies.emit('chat:runtime:confirmation-requested', event);
      });
    },

    /**
     * 提交 renderer 确认决策。
     * @param input - 确认决策输入
     */
    submit(input: ChatRuntimeSubmitConfirmationInput): void {
      const key = createConfirmationRequestKey(input.runtimeId, input.confirmationId);
      const pendingRequest = pendingConfirmationRequests.get(key);
      if (!pendingRequest) return;

      pendingConfirmationRequests.delete(key);
      if (pendingRequest.timeoutId !== undefined) clearTimeout(pendingRequest.timeoutId);
      pendingRequest.removeAbortListener?.();
      pendingRequest.resumeTaskClock?.();
      pendingRequest.resolve(input.decision);
    },

    /**
     * 拒绝指定 runtime 所有等待中的确认请求。
     * @param runtimeId - runtime id
     * @param reason - 拒绝原因
     */
    rejectRuntime(runtimeId: string, reason: string): void {
      for (const [key, request] of pendingConfirmationRequests) {
        if (!key.startsWith(`${runtimeId}:`)) continue;

        if (request.timeoutId !== undefined) clearTimeout(request.timeoutId);
        request.removeAbortListener?.();
        request.resumeTaskClock?.();
        request.reject(new ChatRuntimeError('CONFIRMATION_DISMISSED', reason));
        pendingConfirmationRequests.delete(key);
      }
    },

    /** 读取待处理确认事件。 */
    listPending(runtimeId?: string): Array<Extract<ChatRuntimeRecoveryPendingRequest, { type: 'confirmation' }>> {
      return [...pendingConfirmationRequests.values()]
        .filter((pending): boolean => !runtimeId || pending.event.runtimeId === runtimeId)
        .map((pending) => ({
          type: 'confirmation',
          event: { ...pending.event, request: { ...pending.event.request } }
        }));
    }
  };
}
