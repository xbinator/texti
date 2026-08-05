/**
 * @file useWidgetToolContext.ts
 * @description 将 Widget 编辑页会话注册为 ChatRuntime 可读取的工具上下文。
 */
import type { ComputedRef, Ref } from 'vue';
import { onActivated, onBeforeUnmount, onDeactivated, watch } from 'vue';
import { widgetToolContextRegistry, type WidgetToolContext } from '@/ai/tools/context/widget';
import type { WidgetData } from '@/components/BWidget/types';
import type { FileState } from '@/shared/platform/native/types';

/**
 * Widget 工具上下文绑定选项。
 */
interface UseWidgetToolContextOptions {
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
 * 创建 Widget 编辑页工具上下文。
 * @param options - Widget 工具上下文绑定选项
 * @returns Widget 工具上下文
 */
function createContext(options: UseWidgetToolContextOptions): WidgetToolContext {
  return {
    widget: {
      get title(): string {
        return options.currentTitle.value;
      },
      get path(): string | null {
        return options.fileState.value.path;
      },
      getContent: (): string => serializeData(options.data)
    }
  };
}

/**
 * 绑定当前 Widget 编辑页工具上下文。
 * @param options - Widget 工具上下文绑定选项
 */
export function useWidgetToolContext(options: UseWidgetToolContextOptions): void {
  /** 当前已注册的 Widget 编辑页 ID。 */
  let registeredId: string | null = null;

  /**
   * 注销当前已注册的 Widget 编辑页上下文。
   */
  function unregisterContext(): void {
    if (!registeredId) return;
    widgetToolContextRegistry.unregister(registeredId);
    registeredId = null;
  }

  /**
   * 同步 Widget 编辑页上下文注册状态。
   */
  function syncContext(): void {
    const nextId = options.fileId.value;
    if (!nextId) {
      unregisterContext();
      return;
    }

    if (registeredId && registeredId !== nextId) {
      widgetToolContextRegistry.unregister(registeredId);
      registeredId = null;
    }

    widgetToolContextRegistry.register(nextId, createContext(options));
    registeredId = nextId;
    if (options.isActive.value) {
      widgetToolContextRegistry.setCurrent(nextId);
    }
  }

  /**
   * 清理当前激活标识，保留上下文供已启动 Runtime 继续按 ID 读取。
   */
  function clearCurrent(): void {
    if (registeredId) {
      widgetToolContextRegistry.clearCurrent(registeredId);
    }
  }

  watch(
    options.fileId,
    (): void => {
      syncContext();
    },
    { immediate: true }
  );

  watch(options.isActive, (active): void => {
    if (active) {
      syncContext();
      return;
    }

    clearCurrent();
  });

  onActivated((): void => {
    syncContext();
  });
  onDeactivated((): void => {
    clearCurrent();
  });
  onBeforeUnmount((): void => {
    unregisterContext();
  });
}
