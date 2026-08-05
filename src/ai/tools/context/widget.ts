/**
 * @file widget.ts
 * @description Widget 编辑页工具上下文注册表，管理当前激活 Widget 的读取能力。
 */

/**
 * Widget 编辑页工具上下文。
 */
export interface WidgetToolContext {
  /** Widget 快照读取能力。 */
  widget: {
    /** Widget 标签栏标题。 */
    title: string;
    /** Widget 文件路径，未保存时为空。 */
    path: string | null;
    /**
     * 读取当前内存中的 WidgetData JSON。
     * @returns 格式化后的 WidgetData JSON 字符串
     */
    getContent: () => string;
  };
}

/**
 * Widget 编辑页工具上下文注册表。
 */
export interface WidgetToolContextRegistry {
  /**
   * 注册 Widget 编辑页上下文。
   * @param id - Widget 编辑页稳定标识
   * @param context - Widget 工具上下文
   */
  register(id: string, context: WidgetToolContext): void;
  /**
   * 注销 Widget 编辑页上下文。
   * @param id - Widget 编辑页稳定标识
   */
  unregister(id: string): void;
  /**
   * 标记当前激活 Widget 编辑页。
   * @param id - Widget 编辑页稳定标识
   */
  setCurrent(id: string): void;
  /**
   * 清理当前激活 Widget 编辑页。
   * @param id - Widget 编辑页稳定标识
   */
  clearCurrent(id: string): void;
  /**
   * 获取当前激活 Widget 编辑页稳定标识。
   * @returns 当前 Widget 编辑页标识或 null
   */
  getCurrentId(): string | null;
  /**
   * 按稳定标识获取 Widget 编辑页上下文。
   * @param id - Widget 编辑页稳定标识
   * @returns 对应上下文或 undefined
   */
  getContext(id: string): WidgetToolContext | undefined;
  /**
   * 获取当前激活 Widget 编辑页上下文。
   * @returns 当前上下文或 undefined
   */
  getCurrentContext(): WidgetToolContext | undefined;
}

/**
 * 创建 Widget 编辑页工具上下文注册表。
 * @returns Widget 编辑页工具上下文注册表
 */
export function createWidgetToolContextRegistry(): WidgetToolContextRegistry {
  /** Widget 编辑页 ID 到上下文的映射。 */
  const contexts = new Map<string, WidgetToolContext>();
  /** 当前激活 Widget 编辑页 ID。 */
  let currentId: string | null = null;

  return {
    register(id: string, context: WidgetToolContext): void {
      contexts.set(id, context);
    },
    unregister(id: string): void {
      contexts.delete(id);
      if (currentId === id) {
        currentId = null;
      }
    },
    setCurrent(id: string): void {
      if (contexts.has(id)) {
        currentId = id;
      }
    },
    clearCurrent(id: string): void {
      if (currentId === id) {
        currentId = null;
      }
    },
    getCurrentId(): string | null {
      return currentId;
    },
    getContext(id: string): WidgetToolContext | undefined {
      return contexts.get(id);
    },
    getCurrentContext(): WidgetToolContext | undefined {
      return currentId ? contexts.get(currentId) : undefined;
    }
  };
}

/** 全局 Widget 编辑页工具上下文注册表单例。 */
export const widgetToolContextRegistry = createWidgetToolContextRegistry();
