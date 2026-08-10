/**
 * @file service.mts
 * @description 平台托管 request 的主进程执行服务。
 */
import type { RequestInput, RequestResponse } from 'types/request';
import { createRequestBodyInit } from './core/body.mjs';
import { REQUEST_MAX_CONCURRENT, REQUEST_MAX_PENDING, REQUEST_TIMEOUT_MESSAGE, REQUEST_TIMEOUT_MS } from './core/constants.mjs';
import { createRequestQueue } from './core/queue.mjs';
import { readRequestResponseData } from './core/response.mjs';
import { createRequestUrl } from './core/url.mjs';

/** 主进程托管请求队列。 */
const requestQueue = createRequestQueue(REQUEST_MAX_CONCURRENT, REQUEST_MAX_PENDING);

/**
 * 创建 fetch 初始化参数。
 * @param request - 托管请求输入
 * @param signal - 中断信号
 * @returns fetch 初始化参数
 */
function createFetchInit(request: RequestInput, signal: AbortSignal): RequestInit {
  return { method: request.method, redirect: 'follow', signal, ...createRequestBodyInit(request) };
}

/**
 * 执行单个托管请求。
 * @param request - 托管请求输入
 * @param externalSignal - 调用方取消信号
 * @returns 请求响应
 */
async function executeRequest(request: RequestInput, externalSignal?: AbortSignal): Promise<RequestResponse> {
  const url = createRequestUrl(request);
  const controller = new AbortController();
  const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
  let isTimeout = false;
  const timeout = setTimeout((): void => {
    isTimeout = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), createFetchInit(request, signal));
    const data = await readRequestResponseData(response);

    return {
      url: response.url,
      status: response.status,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries()),
      data
    };
  } catch (error) {
    if (isTimeout) {
      throw new Error(REQUEST_TIMEOUT_MESSAGE);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 执行平台托管请求。
 * @param request - 托管请求输入
 * @param signal - 调用方取消信号
 * @returns 请求响应
 */
export async function runRequest(request: RequestInput, signal?: AbortSignal): Promise<RequestResponse> {
  return requestQueue.add(() => executeRequest(request, signal), { signal });
}
