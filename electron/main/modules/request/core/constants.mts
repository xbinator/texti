/**
 * @file constants.mts
 * @description 平台托管 request 的主进程常量。
 */

/** 托管 request 默认超时时间。 */
export const REQUEST_TIMEOUT_MS = 10000;

/** 托管 request 超时错误提示。 */
export const REQUEST_TIMEOUT_MESSAGE = '请求超时，请检查网络是否正常';

/** 托管 request 响应正文最大字节数。 */
export const REQUEST_MAX_RESPONSE_BYTES = 1_000_000;

/** 托管 request 最大并发数。 */
export const REQUEST_MAX_CONCURRENT = 4;

/** 托管 request 最大等待任务数。 */
export const REQUEST_MAX_PENDING = 64;

/** 单个渲染进程最多同时持有的托管 request 数。 */
export const REQUEST_MAX_PENDING_PER_SENDER = 16;
