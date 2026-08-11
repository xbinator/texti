/**
 * @file messageWorker.ts
 * @description BMessage 共享 Markdown Worker 的请求路由与取消订阅管理。
 */
import type { ParseMessageNodesOptions, ParseMessageNodesResult } from '../types';

/** Worker 解析请求句柄。 */
export interface MessageWorkerRequest {
  /** 本次解析的单调请求 ID。 */
  requestId: number;
  /** Worker 解析结果。 */
  result: Promise<ParseMessageNodesResult | null>;
}

/** 发给 Markdown Worker 的请求载荷。 */
export interface MessageWorkerRequestPayload {
  /** 本次解析的单调请求 ID。 */
  requestId: number;
  /** 可结构化克隆的解析选项。 */
  options: ParseMessageNodesOptions;
}

/** Markdown Worker 返回载荷。 */
export interface MessageWorkerResponse {
  /** 对应请求 ID。 */
  requestId: number;
  /** 成功解析结果。 */
  result?: ParseMessageNodesResult;
  /** 失败错误类型，不携带正文。 */
  errorName?: string;
}

/** 单个待处理 Worker 请求。 */
interface PendingMessageParse {
  /** 可结构化克隆的解析选项。 */
  options: ParseMessageNodesOptions;
  /** 完成请求。 */
  resolve: (result: ParseMessageNodesResult | null) => void;
  /** 拒绝请求。 */
  reject: (error: Error) => void;
  /** 防止单个异常 Markdown 永久阻塞共享 Worker 的超时器。 */
  timeoutId: ReturnType<typeof setTimeout> | null;
}

/** 单次 Markdown Worker 解析的最大等待时间。 */
export const MESSAGE_WORKER_TIMEOUT_MS = 5_000;

let sharedWorker: Worker | null = null;
let nextRequestId = 0;
let activeRequestId: number | null = null;
const queuedRequestIds: number[] = [];
const pendingParses = new Map<number, PendingMessageParse>();
let dispatchQueuedParse: () => void = (): void => undefined;

/**
 * 创建只包含稳定类型的 Worker 错误。
 * @param name - 错误类型
 * @returns 不含消息正文的 Error
 */
function createWorkerError(name: string): Error {
  const error = new Error('Markdown Worker 解析失败');
  error.name = name || 'Error';
  return error;
}

/**
 * 拒绝全部在途请求并清理各自超时器。
 * @param error - 不含正文的统一失败对象
 */
function rejectPendingParses(error: Error): void {
  pendingParses.forEach((pending: PendingMessageParse): void => {
    if (pending.timeoutId) clearTimeout(pending.timeoutId);
    pending.reject(error);
  });
  pendingParses.clear();
}

/**
 * 接收 Worker 响应并完成仍在订阅的请求。
 * @param event - Worker 消息事件
 */
function handleWorkerMessage(event: MessageEvent<MessageWorkerResponse>): void {
  const response = event.data;
  if (response.requestId !== activeRequestId) return;
  activeRequestId = null;
  const pending = pendingParses.get(response.requestId);
  if (pending) {
    pendingParses.delete(response.requestId);
    if (pending.timeoutId) clearTimeout(pending.timeoutId);
    if (response.result) pending.resolve(response.result);
    else pending.reject(createWorkerError(response.errorName ?? 'Error'));
  }
  dispatchQueuedParse();
}

/**
 * 在 Worker 自身崩溃时拒绝全部在途请求并允许下次重建。
 * @param worker - 产生错误的 Worker 实例
 * @param event - Worker 错误事件
 */
function handleWorkerError(worker: Worker, event: ErrorEvent): void {
  event.preventDefault();
  if (sharedWorker !== worker) return;
  const error = createWorkerError(event.error instanceof Error ? event.error.name : 'WorkerError');
  rejectPendingParses(error);
  activeRequestId = null;
  queuedRequestIds.splice(0);
  sharedWorker?.terminate();
  sharedWorker = null;
}

/**
 * 共享 Worker 超时后拒绝队列并允许后续请求重建 Worker。
 * @param requestId - 触发超时的请求 ID
 */
function handleWorkerTimeout(requestId: number): void {
  if (activeRequestId !== requestId || !pendingParses.has(requestId)) return;
  sharedWorker?.terminate();
  sharedWorker = null;
  activeRequestId = null;
  queuedRequestIds.splice(0);
  rejectPendingParses(createWorkerError('WorkerTimeoutError'));
}

/**
 * 读取或创建跨 BMessage 实例共享的 Markdown Worker。
 * @returns 可用 Worker；当前环境不支持时返回 null
 */
function getMessageWorker(): Worker | null {
  if (sharedWorker) return sharedWorker;
  if (typeof Worker === 'undefined') return null;
  try {
    sharedWorker = new Worker(new URL('./messageParser.worker.ts', import.meta.url), { type: 'module', name: 'b-message-parser' });
    sharedWorker.onmessage = handleWorkerMessage;
    const worker = sharedWorker;
    sharedWorker.onerror = (event: ErrorEvent): void => handleWorkerError(worker, event);
    return sharedWorker;
  } catch {
    sharedWorker = null;
    return null;
  }
}

/** 仅在共享 Worker 空闲时投递队首仍有效请求。 */
dispatchQueuedParse = (): void => {
  if (activeRequestId !== null) return;

  while (queuedRequestIds.length > 0) {
    const requestId = queuedRequestIds.shift();
    if (requestId === undefined) return;
    const pending = pendingParses.get(requestId);
    if (!pending) continue;
    const worker = getMessageWorker();
    if (!worker) {
      pendingParses.delete(requestId);
      pending.reject(createWorkerError('WorkerUnavailableError'));
      continue;
    }

    activeRequestId = requestId;
    pending.timeoutId = setTimeout((): void => handleWorkerTimeout(requestId), MESSAGE_WORKER_TIMEOUT_MS);
    try {
      const payload: MessageWorkerRequestPayload = { requestId, options: pending.options };
      worker.postMessage(payload);
      return;
    } catch (error) {
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      pendingParses.delete(requestId);
      activeRequestId = null;
      pending.reject(createWorkerError(error instanceof Error ? error.name : 'WorkerPostError'));
      worker.terminate();
      sharedWorker = null;
    }
  }
};

/**
 * 把大 Markdown 消息交给共享 Worker 解析。
 * @param options - 解析快照
 * @returns 可取消订阅的请求句柄
 */
export function parseMessageInWorker(options: ParseMessageNodesOptions): MessageWorkerRequest {
  nextRequestId += 1;
  const requestId = nextRequestId;
  const result = new Promise<ParseMessageNodesResult | null>((resolve, reject): void => {
    pendingParses.set(requestId, { resolve, reject, timeoutId: null, options });
  });
  queuedRequestIds.push(requestId);
  dispatchQueuedParse();
  return { requestId, result };
}

/**
 * 取消单个组件对 Worker 结果的订阅，不影响其他气泡请求。
 * @param requestId - 待取消请求 ID
 */
export function cancelMessageParse(requestId: number): void {
  const pending = pendingParses.get(requestId);
  if (!pending) return;
  if (pending.timeoutId) clearTimeout(pending.timeoutId);
  pendingParses.delete(requestId);
  pending.resolve(null);
  if (activeRequestId === requestId) {
    sharedWorker?.terminate();
    sharedWorker = null;
    activeRequestId = null;
  }
  dispatchQueuedParse();
}
