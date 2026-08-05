/**
 * @file useChatContext.ts
 * @description 将 Widget 编辑页会话注册为 ChatRuntime 可读取的页面上下文。
 */
import type { ComputedRef, Ref } from 'vue';
import { computed } from 'vue';
import { createReadCurrentWidgetTool } from '@/ai/tools/catalog/runtimeTools';
import type { WidgetData } from '@/components/BWidget/types';
import { useToolContext, type ChatBridgeDispatchResult } from '@/hooks/useChat/useToolContext';
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
  /** 当前 WidgetData。 */
  data: Ref<WidgetData>;
}

/**
 * 将 WidgetData 序列化为模型可读 JSON。
 * @param data - 当前 WidgetData ref
 * @returns 格式化 WidgetData JSON
 */
function serializeData(data: Ref<WidgetData>): string {
  return JSON.stringify(data.value ?? {}, null, 2);
}

/**
 * 绑定当前 Widget 编辑页工具上下文。
 * @param options - Widget 工具上下文绑定选项
 */
export function useChatContext(options: UseChatContextOptions): void {
  const available = computed<boolean>((): boolean => Boolean(options.fileId.value));

  /** 读取 Widget 快照。 */
  function readSnapshot(): ChatBridgeDispatchResult {
    return {
      handled: true,
      data: {
        title: options.currentTitle.value,
        path: options.fileState.value.path,
        content: serializeData(options.data)
      }
    };
  }

  useToolContext({
    providerId: 'widget',
    resourceId: options.fileId,
    available,
    active: options.isActive,
    getTools: () => [createReadCurrentWidgetTool()],
    hiddenToolNames: [],
    bridgeHandlers: {
      'widget-snapshot': (): ChatBridgeDispatchResult => readSnapshot()
    }
  });
}
