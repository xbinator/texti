/**
 * @file useChatContext.ts
 * @description 将 Widget 编辑页会话注册为 ChatRuntime 可读取的页面上下文。
 */
import type { AIToolExecutionResult } from 'types/ai';
import type { ComputedRef, Ref } from 'vue';
import { computed } from 'vue';
import { createToolSuccessResult } from '@/ai/tools/results';
import type { WidgetData } from '@/components/BWidget/types';
import { useChatContextProvider, type ToolContextTool } from '@/hooks/useChat/useChatContextRegistry';
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

/** Widget 页面读取工具名称。 */
const READ_CURRENT_WIDGET_TOOL_NAME = 'read_current_widget';

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

  /**
   * 直接读取当前 Widget 编辑页工具结果。
   * @returns 当前 Widget 内存快照
   */
  function readWidget(): AIToolExecutionResult {
    return createToolSuccessResult(READ_CURRENT_WIDGET_TOOL_NAME, {
      title: options.currentTitle.value,
      path: options.fileState.value.path,
      content: serializeData(options.data)
    });
  }

  /**
   * 创建 Widget 页面完整工具。
   * @returns 当前 Widget 读取工具
   */
  function createWidgetTool(): ToolContextTool {
    return {
      definition: {
        name: READ_CURRENT_WIDGET_TOOL_NAME,
        description: '读取当前打开的 Widget 编辑页快照，返回文件路径、标题和编辑器内存中的 WidgetData JSON。',
        source: 'builtin',
        riskLevel: 'read',
        requiresActiveDocument: false,
        permissionCategory: 'system',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      },
      execute: (): AIToolExecutionResult => readWidget(),
      presentation: {
        label: '读取当前 Widget',
        summarize: (): string => '已读取当前 Widget'
      },
      history: { mode: 'keep' }
    };
  }

  useChatContextProvider({
    providerId: 'widget',
    resourceId: options.fileId,
    available,
    active: options.isActive,
    getTools: () => [createWidgetTool()],
    hiddenToolNames: [],
    appBridgeHandlers: {}
  });
}
