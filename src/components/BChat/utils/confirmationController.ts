/**
 * @file confirmationController.ts
 * @description 提供应用级 Runtime confirmation broker 与按会话过滤的 BChat 投影。
 */
import { computed, type ComputedRef, type Ref } from 'vue';
import { isEqual } from 'lodash-es';
import { nanoid } from 'nanoid';
import {
  normalizeToolConfirmationRequest,
  type AIToolConfirmationAdapter,
  type AIToolConfirmationDecision,
  type AIToolConfirmationRequest
} from '@/ai/tools/confirmation';
import { useChatConfirmationQueueStore, type ChatConfirmationQueueItem, type ChatRuntimeConfirmationItem } from '@/stores/chat/confirmationQueue';

/** Runtime confirmation 的完成回调。 */
type RuntimeConfirmationResolver = (decision: AIToolConfirmationDecision) => void;

/** Runtime confirmation 的不可变路由身份。 */
export interface RuntimeConfirmationBinding {
  /** 持久化会话 ID。 */
  readonly sessionId: string;
  /** 主进程 Runtime ID。 */
  readonly runtimeId: string;
  /** 可选工具调用 ID。 */
  readonly toolCallId?: string;
}

/** 去重 confirmation 请求的共享结果。 */
export interface RuntimeConfirmationRequest {
  /** 当前调用是否创建了新的决议 flight。 */
  created: boolean;
  /** 全部重放调用共享的决议 Promise。 */
  decision: Promise<AIToolConfirmationDecision>;
  /** @returns 是否由 Runtime 终态或本地清理被动结束。 */
  wasExpired: () => boolean;
}

/** 应用级 Runtime confirmation flight。 */
interface RuntimeConfirmationFlight {
  /** 不可变路由身份。 */
  binding: RuntimeConfirmationBinding;
  /** 共享决议 Promise。 */
  decision: Promise<AIToolConfirmationDecision>;
  /** 归一化后的不可变请求。 */
  request: AIToolConfirmationRequest;
  /** 是否由生命周期清理而非用户操作结束。 */
  expired: boolean;
  /** 完成共享 Promise 的回调。 */
  resolve: RuntimeConfirmationResolver;
}

/** 每个 Pinia queue 实例独享的 Runtime confirmation flights。 */
const RUNTIME_CONFIRMATION_FLIGHTS = new WeakMap<object, Map<string, RuntimeConfirmationFlight>>();

/**
 * 读取 queue 对应的 application-level flight Map。
 * @param queue - 当前 Pinia confirmation queue
 * @returns 该应用实例的 Runtime flights
 */
function getRuntimeFlights(queue: object): Map<string, RuntimeConfirmationFlight> {
  const existing = RUNTIME_CONFIRMATION_FLIGHTS.get(queue);
  if (existing) return existing;
  const created = new Map<string, RuntimeConfirmationFlight>();
  RUNTIME_CONFIRMATION_FLIGHTS.set(queue, created);
  return created;
}

/**
 * 判断两个 confirmation 绑定是否表示同一个不可变请求。
 * @param left - 已登记绑定
 * @param right - 重放绑定
 * @returns 是否完全一致
 */
function isSameBinding(left: RuntimeConfirmationBinding, right: RuntimeConfirmationBinding): boolean {
  return left.sessionId === right.sessionId && left.runtimeId === right.runtimeId && left.toolCallId === right.toolCallId;
}

/**
 * 完成并移除一个 application-level Runtime confirmation。
 * @param queue - confirmation queue
 * @param confirmationId - confirmation 身份
 * @param decision - 用户决议
 * @returns 是否成功完成
 */
function settleRuntime(
  queue: ReturnType<typeof useChatConfirmationQueueStore>,
  confirmationId: string,
  decision: AIToolConfirmationDecision,
  expired = false
): boolean {
  const flights = getRuntimeFlights(queue as object);
  const flight = flights.get(confirmationId);
  const item = queue.items[confirmationId];
  if (!flight || item?.source !== 'runtime') return false;
  flight.expired = expired;
  queue.removeRuntime(confirmationId);
  flights.delete(confirmationId);
  flight.resolve(decision);
  return true;
}

/**
 * 拒绝目标 Runtime 的未决 confirmations。
 * @param runtimeId - 目标 Runtime ID
 * @param toolCallId - 可选工具调用 ID；缺省时拒绝该 Runtime 全部 confirmations
 */
export function expireRuntimeConfirmations(runtimeId: string, toolCallId?: string): void {
  const queue = useChatConfirmationQueueStore();
  const flights = getRuntimeFlights(queue as object);
  const confirmationIds = [...flights.entries()]
    .filter(([, flight]): boolean => flight.binding.runtimeId === runtimeId && (toolCallId === undefined || flight.binding.toolCallId === toolCallId))
    .map(([confirmationId]): string => confirmationId);
  confirmationIds.forEach((confirmationId: string): void => {
    settleRuntime(queue, confirmationId, { approved: false }, true);
  });
}

/**
 * 拒绝已删除会话的全部 Runtime confirmations。
 * @param sessionId - 已删除的持久化会话 ID
 */
export function expireSessionConfirmations(sessionId: string): void {
  const queue = useChatConfirmationQueueStore();
  const flights = getRuntimeFlights(queue as object);
  const confirmationIds = [...flights.entries()]
    .filter(([, flight]): boolean => flight.binding.sessionId === sessionId)
    .map(([confirmationId]): string => confirmationId);
  confirmationIds.forEach((confirmationId: string): void => {
    settleRuntime(queue, confirmationId, { approved: false }, true);
  });
}

/**
 * 判断目标 Runtime 是否仍有未决 confirmation flight。
 * @param sessionId - 持久化会话 ID
 * @param runtimeId - Runtime ID
 * @returns 是否仍有待确认请求
 */
export function hasRuntimeConfirmations(sessionId: string, runtimeId: string): boolean {
  const flights = getRuntimeFlights(useChatConfirmationQueueStore() as object);
  return [...flights.values()].some((flight): boolean => flight.binding.sessionId === sessionId && flight.binding.runtimeId === runtimeId);
}

/** BChat Runtime confirmation adapter 对外能力。 */
export interface ChatConfirmationController {
  /** 当前会话的 confirmation 投影。 */
  readonly currentConfirmation: ComputedRef<ChatConfirmationQueueItem | null>;
  /** 当前会话的首个 Runtime 请求。 */
  readonly currentConfirmationRequest: ComputedRef<AIToolConfirmationRequest | null>;
  /** 当前会话的首个 Runtime confirmation ID。 */
  readonly currentConfirmationId: ComputedRef<string | null>;
  /**
   * 请求或重放一个 application-level Runtime confirmation。
   * @param request - 原始工具确认
   * @param binding - 不可变 Runtime 身份
   * @param confirmationId - 可选的 Main confirmation 身份
   * @returns 去重 flight
   */
  requestConfirmation(request: AIToolConfirmationRequest, binding: RuntimeConfirmationBinding, confirmationId?: string): RuntimeConfirmationRequest;
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
  /** 拒绝当前可见会话的全部 Runtime confirmation。 */
  expirePendingConfirmation(): void;
  /** 释放 controller 视图，不改变任何 application-level confirmation。 */
  dispose(): void;
  /**
   * 创建 AI 工具执行使用的确认适配器。
   * @param binding - 不可变 Runtime 身份；缺省时执行确认会安全拒绝
   * @returns 工具确认适配器
   */
  createAdapter(binding?: RuntimeConfirmationBinding): AIToolConfirmationAdapter;
}

/**
 * 创建 Runtime confirmation queue adapter。
 * resolver 存在于 queue 实例对应的 application-level WeakMap，不进入 Pinia state。
 * @param activeSessionId - 当前 BChat 显示的会话 ID
 * @returns confirmation controller
 */
export function createChatConfirmationController(activeSessionId: Readonly<Ref<string | null>>): ChatConfirmationController {
  const queue = useChatConfirmationQueueStore();
  const flights = getRuntimeFlights(queue as object);

  /** 当前会话按统一优先级排序后的 confirmations。 */
  const sessionPending = computed<ChatConfirmationQueueItem[]>((): ChatConfirmationQueueItem[] => {
    const sessionId = activeSessionId.value;
    if (!sessionId) return [];
    return queue.pending.filter((item: ChatConfirmationQueueItem): boolean =>
      item.source === 'runtime' ? item.sessionId === sessionId : item.snapshot.sessionId === sessionId
    );
  });

  /** 当前会话显式选中项或排序首项。 */
  const currentConfirmation = computed<ChatConfirmationQueueItem | null>((): ChatConfirmationQueueItem | null => {
    const selected = queue.selectedId ? sessionPending.value.find((item): boolean => item.confirmationId === queue.selectedId) : undefined;
    return selected ?? sessionPending.value[0] ?? null;
  });

  /** 当前会话的首个 Runtime confirmation。 */
  const runtimeCurrent = computed<ChatRuntimeConfirmationItem | null>((): ChatRuntimeConfirmationItem | null => {
    return sessionPending.value.find((item): item is ChatRuntimeConfirmationItem => item.source === 'runtime') ?? null;
  });

  /** 兼容 Runtime 工作流的当前请求投影。 */
  const currentConfirmationRequest = computed<AIToolConfirmationRequest | null>((): AIToolConfirmationRequest | null => runtimeCurrent.value?.request ?? null);

  /** 兼容 Runtime 工作流的当前 confirmation ID。 */
  const currentConfirmationId = computed<string | null>((): string | null => runtimeCurrent.value?.confirmationId ?? null);

  /**
   * 完成一个当前 controller 拥有的 Runtime confirmation。
   * @param confirmationId - confirmation 身份
   * @param decision - Runtime 工具决议
   */
  function requestConfirmation(
    request: AIToolConfirmationRequest,
    binding: RuntimeConfirmationBinding,
    requestedConfirmationId = `runtime-confirmation-${nanoid()}`
  ): RuntimeConfirmationRequest {
    const normalizedRequest = normalizeToolConfirmationRequest(request);
    const normalizedBinding: RuntimeConfirmationBinding = Object.freeze({
      ...binding,
      toolCallId: binding.toolCallId ?? normalizedRequest.toolCallId
    });
    const existing = flights.get(requestedConfirmationId);
    if (existing) {
      if (!isSameBinding(existing.binding, normalizedBinding) || !isEqual(existing.request, normalizedRequest)) {
        throw new Error('confirmation_identity_conflict');
      }
      return { created: false, decision: existing.decision, wasExpired: (): boolean => existing.expired };
    }

    let resolveDecision: RuntimeConfirmationResolver = (): void => undefined;
    const decision = new Promise<AIToolConfirmationDecision>((resolve): void => {
      resolveDecision = resolve;
    });
    // 先写入可序列化队列；若身份冲突抛错，不得残留无法展示和完成的内存 flight。
    queue.addRuntime({
      source: 'runtime',
      confirmationId: requestedConfirmationId,
      sessionId: normalizedBinding.sessionId,
      runtimeId: normalizedBinding.runtimeId,
      toolCallId: normalizedBinding.toolCallId,
      request: normalizedRequest,
      createdAt: new Date().toISOString()
    });
    const flight: RuntimeConfirmationFlight = {
      binding: normalizedBinding,
      decision,
      request: normalizedRequest,
      expired: false,
      resolve: resolveDecision
    };
    flights.set(requestedConfirmationId, flight);
    return { created: true, decision, wasExpired: (): boolean => flight.expired };
  }

  /**
   * 同意 Runtime confirmation。
   * @param confirmationId - confirmation 身份
   * @param grantScope - 可选授权范围
   */
  function approveConfirmation(confirmationId: string, grantScope?: 'session' | 'always'): void {
    const item = queue.items[confirmationId];
    if (item?.source !== 'runtime' || item.sessionId !== activeSessionId.value) return;
    settleRuntime(queue, confirmationId, grantScope ? { approved: true, grantScope } : { approved: true });
  }

  /**
   * 拒绝 Runtime confirmation。
   * @param confirmationId - confirmation 身份
   */
  function cancelConfirmation(confirmationId: string): void {
    const item = queue.items[confirmationId];
    if (item?.source !== 'runtime' || item.sessionId !== activeSessionId.value) return;
    settleRuntime(queue, confirmationId, { approved: false });
  }

  /**
   * 拒绝并清除当前 controller 拥有的全部 Runtime confirmation。
   */
  function expirePendingConfirmation(): void {
    const sessionId = activeSessionId.value;
    if (!sessionId) return;
    const confirmationIds = [...flights.entries()]
      .filter(([, flight]): boolean => flight.binding.sessionId === sessionId)
      .map(([confirmationId]): string => confirmationId);
    confirmationIds.forEach((confirmationId: string): void => {
      settleRuntime(queue, confirmationId, { approved: false }, true);
    });
  }

  /**
   * 释放 controller；Agent confirmation 由 Main 事实源继续持有。
   */
  function dispose(): void {
    // Runtime flights 归应用持有；组件卸载只释放其 computed 视图。
  }

  /**
   * 创建写工具 confirmation adapter。
   * @returns 工具确认适配器
   */
  function createAdapter(binding?: RuntimeConfirmationBinding): AIToolConfirmationAdapter {
    return {
      confirm: (request: AIToolConfirmationRequest): Promise<AIToolConfirmationDecision> => {
        if (!binding) return Promise.resolve({ approved: false });
        return requestConfirmation(request, binding).decision;
      },
      onExecutionStart: (): void => {
        // 底部统一队列不需要向消息流写入执行态。
      },
      onExecutionComplete: (): void => {
        // 底部统一队列不需要向消息流写入完成态。
      }
    };
  }

  return {
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
