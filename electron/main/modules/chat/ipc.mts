/**
 * @file ipc.mts
 * @description 聊天模块 IPC handler 注册。
 */
import type { ChatMessageHistoryCursor, ChatMessageRecord, ChatSession, ChatSessionModelMetadata, ChatSessionType, SessionPaginationParams } from 'types/chat';
import type { ChatHandlerResult } from 'types/electron-api';
import { ipcMain } from 'electron';
import { assertSessionHistoryWritable } from './runtime/infrastructure/locks.mjs';
import { chatSessionManager } from './service.mjs';

function wrapHandler<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => ChatHandlerResult<T> {
  return (...args: unknown[]) => {
    try {
      const result = fn(...args);
      return { ok: true, data: result };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof Error && 'code' in error ? (error as { code: string }).code : 'UNKNOWN';
      return { ok: false, error: message, code };
    }
  };
}

export function registerChatHandlers(): void {
  // ── Session (8 个) ──
  ipcMain.handle(
    'chat:session:list',
    wrapHandler((_event, type, pagination?) => {
      return chatSessionManager.getSessionsByType(type as ChatSessionType, pagination as SessionPaginationParams | undefined);
    })
  );
  ipcMain.handle(
    'chat:session:create',
    wrapHandler((_event, session) => {
      chatSessionManager.createSession(session as ChatSession);
    })
  );
  ipcMain.handle(
    'chat:session:get',
    wrapHandler((_event, sessionId) => {
      return chatSessionManager.getSessionById(sessionId as string);
    })
  );
  ipcMain.handle(
    'chat:session:branch',
    wrapHandler((_event, sourceSessionId, targetMessageId) => {
      assertSessionHistoryWritable(sourceSessionId as string);
      return chatSessionManager.branchSession(sourceSessionId as string, targetMessageId as string);
    })
  );
  ipcMain.handle(
    'chat:session:updateTitle',
    wrapHandler((_event, sessionId, title) => {
      chatSessionManager.updateSessionTitle(sessionId as string, title as string);
    })
  );
  ipcMain.handle(
    'chat:session:updateModel',
    wrapHandler((_event, sessionId, model) => {
      return chatSessionManager.updateSessionModel(sessionId as string, model as ChatSessionModelMetadata);
    })
  );
  ipcMain.handle(
    'chat:session:updateWorkspace',
    wrapHandler((_event, sessionId, workspaceRoot) => {
      return chatSessionManager.updateSessionWorkspace(sessionId as string, workspaceRoot as string);
    })
  );
  ipcMain.handle(
    'chat:session:clearWorkspace',
    wrapHandler((_event, sessionId) => {
      return chatSessionManager.clearSessionWorkspace(sessionId as string);
    })
  );
  ipcMain.handle(
    'chat:session:delete',
    wrapHandler((_event, sessionId) => {
      assertSessionHistoryWritable(sessionId as string);
      chatSessionManager.deleteSession(sessionId as string);
    })
  );
  ipcMain.handle(
    'chat:session:usage:get',
    wrapHandler((_event, sessionId) => {
      return chatSessionManager.getSessionUsage(sessionId as string);
    })
  );

  // ── Message (3 个) ──
  ipcMain.handle(
    'chat:message:list',
    wrapHandler((_event, sessionId, cursor?) => {
      return chatSessionManager.getMessages(sessionId as string, cursor as ChatMessageHistoryCursor | undefined);
    })
  );
  ipcMain.handle(
    'chat:message:add',
    wrapHandler((_event, message) => {
      assertSessionHistoryWritable((message as ChatMessageRecord).sessionId);
      chatSessionManager.addMessage(message as ChatMessageRecord);
    })
  );
  ipcMain.handle(
    'chat:message:update',
    wrapHandler((_event, message) => {
      assertSessionHistoryWritable((message as ChatMessageRecord).sessionId);
      chatSessionManager.updateMessage(message as ChatMessageRecord);
    })
  );
  ipcMain.handle(
    'chat:message:setAll',
    wrapHandler((_event, sessionId, messages) => {
      assertSessionHistoryWritable(sessionId as string);
      chatSessionManager.setSessionMessages(sessionId as string, messages as ChatMessageRecord[]);
    })
  );
}
