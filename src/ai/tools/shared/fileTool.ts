/**
 * @file fileTool.ts
 * @description 文件工具（edit_file / write_file）共享的公共逻辑。
 */
import type { AIToolConfirmationAdapter, AIToolConfirmationRequest } from '../confirmation';
import type { AIToolContext, AIToolExecutionError, AIToolExecutionResult } from 'types/ai';
import { isDocumentRecord, recentFilesStorage } from '@/shared/storage';
import type { StoredDocumentRecord } from '@/shared/storage/files/types';
import { isUnsavedPath } from '@/utils/file/unsaved';
import { workspace } from '@/utils/file/workspace';
import { createToolDeniedResult, createToolFailureResult, createToolSuccessResult } from '../results';

// ─── 类型 ─────────────────────────────────────────────────────────────────────

/**
 * 路径解析结果联合类型。
 */
export type ResolveResult =
  | { path: string }
  | { path: string; outsideWorkspace: true }
  | { draft: true; originalPath: string }
  | { error: AIToolExecutionResult<never> };

/**
 * 未保存草稿读写能力接口，供文件编辑与写入工具共用。
 */
export interface UnsavedDraftOptions {
  /** 按草稿 ID 读取未保存文件。 */
  getUnsavedDraft?: (fileId: string) => Promise<StoredDocumentRecord | null>;
  /** 更新未保存文件内容。 */
  updateUnsavedDraft?: (fileId: string, updates: Partial<StoredDocumentRecord>) => Promise<StoredDocumentRecord>;
}

// ─── 错误映射 ─────────────────────────────────────────────────────────────────

/**
 * 将 native 抛出的未知错误映射为工具错误码与消息。
 * @param error - 未知错误
 * @returns 错误码与消息
 */
export function mapNativeError(error: unknown): { code: AIToolExecutionError['code']; message: string } {
  let rawCode: string | null = null;
  if (typeof error === 'object' && error !== null && 'code' in error && typeof (error as Record<string, unknown>).code === 'string') {
    rawCode = (error as Record<string, unknown>).code as string;
  }

  let message = '操作失败';
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string' && error.trim()) {
    message = error;
  }

  const code: AIToolExecutionError['code'] = rawCode === null ? 'EXECUTION_FAILED' : 'PERMISSION_DENIED';
  return { code, message };
}

// ─── 路径解析 ─────────────────────────────────────────────────────────────────

/**
 * 解析输入路径并判断是否在工作区内。
 * 工作区外的路径不再直接拒绝，而是返回 outsideWorkspace 标记，由调用方决定是否弹出确认。
 * @param filePath - 用户输入路径
 * @param workspaceRoot - 工作区根目录
 * @param toolName - 工具名称，用于构造错误结果
 * @returns 规范化后的目标路径、草稿降级、工作区外标记或失败结果
 */
export function resolveTargetPath(filePath: string, workspaceRoot: string | null, toolName: string): ResolveResult {
  if (isUnsavedPath(filePath)) {
    return { path: filePath };
  }

  if (!workspaceRoot) {
    if (!workspace.isAbsoluteFilePath(filePath)) {
      return { draft: true, originalPath: filePath };
    }

    return { path: filePath };
  }

  if (workspace.isAbsoluteFilePath(filePath)) {
    if (!workspace.contains(workspaceRoot, filePath)) {
      return { path: filePath, outsideWorkspace: true };
    }

    return { path: filePath };
  }

  const resolvedPath = workspace.resolveWithin(filePath, workspaceRoot);
  if (!resolvedPath) {
    return { error: createToolFailureResult(toolName, 'PERMISSION_DENIED', '相对路径超出了当前工作区范围') };
  }

  return { path: resolvedPath };
}

// ─── 文档上下文 ────────────────────────────────────────────────────────────────

/**
 * 判断目标路径是否对应当前激活文档（包含 path 和 locator 两种匹配）。
 * @param context - 工具执行上下文
 * @param targetPath - 规范化后的目标路径
 * @returns 是否命中当前激活文档
 */
export function isActiveDocumentTarget(context: AIToolContext | undefined, targetPath: string): boolean {
  return context?.document.path === targetPath || context?.document.locator === targetPath;
}

// ─── 未保存草稿 I/O ───────────────────────────────────────────────────────────

/**
 * 按草稿 ID 读取未保存文件内容。
 * @param options - 包含草稿读写能力的选项对象
 * @param fileId - 草稿 ID
 * @returns 草稿记录，不存在时返回 null
 */
export async function readUnsavedDraft(options: UnsavedDraftOptions, fileId: string): Promise<StoredDocumentRecord | null> {
  if (!fileId.trim()) return null;
  const getter =
    options.getUnsavedDraft ??
    (async (id: string) => {
      const record = await recentFilesStorage.getRecentFile(id);
      return isDocumentRecord(record) ? record : null;
    });
  return getter(fileId);
}

/**
 * 按草稿 ID 更新未保存文件内容。
 * @param options - 包含草稿读写能力的选项对象
 * @param fileId - 草稿 ID
 * @param updates - 需更新的字段
 * @returns 更新后的草稿记录
 */
export async function writeUnsavedDraft(options: UnsavedDraftOptions, fileId: string, updates: Partial<StoredDocumentRecord>): Promise<StoredDocumentRecord> {
  if (!fileId.trim()) throw new Error('未保存文档 ID 不能为空');
  const updater = options.updateUnsavedDraft ?? ((id: string, u: Partial<StoredDocumentRecord>) => recentFilesStorage.updateRecentFile(id, u));
  return updater(fileId, updates);
}

// ─── 确认流程 ─────────────────────────────────────────────────────────────────

/**
 * 向用户请求确认，若拒绝则返回可继续失败结果，否则返回 null。
 * @param adapter - 确认适配器
 * @param request - 确认请求
 * @param toolName - 工具名称
 * @returns 用户拒绝结果或 null
 */
export async function confirmOrCancel(
  adapter: AIToolConfirmationAdapter,
  request: AIToolConfirmationRequest,
  toolName: string
): Promise<AIToolExecutionResult<never> | null> {
  const decision = await adapter.confirm(request);
  const confirmed = typeof decision === 'boolean' ? decision : decision.approved;

  return confirmed ? null : createToolDeniedResult(toolName);
}

/**
 * 执行带生命周期回调的写入操作，统一处理成功/失败结果。
 * @param adapter - 确认适配器
 * @param request - 确认请求
 * @param toolName - 工具名称
 * @param defaultErrorMessage - 操作失败时的默认错误消息
 * @param operation - 实际写操作
 * @returns 工具执行结果
 */
export async function executeConfirmedWrite<T>(
  adapter: AIToolConfirmationAdapter,
  request: AIToolConfirmationRequest,
  toolName: string,
  defaultErrorMessage: string,
  operation: () => Promise<T>
): Promise<AIToolExecutionResult<T>> {
  await adapter.onExecutionStart?.(request);

  try {
    const result = await operation();
    await adapter.onExecutionComplete?.(request, { status: 'success' });
    return createToolSuccessResult(toolName, result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : defaultErrorMessage;
    await adapter.onExecutionComplete?.(request, { status: 'failure', errorMessage });
    return createToolFailureResult(toolName, 'EXECUTION_FAILED', errorMessage);
  }
}
