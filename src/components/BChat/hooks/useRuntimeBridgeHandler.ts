/**
 * @file useRuntimeBridgeHandler.ts
 * @description 组装 BChat Runtime Bridge 的应用能力与上下文查询。
 */
import type { RuntimeToolBinding } from './useRuntimeTools';
import type { ChatRuntimeBridgeRequestEvent } from 'types/chat-runtime';
import { editorToolContextRegistry } from '@/ai/tools/context/editor';
import { webviewToolContextRegistry } from '@/ai/tools/context/webview';
import type { useNavigate } from '@/hooks/useNavigate';
import { native } from '@/shared/platform';
import type { StoredDocumentRecord } from '@/shared/storage/files/types';
import { useRecentStore } from '@/stores/workspace/recent';
import { handleBChatRuntimeBridgeRequest } from '../utils/runtimeBridge';
import { useRuntimeSettings } from './useRuntimeSettings';

/**
 * Runtime Bridge hook 选项。
 */
interface UseRuntimeBridgeHandlerOptions {
  /** 打开未保存草稿 */
  openDraft: ReturnType<typeof useNavigate>['openDraft'];
  /** 按路径打开文件 */
  openFileByPath: ReturnType<typeof useNavigate>['openFileByPath'];
  /** 在应用 Webview 中打开 URL */
  openWebview: (url: URL) => void;
}

/** Runtime Bridge 请求处理函数。 */
type RuntimeBridgeHandler = (event: ChatRuntimeBridgeRequestEvent) => Promise<unknown>;

/**
 * 创建 Runtime Bridge 请求处理器。
 * @param options - 文件和导航能力
 * @returns 按 Runtime 身份创建的 Bridge 请求处理器
 */
export function useRuntimeBridgeHandler(options: UseRuntimeBridgeHandlerOptions): (binding?: RuntimeToolBinding) => RuntimeBridgeHandler {
  const recentStore = useRecentStore();
  const { getSettingsSnapshot, applyRuntimeSetting } = useRuntimeSettings();

  /**
   * 创建只访问 Runtime 启动时资源身份的 Bridge 处理器。
   * @param binding - 不可变 Runtime 身份；缺省时保留兼容的当前资源读取
   * @returns Runtime Bridge 处理器
   */
  function createBridgeHandler(binding?: RuntimeToolBinding): RuntimeBridgeHandler {
    const documentId = binding?.documentId;
    const webviewId = binding?.webviewId;

    /** 执行当前 Runtime 的资源绑定 Bridge 请求。 */
    async function handleRuntimeBridgeRequest(event: ChatRuntimeBridgeRequestEvent): Promise<unknown> {
      return handleBChatRuntimeBridgeRequest(event, {
        getEditorContext: binding
          ? () => (documentId ? editorToolContextRegistry.getContext(documentId) : undefined)
          : editorToolContextRegistry.getCurrentContext,
        getRecentFileById: (fileId: string) => recentStore.getFileById(fileId),
        updateRecentFileById: (fileId: string, updates: Partial<StoredDocumentRecord>) => recentStore.updateFile(fileId, updates),
        getWebviewContext: binding
          ? () => (webviewId ? webviewToolContextRegistry.getContext(webviewId) : undefined)
          : webviewToolContextRegistry.getCurrentContext,
        getSettingsSnapshot,
        applySetting: applyRuntimeSetting,
        openDraft: options.openDraft,
        openFileByPath: options.openFileByPath,
        openInWebview: (url: string): void => options.openWebview(new URL(url)),
        openExternal: (url: string): Promise<void> => native.openExternal(url)
      });
    }

    return handleRuntimeBridgeRequest;
  }

  return createBridgeHandler;
}
