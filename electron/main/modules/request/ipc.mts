/**
 * @file ipc.mts
 * @description 平台托管 request IPC 代理。
 */
import type { IpcMainInvokeEvent } from 'electron';
import type { RequestInput } from 'types/request';
import { ipcMain } from 'electron';
import { REQUEST_MAX_PENDING_PER_SENDER } from './core/constants.mjs';
import { runRequest } from './service.mjs';

/** 已注册销毁回收的 WebContents ID。 */
const trackedRequestOwners = new Set<number>();

/** 每个 WebContents 当前持有的 request 控制器。 */
const requestControllersByOwner = new Map<number, Set<AbortController>>();

/**
 * 确保指定 WebContents 销毁时取消其全部 request。
 * @param event - IPC 调用事件
 */
function trackRequestOwner(event: IpcMainInvokeEvent): void {
  const ownerId = event.sender.id;
  if (trackedRequestOwners.has(ownerId)) return;

  trackedRequestOwners.add(ownerId);
  event.sender.once('destroyed', (): void => {
    trackedRequestOwners.delete(ownerId);
    const controllers = requestControllersByOwner.get(ownerId);
    requestControllersByOwner.delete(ownerId);
    controllers?.forEach((controller: AbortController): void => controller.abort(new Error('请求调用方已销毁')));
  });
}

/**
 * 执行带 owner 生命周期的托管请求。
 * @param event - IPC 调用事件
 * @param request - 托管请求输入
 * @returns 请求响应
 */
async function runOwnedRequest(event: IpcMainInvokeEvent, request: RequestInput): Promise<Awaited<ReturnType<typeof runRequest>>> {
  trackRequestOwner(event);
  const ownerId = event.sender.id;
  const controllers = requestControllersByOwner.get(ownerId) ?? new Set<AbortController>();
  if (controllers.size >= REQUEST_MAX_PENDING_PER_SENDER) {
    throw new Error('当前窗口请求过多，请稍后重试');
  }

  const controller = new AbortController();
  controllers.add(controller);
  requestControllersByOwner.set(ownerId, controllers);
  try {
    return await runRequest(request, controller.signal);
  } finally {
    controllers.delete(controller);
    if (controllers.size === 0) requestControllersByOwner.delete(ownerId);
  }
}

/**
 * 注册平台托管 request IPC handler。
 */
export function registerRequestHandlers(): void {
  ipcMain.handle('request:send', runOwnedRequest);
}
