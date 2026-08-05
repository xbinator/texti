/**
 * @file runtimeBridge.ts
 * @description BChat ChatRuntime renderer bridge 请求处理。
 */
import type { AIToolContext, AIToolExecutionError } from 'types/ai';
import type { ChatRuntimeBridgeRequestEvent, ChatRuntimeEventBase } from 'types/chat-runtime';
import type { WebviewOperateInput, WebviewPressKey, WebviewToolContext } from '@/ai/tools/context/webview';
import type { WidgetToolContext } from '@/ai/tools/context/widget';
import type { OpenDraftInput, OpenDraftResult } from '@/ai/tools/shared/types';
import { isDocumentRecord } from '@/shared/storage';
import type { StoredDocumentRecord } from '@/shared/storage/files/types';
import { isUnsavedPath, parseUnsavedPath } from '@/utils/file/unsaved';

/** Bridge handler 实际消费的事件字段。 */
type BChatRuntimeBridgeRequest = Pick<ChatRuntimeBridgeRequestEvent, 'requestId' | 'kind' | 'payload'> & Partial<ChatRuntimeEventBase>;

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
  /** 获取当前编辑器工具上下文。 */
  getEditorContext: () => AIToolContext | undefined;
  /** 通过最近文件 ID 获取文件记录。 */
  getRecentFileById?: (fileId: string) => StoredDocumentRecord | undefined | Promise<StoredDocumentRecord | undefined>;
  /** 更新最近文件记录。 */
  updateRecentFileById?: (fileId: string, updates: Partial<StoredDocumentRecord>) => Promise<StoredDocumentRecord>;
  /** 获取当前 WebView 工具上下文。 */
  getWebviewContext: () => WebviewToolContext | undefined;
  /** 获取当前 Widget 编辑器工具上下文。 */
  getWidgetContext?: () => WidgetToolContext | undefined;
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

/** Bridge response snapshot types. */
/** 编辑器文档快照。 */
export interface BChatRuntimeDocumentSnapshot {
  /** 文档 ID。 */
  id: string;
  /** 文档标题。 */
  title: string;
  /** 磁盘路径。 */
  path: string | null;
  /** 虚拟定位符。 */
  locator?: string;
  /** 文档内容。 */
  content: string;
  /** 当前选区。 */
  selection: ReturnType<AIToolContext['editor']['getSelection']>;
}

/** Widget 编辑页 bridge 快照。 */
export interface BChatRuntimeWidgetSnapshot {
  /** Widget 标签栏标题。 */
  title: string;
  /** Widget 文件路径，未保存时为空。 */
  path: string | null;
  /** 当前内存中的 WidgetData JSON。 */
  content: string;
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
 * 判断值是否为有限数字。
 * @param value - 待判断值
 * @returns 是否为有限数字
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 判断值是否为网页滚动方向。
 * @param value - 待判断值
 * @returns 是否为网页滚动方向
 */
function isWebviewScrollDirection(value: unknown): value is 'up' | 'down' | 'left' | 'right' {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

/**
 * 判断值是否为支持的网页按键。
 * @param value - 待判断值
 * @returns 是否为支持的网页按键
 */
function isWebviewPressKey(value: unknown): value is WebviewPressKey {
  return (
    value === 'Enter' ||
    value === 'Tab' ||
    value === 'Escape' ||
    value === 'ArrowUp' ||
    value === 'ArrowDown' ||
    value === 'ArrowLeft' ||
    value === 'ArrowRight'
  );
}

/**
 * 判断值是否为 WebView 操作动作。
 * @param value - 待判断值
 * @returns 是否为 WebView 操作动作
 */
function isWebviewOperateAction(value: unknown): value is WebviewOperateInput['action'] {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }

  if (value.type === 'click') {
    return isFiniteNumber(value.index);
  }

  if (value.type === 'input') {
    return isFiniteNumber(value.index) && typeof value.text === 'string' && (value.clear === undefined || typeof value.clear === 'boolean');
  }

  if (value.type === 'select') {
    return isFiniteNumber(value.index) && typeof value.optionText === 'string';
  }

  if (value.type === 'press') {
    return isFiniteNumber(value.index) && isWebviewPressKey(value.key);
  }

  if (value.type === 'scroll') {
    return (
      (value.index === undefined || isFiniteNumber(value.index)) &&
      isWebviewScrollDirection(value.direction) &&
      (value.pixels === undefined || isFiniteNumber(value.pixels))
    );
  }

  if (value.type === 'navigate') {
    return typeof value.url === 'string';
  }

  if (value.type === 'wait') {
    return value.seconds === undefined || isFiniteNumber(value.seconds);
  }

  return false;
}

/**
 * 判断 bridge payload 是否为 WebView 操作输入。
 * @param value - 待判断值
 * @returns 是否为 WebView 操作输入
 */
function isWebviewOperateInput(value: unknown): value is WebviewOperateInput {
  if (!isRecord(value) || !isWebviewOperateAction(value.action)) {
    return false;
  }

  if (value.action.type === 'navigate') {
    return value.snapshotId === undefined || typeof value.snapshotId === 'string';
  }

  return typeof value.snapshotId === 'string' && value.snapshotId.length > 0;
}

/** Editor document bridge handlers. */
/**
 * 读取当前编辑器文档快照。
 * @param dependencies - bridge 依赖
 * @returns 文档快照
 */
function readDocumentSnapshot(dependencies: BChatRuntimeBridgeDependencies): BChatRuntimeDocumentSnapshot {
  const context = dependencies.getEditorContext();
  if (!context) {
    throw createBridgeError('EDITOR_UNAVAILABLE', '当前没有可用的编辑器文档');
  }

  return {
    id: context.document.id,
    title: context.document.title,
    path: context.document.path,
    ...(context.document.locator ? { locator: context.document.locator } : {}),
    content: context.document.getContent(),
    selection: context.editor.getSelection()
  };
}

/** Widget editor bridge handlers. */
/**
 * 读取当前 Widget 编辑页快照。
 * @param dependencies - bridge 依赖
 * @returns Widget 编辑页快照
 */
function readWidgetSnapshot(dependencies: BChatRuntimeBridgeDependencies): BChatRuntimeWidgetSnapshot {
  const context = dependencies.getWidgetContext?.();
  if (!context) {
    throw createBridgeError('EDITOR_UNAVAILABLE', '当前没有可用的 Widget 编辑页');
  }

  return {
    title: context.widget.title,
    path: context.widget.path,
    content: context.widget.getContent()
  };
}

/** File content bridge handlers. */

/**
 * 读取文件内容快照。
 * @param event - bridge 请求事件
 * @param dependencies - bridge 依赖
 * @returns 文件内容快照
 */
async function readFileContentSnapshot(
  event: BChatRuntimeBridgeRequest,
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
async function writeFileContent(event: BChatRuntimeBridgeRequest, dependencies: BChatRuntimeBridgeDependencies): Promise<BChatRuntimeFileContentSnapshot> {
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

    const activeContext = dependencies.getEditorContext();
    if (activeContext?.document.locator === filePath || activeContext?.document.path === filePath || activeContext?.document.id === unsavedReference.fileId) {
      await activeContext.editor.replaceDocument(content);
      return { artifactId: activeContext.document.id, path: filePath, content };
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
function applySetting(event: BChatRuntimeBridgeRequest, dependencies: BChatRuntimeBridgeDependencies): BChatRuntimeApplySettingResult {
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
async function openDraft(event: BChatRuntimeBridgeRequest, dependencies: BChatRuntimeBridgeDependencies): Promise<OpenDraftResult> {
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
async function openResource(event: BChatRuntimeBridgeRequest, dependencies: BChatRuntimeBridgeDependencies): Promise<BChatRuntimeOpenResourceResult> {
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
export async function handleBChatRuntimeBridgeRequest(event: BChatRuntimeBridgeRequest, dependencies: BChatRuntimeBridgeDependencies): Promise<unknown> {
  if (event.kind === 'document-snapshot') {
    return readDocumentSnapshot(dependencies);
  }

  if (event.kind === 'webview-snapshot') {
    const context = dependencies.getWebviewContext();
    if (!context) {
      throw createBridgeError('EDITOR_UNAVAILABLE', '当前没有可用的网页');
    }
    return context.readPageSnapshot();
  }

  if (event.kind === 'widget-snapshot') {
    return readWidgetSnapshot(dependencies);
  }

  if (event.kind === 'webview-operate') {
    const context = dependencies.getWebviewContext();
    if (!context) {
      throw createBridgeError('EDITOR_UNAVAILABLE', '当前没有可操作的网页');
    }
    if (!isWebviewOperateInput(event.payload)) {
      throw createBridgeError('INVALID_INPUT', '网页操作参数无效');
    }

    return context.operatePage(event.payload);
  }

  if (event.kind === 'file-content-snapshot') {
    return readFileContentSnapshot(event, dependencies);
  }

  if (event.kind === 'write-file-content') {
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

  throw createBridgeError('INVALID_INPUT', `不支持的 bridge 请求类型：${event.kind}`);
}
