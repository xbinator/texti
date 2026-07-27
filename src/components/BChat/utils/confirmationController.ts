/**
 * @file confirmationController.ts
 * @description 把 Runtime 临时确认适配到应用级 confirmation queue，并私有持有 Promise resolver。
 */
import { computed, type ComputedRef } from 'vue';
import { nanoid } from 'nanoid';
import {
  normalizeToolConfirmationRequest,
  type AIToolConfirmationAdapter,
  type AIToolConfirmationDecision,
  type AIToolConfirmationRequest
} from '@/ai/tools/confirmation';
import { useChatConfirmationQueueStore, type ChatConfirmationQueueItem, type ChatRuntimeConfirmationItem } from '@/stores/chat/confirmationQueue';

/** Runtime confirmation 的私有完成回调。 */
type RuntimeConfirmationResolver = (decision: AIToolConfirmationDecision) => void;

/** BChat Runtime confirmation adapter 对外能力。 */
export interface ChatConfirmationController {
  /** 控制器稳定 owner ID。 */
  readonly ownerId: string;
  /** 应用级当前 confirmation 投影。 */
  readonly currentConfirmation: ComputedRef<ChatConfirmationQueueItem | null>;
  /** 当前控制器拥有的首个 Runtime 请求。 */
  readonly currentConfirmationRequest: ComputedRef<AIToolConfirmationRequest | null>;
  /** 当前控制器拥有的首个 Runtime confirmation ID。 */
  readonly currentConfirmationId: ComputedRef<string | null>;
  /**
   * 把 Runtime 请求加入应用级队列。
   * @param request - 原始工具确认
   * @returns 用户决议
   */
  requestConfirmation(request: AIToolConfirmationRequest): Promise<AIToolConfirmationDecision>;
  /**
   * 批准当前控制器拥有的 Runtime confirmation。
   * @param confirmationId - confirmation 身份
   * @param grantScope - 可选授权记忆范围
   */
  approveConfirmation(confirmationId: string, grantScope?: 'session' | 'always'): void;
  /**
   * 拒绝当前控制器拥有的 Runtime confirmation。
   * @param confirmationId - confirmation 身份
   */
  cancelConfirmation(confirmationId: string): void;
  /** 拒绝当前控制器拥有的全部 Runtime confirmation。 */
  expirePendingConfirmation(): void;
  /** 释放 controller；不得移除或决议任何 Agent confirmation。 */
  dispose(): void;
  /** @returns AI 工具执行使用的确认适配器。 */
  createAdapter(): AIToolConfirmationAdapter;
}

/**
 * 创建 Runtime confirmation queue adapter。
 * 每个 controller 的 resolver 只存在于私有 Map，不进入 Pinia state。
 * @returns confirmation controller
 */
export function createChatConfirmationController(): ChatConfirmationController {
  const queue = useChatConfirmationQueueStore();
  const ownerId = `runtime-confirmation-owner-${nanoid()}`;
  const resolvers = new Map<string, RuntimeConfirmationResolver>();

  /** 应用级当前 Runtime 或 Agent confirmation。 */
  const currentConfirmation = computed<ChatConfirmationQueueItem | null>((): ChatConfirmationQueueItem | null => queue.current);

  /** 当前 controller 拥有的首个 Runtime confirmation。 */
  const ownedCurrent = computed<ChatRuntimeConfirmationItem | null>((): ChatRuntimeConfirmationItem | null => {
    return (
      queue.pending.find(
        (item): item is ChatRuntimeConfirmationItem => item.source === 'runtime' && item.ownerId === ownerId && resolvers.has(item.confirmationId)
      ) ?? null
    );
  });

  /** 兼容 Runtime 工作流的当前请求投影。 */
  const currentConfirmationRequest = computed<AIToolConfirmationRequest | null>((): AIToolConfirmationRequest | null => ownedCurrent.value?.request ?? null);

  /** 兼容 Runtime 工作流的当前 confirmation ID。 */
  const currentConfirmationId = computed<string | null>((): string | null => ownedCurrent.value?.confirmationId ?? null);

  /**
   * 完成一个当前 controller 拥有的 Runtime confirmation。
   * @param confirmationId - confirmation 身份
   * @param decision - Runtime 工具决议
   */
  function settleRuntime(confirmationId: string, decision: AIToolConfirmationDecision): void {
    const resolver = resolvers.get(confirmationId);
    if (!resolver || !queue.removeRuntime(confirmationId, ownerId)) return;
    resolvers.delete(confirmationId);
    resolver(decision);
  }

  /**
   * 请求用户确认。
   * @param request - 原始工具确认
   * @returns 用户决议
   */
  function requestConfirmation(request: AIToolConfirmationRequest): Promise<AIToolConfirmationDecision> {
    const confirmationId = `runtime-confirmation-${nanoid()}`;
    const normalizedRequest = normalizeToolConfirmationRequest(request);
    return new Promise<AIToolConfirmationDecision>((resolve): void => {
      resolvers.set(confirmationId, resolve);
      queue.addRuntime({
        source: 'runtime',
        confirmationId,
        ownerId,
        request: normalizedRequest,
        createdAt: new Date().toISOString()
      });
    });
  }

  /**
   * 同意 Runtime confirmation。
   * @param confirmationId - confirmation 身份
   * @param grantScope - 可选授权范围
   */
  function approveConfirmation(confirmationId: string, grantScope?: 'session' | 'always'): void {
    settleRuntime(confirmationId, grantScope ? { approved: true, grantScope } : { approved: true });
  }

  /**
   * 拒绝 Runtime confirmation。
   * @param confirmationId - confirmation 身份
   */
  function cancelConfirmation(confirmationId: string): void {
    settleRuntime(confirmationId, { approved: false });
  }

  /**
   * 拒绝并清除当前 controller 拥有的全部 Runtime confirmation。
   */
  function expirePendingConfirmation(): void {
    const confirmationIds = queue.removeOwner(ownerId);
    confirmationIds.forEach((confirmationId): void => {
      const resolver = resolvers.get(confirmationId);
      resolvers.delete(confirmationId);
      resolver?.({ approved: false });
    });
  }

  /**
   * 释放 controller；Agent confirmation 由 Main 事实源继续持有。
   */
  function dispose(): void {
    expirePendingConfirmation();
  }

  /**
   * 创建写工具 confirmation adapter。
   * @returns 工具确认适配器
   */
  function createAdapter(): AIToolConfirmationAdapter {
    return {
      confirm: requestConfirmation,
      onExecutionStart: (): void => {
        // 底部统一队列不需要向消息流写入执行态。
      },
      onExecutionComplete: (): void => {
        // 底部统一队列不需要向消息流写入完成态。
      }
    };
  }

  return {
    ownerId,
    currentConfirmation,
    currentConfirmationRequest,
    currentConfirmationId,
    requestConfirmation,
    approveConfirmation,
    cancelConfirmation,
    expirePendingConfirmation,
    dispose,
    createAdapter
  };
}
