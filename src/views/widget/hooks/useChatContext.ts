/**
 * @file useChatContext.ts
 * @description 将 Widget 编辑页会话注册为 ChatRuntime 轻量页面上下文。
 */
import type { ChatRuntimePageEnvironmentContext } from 'types/chat-runtime';
import type { ComputedRef, Ref } from 'vue';
import { computed } from 'vue';
import { createEnvironmentLine, createEnvironmentSection } from '@/hooks/useChat/context/environment';
import { useChatContextProvider } from '@/hooks/useChat/useContextRegistry';
import type { FileState } from '@/shared/platform/native/types';

/**
 * Widget 工具上下文绑定选项。
 */
interface UseChatContextOptions {
  /** 当前 Widget 文件会话 ID。 */
  fileId: Ref<string>;
  /** 当前 KeepAlive 页面是否活跃。 */
  isActive: Ref<boolean>;
  /** 当前 Widget 标签栏标题。 */
  currentTitle: ComputedRef<string>;
  /** 当前 Widget 文件状态。 */
  fileState: Ref<FileState>;
}

/**
 * 绑定当前 Widget 编辑页上下文。
 * @param options - Widget 上下文绑定选项
 */
export function useChatContext(options: UseChatContextOptions): void {
  const available = computed<boolean>((): boolean => Boolean(options.fileId.value));

  /**
   * 创建当前 Widget 文件轻量环境上下文。
   * @returns 当前文件定位上下文
   */
  function getEnvironmentContext(): ChatRuntimePageEnvironmentContext {
    const section = createEnvironmentSection('current_file', [createEnvironmentLine('Path', options.fileState.value.path)]);
    return section ? { sections: [section] } : {};
  }

  useChatContextProvider({
    providerId: 'widget',
    resourceId: options.fileId,
    available,
    active: options.isActive,
    getTools: () => [],
    getEnvironmentContext,
    hiddenToolNames: [],
    appBridgeHandlers: {}
  });
}
