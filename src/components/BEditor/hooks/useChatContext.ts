/**
 * @file useChatContext.ts
 * @description 将 BEditor 文档能力注册为 ChatRuntime 页面上下文。
 */
import type { EditorController, EditorState } from '../types';
import type { AIToolContext, AIToolExecutionError } from 'types/ai';
import type { ChatRuntimeBridgeRequestEvent, ChatRuntimePageEnvironmentContext } from 'types/chat-runtime';
import type { Ref } from 'vue';
import { computed } from 'vue';
import { createEnvironmentLine, createEnvironmentSection } from '@/hooks/useChat/tool/environment';
import { useChatContextProvider, type ChatBridgeDispatchResult } from '@/hooks/useChat/useContextRegistry';
import { asyncTo } from '@/utils/asyncTo';
import { parseUnsavedPath } from '@/utils/file/unsaved';
import { createEditorToolContext } from './useEditorToolContext';

/** Editor Chat Context 选项。 */
interface UseChatContextOptions {
  /** 编辑器状态。 */
  readonly editorState: Ref<EditorState>;
  /** 当前编辑器是否激活。 */
  readonly active: Readonly<Ref<boolean>>;
  /** 获取当前编辑器控制器。 */
  readonly getController: () => EditorController | null;
}

/** 当前文件选中行。 */
interface EditorSelectedLine {
  /** 1-based 行号。 */
  readonly lineNumber: number;
  /** 当前行内容。 */
  readonly content: string;
}

/** 自动注入上下文中最多携带的选中行数。 */
const MAX_CONTEXT_SELECTED_LINES = 20;

/** 自动注入上下文中单行内容最大长度。 */
const MAX_CONTEXT_LINE_LENGTH = 500;

/**
 * 创建稳定工具错误。
 * @param code - 工具错误码
 * @param message - 错误消息
 * @returns 带稳定错误码的错误
 */
function createToolError(code: AIToolExecutionError['code'], message: string): Error & { code: AIToolExecutionError['code'] } {
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
 * 按编辑器文本切分物理行。
 * @param content - 当前文件内容
 * @returns 文本行数组
 */
function splitContentLines(content: string): string[] {
  return content.split(/\r\n|\r|\n/u);
}

/**
 * 截断单行内容，避免轻量环境上下文膨胀。
 * @param content - 原始行内容
 * @returns 限长后的行内容
 */
function truncateLine(content: string): string {
  return content.length > MAX_CONTEXT_LINE_LENGTH ? `${content.slice(0, MAX_CONTEXT_LINE_LENGTH)}...` : content;
}

/**
 * 根据绝对文本 offset 解析 1-based 行号。
 * @param content - 当前文件内容
 * @param offset - 绝对 offset
 * @returns 1-based 行号
 */
function resolveLineNumber(content: string, offset: number): number {
  const safeOffset = Math.min(Math.max(0, offset), content.length);
  return content.slice(0, safeOffset).split(/\r\n|\r|\n/u).length;
}

/**
 * 读取当前选区覆盖的文件行。
 * @param state - 当前编辑器文件状态
 * @param controller - 当前编辑器控制器
 * @returns 当前选区行信息
 */
function readSelectedLines(state: EditorState, controller: EditorController | null): EditorSelectedLine[] | undefined {
  const selection = controller?.getSelection();
  if (!selection) return undefined;
  const startLine = resolveLineNumber(state.content, selection.from);
  const endLine = resolveLineNumber(state.content, Math.max(selection.from, selection.to - 1));
  const lines = splitContentLines(state.content);
  return lines
    .slice(startLine - 1, Math.min(endLine, lines.length))
    .slice(0, MAX_CONTEXT_SELECTED_LINES)
    .map(
      (content: string, index: number): EditorSelectedLine => ({
        lineNumber: startLine + index,
        content: truncateLine(content)
      })
    );
}

/**
 * 注册 Editor Chat 工具上下文。
 * @param options - Editor 工具注册选项
 */
export function useChatContext(options: UseChatContextOptions): void {
  const resourceId = computed<string>((): string => options.editorState.value.id);
  const available = computed<boolean>((): boolean => Boolean(resourceId.value && options.getController()));

  /** 获取当前强类型 Editor Context。 */
  function getContext(): AIToolContext {
    if (!options.getController()) throw createToolError('EDITOR_UNAVAILABLE', 'Runtime 绑定的编辑器已不可用');
    return createEditorToolContext({
      getFileState: (): EditorState => options.editorState.value,
      getEditorInstance: options.getController
    });
  }

  /**
   * 读取当前编辑器工具上下文。
   * @returns 当前编辑器上下文
   */
  function getAvailableContext(): AIToolContext {
    const context = getContext();
    return context;
  }

  /**
   * 创建当前文件轻量环境上下文。
   * @returns 当前文件定位上下文
   */
  function getEnvironmentContext(): ChatRuntimePageEnvironmentContext {
    const context = getAvailableContext();
    const selectedLines = readSelectedLines(options.editorState.value, options.getController());
    const selectedLineEntries = selectedLines?.map((line: EditorSelectedLine): string => `${String(line.lineNumber)}: ${line.content}`);
    const section = createEnvironmentSection('current_file', [
      createEnvironmentLine('Path', context.document.path ?? context.document.locator),
      ...(selectedLineEntries?.length ? ['Selected lines:', ...selectedLineEntries] : [])
    ]);
    return section ? { sections: [section] } : {};
  }

  /**
   * 写入匹配的未保存文档。
   * @param event - Runtime Bridge 请求
   * @returns 页面是否处理写入
   */
  async function writeContent(event: ChatRuntimeBridgeRequestEvent): Promise<ChatBridgeDispatchResult> {
    const payload = isRecord(event.payload) ? event.payload : {};
    const path = typeof payload.path === 'string' ? payload.path.trim() : '';
    const content = typeof payload.content === 'string' ? payload.content : '';
    const reference = parseUnsavedPath(path);
    const context = getContext();
    const matches = context.document.locator === path || context.document.path === path || Boolean(reference && context.document.id === reference.fileId);
    if (!matches) return { handled: false };
    const [error] = await asyncTo(context.editor.replaceDocument(content));
    if (error) throw error.cause ?? error;
    return { handled: true, data: { artifactId: context.document.id, path, content } };
  }

  useChatContextProvider({
    providerId: 'editor',
    resourceId,
    available,
    active: options.active,
    getTools: () => [],
    getEnvironmentContext,
    hiddenToolNames: [],
    appBridgeHandlers: {
      'write-file-content': writeContent
    }
  });
}
