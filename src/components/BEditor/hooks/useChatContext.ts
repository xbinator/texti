/**
 * @file useChatContext.ts
 * @description 将 BEditor 文档能力注册为 ChatRuntime 页面上下文。
 */
import type { EditorController, EditorState } from '../types';
import type { AIToolContext, AIToolExecutionError, AIToolExecutionResult } from 'types/ai';
import type { ChatRuntimeBridgeRequestEvent } from 'types/chat-runtime';
import type { Ref } from 'vue';
import { computed } from 'vue';
import { createToolSuccessResult } from '@/ai/tools/results';
import { useChatContextProvider, type ChatBridgeDispatchResult, type ToolContextTool } from '@/hooks/useChat/useContextRegistry';
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

/** Editor 页面读取工具名称。 */
const READ_CURRENT_DOCUMENT_TOOL_NAME = 'read_current_document';

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
   * 直接读取当前文档工具结果。
   * @returns 当前编辑器文档与选区
   */
  function readDocument(): AIToolExecutionResult {
    const context = getContext();
    return createToolSuccessResult(READ_CURRENT_DOCUMENT_TOOL_NAME, {
      id: context.document.id,
      artifactId: context.document.id,
      title: context.document.title,
      path: context.document.path ?? context.document.locator ?? `unsaved://${context.document.id}/${context.document.title}`,
      content: context.document.getContent(),
      selected: { content: context.editor.getSelection()?.text ?? '' }
    });
  }

  /**
   * 创建 Editor 页面完整工具。
   * @returns 当前文档读取工具
   */
  function createDocumentTool(): ToolContextTool {
    return {
      definition: {
        name: READ_CURRENT_DOCUMENT_TOOL_NAME,
        description: '读取当前编辑器文档的标题、路径、Markdown 内容和用户选中的内容。',
        source: 'builtin',
        riskLevel: 'read',
        requiresActiveDocument: false,
        permissionCategory: 'document',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      },
      execute: (): AIToolExecutionResult => readDocument(),
      presentation: {
        label: '读取当前文档',
        summarize: (): string => '已读取当前文档'
      },
      history: { mode: 'keep' }
    };
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
    const matches = Boolean(reference && (context.document.locator === path || context.document.path === path || context.document.id === reference.fileId));
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
    getTools: () => [createDocumentTool()],
    hiddenToolNames: [],
    appBridgeHandlers: {
      'write-file-content': writeContent
    }
  });
}
