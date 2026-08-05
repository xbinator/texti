/**
 * @file runtimeBridge.ts
 * @description BChat ChatRuntime renderer bridge 请求处理。
 */
import type { AIToolExecutionError } from 'types/ai';
import type { ChatRuntimeBridgeRequestEvent } from 'types/chat-runtime';
import type { OpenDraftInput, OpenDraftResult } from '@/ai/tools/shared/types';
import type { ChatBridgeDispatchResult } from '@/hooks/useChat/useToolContext';
import { isDocumentRecord } from '@/shared/storage';
import type { StoredDocumentRecord } from '@/shared/storage/files/types';
import { asyncTo } from '@/utils/asyncTo';
import { isUnsavedPath, parseUnsavedPath } from '@/utils/file/unsaved';

/** Bridge settings domain types. */
/** 可通过 ChatRuntime 暴露给模型的设置键。 */
export type BChatRuntimeSettingKey = 'theme' | 'themePreset' | 'sourceMode' | 'editorPageWidth';

/** ChatRuntime 设置快照。 */
export interface BChatRuntimeSettingsSnapshot {
  /** 当前设置键值。 */
  settings: Partial<Record<BChatRuntimeSettingKey, string | boolean | number>>;
}

/** ChatRuntime 设置修改输入。 */
export interface BChatRuntimeApplySettingInput {
  /** 设置键。 */
  key: BChatRuntimeSettingKey;
  /** 设置值。 */
  value: unknown;
}

/** ChatRuntime 设置修改结果。 */
export interface BChatRuntimeApplySettingResult {
  /** 是否已应用。 */
  applied: true;
  /** 设置键。 */
  key: BChatRuntimeSettingKey;
  /** 修改前的值。 */
  previousValue: string | boolean | number;
  /** 修改后的值。 */
  currentValue: string | boolean | number;
}

/** Bridge dependency surface. */
/** BChat runtime bridge 依赖。 */
export interface BChatRuntimeBridgeDependencies {
  /** 向 Runtime 启动时绑定的页面工具上下文分发请求。 */
  dispatchToolBridge?: (event: ChatRuntimeBridgeRequestEvent) => Promise<ChatBridgeDispatchResult>;
  /** 通过最近文件 ID 获取文件记录。 */
  getRecentFileById?: (fileId: string) => StoredDocumentRecord | undefined | Promise<StoredDocumentRecord | undefined>;
  /** 更新最近文件记录。 */
  updateRecentFileById?: (fileId: string, updates: Partial<StoredDocumentRecord>) => Promise<StoredDocumentRecord>;
  /** 获取应用设置快照。 */
  getSettingsSnapshot?: () => BChatRuntimeSettingsSnapshot;
  /** 应用设置修改。 */
  applySetting?: (input: BChatRuntimeApplySettingInput) => BChatRuntimeApplySettingResult;
  /** 创建并打开未保存草稿。 */
  openDraft?: (input: OpenDraftInput) => Promise<OpenDraftResult>;
  /** 通过文件路径打开文件标签页。 */
  openFileByPath?: (filePath: string) => Promise<{ id: string } | null>;
  /** 在内置 WebView 中打开 URL。 */
  openInWebview?: (url: string) => Promise<void> | void;
  /** 在系统默认程序中打开 URL。 */
  openExternal?: (url: string) => Promise<void> | void;
}

/** 文件内容 bridge 快照。 */
export interface BChatRuntimeFileContentSnapshot {
  /** Tibis 文档系统中的稳定 artifact ID。 */
  artifactId?: string;
  /** 原始请求路径。 */
  path: string;
  /** 文件内容。 */
  content: string;
}

/** ChatRuntime 打开资源类型。 */
type BChatRuntimeOpenResourceType = 'file' | 'webview' | 'external';

/** ChatRuntime 打开资源结果。 */
interface BChatRuntimeOpenResourceResult {
  /** 原始路径或 URL。 */
  path: string;
  /** 资源类型。 */
  resourceType: BChatRuntimeOpenResourceType;
  /** 是否打开成功。 */
  opened: true;
  /** 文件 ID。 */
  fileId?: string;
}

/** Shared bridge helpers. */
/**
 * 创建带稳定错误码的 bridge 错误。
 * @param code - 工具错误码
 * @param message - 错误信息
 * @returns 错误对象
 */
function createBridgeError(code: AIToolExecutionError['code'], message: string): Error & { code: AIToolExecutionError['code'] } {
  const error = new Error(message) as Error & { code: AIToolExecutionError['code'] };
  error.code = code;
  return error;
}

/**
 * 判断值是否为对象记录。
 * @param value - 待判断值
 * @returns 是否为对象记录
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 安全读取 Bridge 错误码。
 * @param error - 原始错误
 * @returns 错误码或 undefined
 */
function readBridgeErrorCode(error: unknown): unknown {
  if (!isRecord(error)) return undefined;
  try {
    return error.code;
  } catch {
    return undefined;
  }
}

/**
 * 沿 cause 链定位最原始的稳定业务错误，并防止循环引用卡死。
 * @param error - 可能被多次归一化的错误
 * @returns 带业务码的错误，或 cause 链最深处的原始异常
 */
function unwrapBridgeError(error: unknown): unknown {
  const visited = new Set<object>();
  let current = error;
  let deepest = error;

  while (isRecord(current)) {
    if (visited.has(current)) return deepest;
    visited.add(current);
    deepest = current;
    if (readBridgeErrorCode(current) !== undefined) return current;

    try {
      if (current.cause === undefined) return current;
      current = current.cause;
    } catch {
      return current;
    }
  }

  return current;
}

/**
 * 请求 Runtime 绑定页面处理 Bridge 事件。
 * @param event - Bridge 请求事件
 * @param dependencies - Bridge 依赖
 * @returns 页面分发结果
 */
async function requestPageBridge(event: ChatRuntimeBridgeRequestEvent, dependencies: BChatRuntimeBridgeDependencies): Promise<ChatBridgeDispatchResult> {
  if (!dependencies.dispatchToolBridge) {
    throw createBridgeError('EDITOR_UNAVAILABLE', 'Runtime 未绑定可用的页面工具上下文');
  }

  const [error, result] = await asyncTo(dependencies.dispatchToolBridge(event));
  if (error) {
    // Registry 错误可能经过多层 asyncTo，沿 cause 链恢复稳定业务码。
    throw unwrapBridgeError(error);
  }
  return result;
}

/**
 * 分发并要求 Runtime 绑定页面处理 Bridge 事件。
 * @param event - Bridge 请求事件
 * @param dependencies - Bridge 依赖
 * @returns 页面响应数据
 */
async function dispatchPageBridge(event: ChatRuntimeBridgeRequestEvent, dependencies: BChatRuntimeBridgeDependencies): Promise<unknown> {
  const result = await requestPageBridge(event, dependencies);
  if (!result.handled) {
    throw createBridgeError('ACTION_NOT_SUPPORTED', `绑定页面不支持 Bridge 请求：${event.kind}`);
  }
  return result.data;
}

/** File content bridge handlers. */

/**
 * 读取文件内容快照。
 * @param event - bridge 请求事件
 * @param dependencies - bridge 依赖
 * @returns 文件内容快照
 */
async function readFileContentSnapshot(
  event: ChatRuntimeBridgeRequestEvent,
  dependencies: BChatRuntimeBridgeDependencies
): Promise<BChatRuntimeFileContentSnapshot> {
  const payload = isRecord(event.payload) ? event.payload : {};
  const filePath = typeof payload.path === 'string' ? payload.path.trim() : '';
  if (!filePath) {
    throw createBridgeError('INVALID_INPUT', '文件路径不能为空');
  }

  if (isUnsavedPath(filePath)) {
    const unsavedReference = parseUnsavedPath(filePath);
    const file = unsavedReference ? await dependencies.getRecentFileById?.(unsavedReference.fileId) : undefined;
    if (!isDocumentRecord(file)) {
      throw createBridgeError('EDITOR_UNAVAILABLE', '当前没有可用的未保存文件内容');
    }

    return {
      artifactId: file.id,
      path: filePath,
      content: file.content
    };
  }

  throw createBridgeError('EDITOR_UNAVAILABLE', '真实文件由主进程直接读写磁盘，不再通过编辑器 bridge');
}

/**
 * 写入已打开编辑器或未保存草稿内容。
 * @param event - bridge 请求事件
 * @param dependencies - bridge 依赖
 * @returns 写入结果
 */
async function writeFileContent(event: ChatRuntimeBridgeRequestEvent, dependencies: BChatRuntimeBridgeDependencies): Promise<BChatRuntimeFileContentSnapshot> {
  const payload = isRecord(event.payload) ? event.payload : {};
  const filePath = typeof payload.path === 'string' ? payload.path.trim() : '';
  const content = typeof payload.content === 'string' ? payload.content : '';
  if (!filePath) {
    throw createBridgeError('INVALID_INPUT', '文件路径不能为空');
  }

  if (isUnsavedPath(filePath)) {
    const unsavedReference = parseUnsavedPath(filePath);
    if (!unsavedReference) {
      throw createBridgeError('INVALID_INPUT', `未识别的未保存文档路径：${filePath}`);
    }

    if (!dependencies.updateRecentFileById) {
      throw createBridgeError('EDITOR_UNAVAILABLE', '当前没有可写入的未保存文件内容');
    }

    await dependencies.updateRecentFileById(unsavedReference.fileId, { content, modifiedAt: Date.now() });
    return { artifactId: unsavedReference.fileId, path: filePath, content };
  }

  throw createBridgeError('EDITOR_UNAVAILABLE', '真实文件由主进程直接读写磁盘，不再通过编辑器 bridge');
}

/** Settings bridge handlers. */
/**
 * 读取应用设置快照。
 * @param dependencies - bridge 依赖
 * @returns 设置快照
 */
function readSettingsSnapshot(dependencies: BChatRuntimeBridgeDependencies): BChatRuntimeSettingsSnapshot {
  if (!dependencies.getSettingsSnapshot) {
    throw createBridgeError('EDITOR_UNAVAILABLE', '当前没有可用的设置快照');
  }

  return dependencies.getSettingsSnapshot();
}

/**
 * 判断值是否为设置键。
 * @param value - 待判断值
 * @returns 是否为设置键
 */
function isSettingKey(value: unknown): value is BChatRuntimeSettingKey {
  return value === 'theme' || value === 'themePreset' || value === 'sourceMode' || value === 'editorPageWidth';
}

/**
 * 应用应用设置修改。
 * @param event - bridge 请求事件
 * @param dependencies - bridge 依赖
 * @returns 设置修改结果
 */
function applySetting(event: ChatRuntimeBridgeRequestEvent, dependencies: BChatRuntimeBridgeDependencies): BChatRuntimeApplySettingResult {
  if (!dependencies.applySetting) {
    throw createBridgeError('EDITOR_UNAVAILABLE', '当前环境不支持修改设置');
  }

  const payload = isRecord(event.payload) ? event.payload : {};
  if (!isSettingKey(payload.key)) {
    throw createBridgeError('INVALID_INPUT', '不支持的设置键。');
  }

  return dependencies.applySetting({
    key: payload.key,
    value: payload.value
  });
}

/** Draft and resource bridge handlers. */
/**
 * 创建并打开未保存草稿。
 * @param event - bridge 请求事件
 * @param dependencies - bridge 依赖
 * @returns 未保存草稿结果
 */
async function openDraft(event: ChatRuntimeBridgeRequestEvent, dependencies: BChatRuntimeBridgeDependencies): Promise<OpenDraftResult> {
  if (!dependencies.openDraft) {
    throw createBridgeError('EXECUTION_FAILED', '当前环境不支持创建未保存草稿');
  }

  const payload = isRecord(event.payload) ? event.payload : {};
  const originalPath = typeof payload.originalPath === 'string' ? payload.originalPath.trim() : '';
  const content = typeof payload.content === 'string' ? payload.content : '';
  if (!originalPath) {
    throw createBridgeError('INVALID_INPUT', '草稿原始路径不能为空');
  }

  return dependencies.openDraft({ originalPath, content });
}

/**
 * 判断 bridge payload 是否为打开资源类型。
 * @param value - 待判断值
 * @returns 是否为打开资源类型
 */
function isOpenResourceType(value: unknown): value is BChatRuntimeOpenResourceType {
  return value === 'file' || value === 'webview' || value === 'external';
}

/**
 * 执行 renderer 侧资源打开动作。
 * @param event - bridge 请求事件
 * @param dependencies - bridge 依赖
 * @returns 打开结果
 */
async function openResource(event: ChatRuntimeBridgeRequestEvent, dependencies: BChatRuntimeBridgeDependencies): Promise<BChatRuntimeOpenResourceResult> {
  const payload = isRecord(event.payload) ? event.payload : {};
  const path = typeof payload.path === 'string' ? payload.path.trim() : '';
  const resourceType = isOpenResourceType(payload.resourceType) ? payload.resourceType : null;
  if (!path || !resourceType) {
    throw createBridgeError('INVALID_INPUT', '打开资源参数无效');
  }

  if (resourceType === 'webview') {
    if (!dependencies.openInWebview) {
      throw createBridgeError('EXECUTION_FAILED', '当前环境不支持打开网页');
    }

    await dependencies.openInWebview(path);
    return { path, resourceType, opened: true };
  }

  if (resourceType === 'external') {
    if (!dependencies.openExternal) {
      throw createBridgeError('EXECUTION_FAILED', '当前环境不支持打开外部链接');
    }

    await dependencies.openExternal(path);
    return { path, resourceType, opened: true };
  }

  if (!dependencies.openFileByPath) {
    throw createBridgeError('EXECUTION_FAILED', '当前环境不支持打开文件');
  }

  const file = await dependencies.openFileByPath(path);
  if (!file) {
    throw createBridgeError('EXECUTION_FAILED', `未找到文件：${path}`);
  }

  return { path, resourceType, opened: true, fileId: file.id };
}

/** Bridge request dispatcher. */
/**
 * 处理 BChat runtime bridge 请求。
 * @param event - runtime bridge 请求事件
 * @param dependencies - bridge 依赖
 * @returns bridge 响应数据
 */
export async function handleBChatRuntimeBridgeRequest(event: ChatRuntimeBridgeRequestEvent, dependencies: BChatRuntimeBridgeDependencies): Promise<unknown> {
  if (event.kind === 'file-content-snapshot') {
    return readFileContentSnapshot(event, dependencies);
  }

  if (event.kind === 'write-file-content') {
    if (dependencies.dispatchToolBridge) {
      const [dispatchError, result] = await asyncTo(dependencies.dispatchToolBridge(event));
      if (dispatchError) {
        const originalError = unwrapBridgeError(dispatchError);
        if (readBridgeErrorCode(originalError) !== 'EDITOR_UNAVAILABLE') throw originalError;
      } else if (result.handled) {
        return result.data;
      }
    }
    return writeFileContent(event, dependencies);
  }

  if (event.kind === 'settings-snapshot') {
    return readSettingsSnapshot(dependencies);
  }

  if (event.kind === 'apply-setting') {
    return applySetting(event, dependencies);
  }

  if (event.kind === 'open-draft') {
    return openDraft(event, dependencies);
  }

  if (event.kind === 'open-resource') {
    return openResource(event, dependencies);
  }

  return dispatchPageBridge(event, dependencies);
}
