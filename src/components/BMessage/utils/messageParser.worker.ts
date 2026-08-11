/**
 * @file messageParser.worker.ts
 * @description 在独立线程中解析可结构化克隆的 BMessage Markdown 节点。
 */
import type { MessageWorkerRequestPayload, MessageWorkerResponse } from './messageWorker';
import { parseMessageNodes } from './messageParser';

/** Markdown Worker 最小全局作用域。 */
interface MessageParserWorkerScope {
  /** 接收主线程解析请求。 */
  onmessage: ((event: MessageEvent<MessageWorkerRequestPayload>) => void) | null;
  /** 返回解析结果或错误类型。 */
  postMessage: (response: MessageWorkerResponse) => void;
}

const workerScope = globalThis as unknown as MessageParserWorkerScope;

workerScope.onmessage = (event: MessageEvent<MessageWorkerRequestPayload>): void => {
  const { requestId, options } = event.data;
  try {
    workerScope.postMessage({ requestId, result: parseMessageNodes(options) });
  } catch (error) {
    workerScope.postMessage({ requestId, errorName: error instanceof Error ? error.name : 'Error' });
  }
};
