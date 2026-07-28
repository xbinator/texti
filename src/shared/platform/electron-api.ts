/**
 * @file electron-api.ts
 * @description Renderer 侧 Electron API 读取、类型导出与结果解包工具。
 */
import type { ElectronAPI } from 'types/electron-api';

export type {
  ChatHandlerResult,
  DbExecuteResult,
  ElectronAPI,
  ElectronDialogFilter,
  ElectronExportPdfOptions,
  ElectronFileResult,
  ElectronOpenFileOptions,
  ElectronReadWorkspaceFileOptions,
  ElectronReadWorkspaceFileResult,
  ElectronSaveFileOptions,
  ElectronUpdateCheckResult
} from 'types/electron-api';
export type { ChatAgentConfirmationSnapshot, ChatAgentResolveConfirmationInput } from 'types/chat-agent';

/**
 * 带稳定错误码的 Electron API 错误。
 */
interface ElectronAPIError extends Error {
  /** 主进程返回的错误码。 */
  code: string;
}

/**
 * 读取当前窗口注入的 Electron API。
 * @returns Electron API；非 Electron 环境返回 undefined
 */
function readElectronAPI(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined;
}

/**
 * 判断当前环境是否提供 Electron API。
 * @returns 是否存在 Electron API
 */
export const hasElectronAPI = (): boolean => readElectronAPI() !== undefined;

/**
 * 获取当前窗口注入的 Electron API。
 * @returns Electron API
 * @throws 当前环境未注入 Electron API 时抛出错误
 */
export function getElectronAPI(): ElectronAPI {
  const api = readElectronAPI();

  if (!api) throw new Error('Electron API is not available');

  return api;
}

/**
 * 解包 Electron API 结果，并将失败信息转换为带错误码的 Error。
 * @param result - 主进程返回的成功或失败结果
 * @returns 成功结果数据
 * @throws 主进程返回的错误消息与错误码
 */
export function unwrap<T>(result: { ok: true; data: T } | { ok: false; error: string; code: string }): T {
  if (!result.ok) {
    const error = new Error(result.error) as ElectronAPIError;
    error.code = result.code;
    throw error;
  }
  return result.data;
}
