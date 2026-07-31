/**
 * @file ipc.mts
 * @description ChatRuntime IPC handler 注册。
 */
import type {
  ChatRuntimeAbortInput,
  ChatRuntimeAutoNameInput,
  ChatRuntimeBridgeResponseInput,
  ChatRuntimeCompactInput,
  ChatRuntimeContinueInput,
  ChatRuntimeEstimateContextInput,
  ChatRuntimeHandlerResult,
  ChatRuntimeRecoverySnapshot,
  ChatRuntimeSendInput,
  ChatRuntimeSubmitConfirmationInput,
  ChatRuntimeSubmitMessagePartInput,
  ChatRuntimeSubmitUserChoiceInput,
  ChatRuntimeSubmitToolResultInput
} from 'types/chat-runtime';
import { ipcMain } from 'electron';
import { chatSessionManager } from '../service.mjs';
import { ChatRuntimeError } from './errors.mjs';
import { chatRuntimeService } from './service.mjs';

/**
 * 拒绝在已经删除的显式 Session 上启动新 Runtime。
 * 检查与 Runtime 同步取得写锁之间没有 await，可与同步删除 handler 形成完整时序。
 * @param sessionId - Renderer 请求携带的持久化 Session ID
 */
function assertRuntimeSessionExists(sessionId: string | undefined): void {
  if (!sessionId || chatSessionManager.getSessionById(sessionId)) return;
  throw new ChatRuntimeError('SESSION_NOT_FOUND', `Session ${sessionId} does not exist`);
}

/**
 * 从未知错误中读取稳定错误码。
 * @param error - 捕获到的错误
 * @returns 稳定错误码
 */
function getRuntimeErrorCode(error: unknown): string {
  if (error instanceof Error && 'code' in error) {
    const { code } = error as { code?: unknown };
    if (typeof code === 'string' && code.length > 0) return code;
  }

  return 'UNKNOWN';
}

/**
 * 将 runtime handler 结果包成统一 IPC 响应。
 * @param fn - runtime handler
 * @returns IPC handler
 */
function wrapRuntimeHandler<T>(fn: (...args: unknown[]) => Promise<T> | T): (...args: unknown[]) => Promise<ChatRuntimeHandlerResult<T>> {
  return async (...args: unknown[]): Promise<ChatRuntimeHandlerResult<T>> => {
    try {
      const result = await fn(...args);
      return { ok: true, data: result };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message, code: getRuntimeErrorCode(error) };
    }
  };
}

/**
 * 注册 ChatRuntime IPC handler。
 */
export function registerChatRuntimeHandlers(): void {
  ipcMain.handle(
    'chat:runtime:list-active',
    wrapRuntimeHandler(async (): Promise<ChatRuntimeRecoverySnapshot[]> => {
      await chatRuntimeService.recoverInterruptedCompactions();
      return chatRuntimeService.listRecoverySnapshots();
    })
  );

  ipcMain.handle(
    'chat:runtime:estimate-context',
    wrapRuntimeHandler((_event, input) => chatRuntimeService.estimateContext(input as ChatRuntimeEstimateContextInput))
  );

  ipcMain.handle(
    'chat:runtime:send',
    wrapRuntimeHandler((_event, input) => {
      const runtimeInput = input as ChatRuntimeSendInput;
      assertRuntimeSessionExists(runtimeInput.sessionId);
      return chatRuntimeService.send(runtimeInput);
    })
  );

  ipcMain.handle(
    'chat:runtime:continue',
    wrapRuntimeHandler((_event, input) => {
      const runtimeInput = input as ChatRuntimeContinueInput;
      assertRuntimeSessionExists(runtimeInput.sessionId);
      return chatRuntimeService.continue(runtimeInput);
    })
  );

  ipcMain.handle(
    'chat:runtime:compact',
    wrapRuntimeHandler((_event, input) => {
      const runtimeInput = input as ChatRuntimeCompactInput;
      assertRuntimeSessionExists(runtimeInput.sessionId);
      return chatRuntimeService.compact(runtimeInput);
    })
  );

  ipcMain.handle(
    'chat:runtime:submit-user-choice',
    wrapRuntimeHandler((_event, input) => {
      const runtimeInput = input as ChatRuntimeSubmitUserChoiceInput;
      assertRuntimeSessionExists(runtimeInput.sessionId);
      return chatRuntimeService.submitUserChoice(runtimeInput);
    })
  );

  ipcMain.handle(
    'chat:runtime:submit-confirmation',
    wrapRuntimeHandler((_event, input) => chatRuntimeService.submitConfirmation(input as ChatRuntimeSubmitConfirmationInput))
  );

  ipcMain.handle(
    'chat:runtime:bridge-response',
    wrapRuntimeHandler((_event, input) => chatRuntimeService.submitBridgeResponse(input as ChatRuntimeBridgeResponseInput))
  );

  ipcMain.handle(
    'chat:runtime:auto-name',
    wrapRuntimeHandler((_event, input) => chatRuntimeService.autoName(input as ChatRuntimeAutoNameInput))
  );

  ipcMain.handle(
    'chat:runtime:abort',
    wrapRuntimeHandler((_event, input) => chatRuntimeService.abort(input as ChatRuntimeAbortInput))
  );

  ipcMain.handle(
    'chat:runtime:tool-result',
    wrapRuntimeHandler((_event, input) => chatRuntimeService.submitToolResult(input as ChatRuntimeSubmitToolResultInput))
  );

  ipcMain.handle(
    'chat:runtime:message-part',
    wrapRuntimeHandler((_event, input) => chatRuntimeService.submitMessagePart(input as ChatRuntimeSubmitMessagePartInput))
  );
}
