/**
 * @file useChatContext.ts
 * @description 将 BEditor 文档能力注册为 ChatRuntime 页面上下文。
 */
import type { EditorController, EditorState } from '../types';
import type { AIToolContext, AIToolExecutionError } from 'types/ai';
import type { ChatRuntimeBridgeRequestEvent } from 'types/chat-runtime';
import type { Ref } from 'vue';
import { computed } from 'vue';
import { createReadCurrentDocumentTool } from '@/ai/tools/catalog/runtimeTools';
import { useToolContext, type ChatBridgeDispatchResult } from '@/hooks/useChat/useToolContext';
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

  /** 读取文档快照。 */
  function readSnapshot(): ChatBridgeDispatchResult {
    const context = getContext();
    return {
      handled: true,
      data: {
        id: context.document.id,
        title: context.document.title,
        path: context.document.path,
        ...(context.document.locator ? { locator: context.document.locator } : {}),
        content: context.document.getContent(),
        selection: context.editor.getSelection()
      }
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

  useToolContext({
    providerId: 'editor',
    resourceId,
    available,
    active: options.active,
    getTools: () => [createReadCurrentDocumentTool()],
    hiddenToolNames: [],
    bridgeHandlers: {
      'document-snapshot': (): ChatBridgeDispatchResult => readSnapshot(),
      'write-file-content': writeContent
    }
  });
}
