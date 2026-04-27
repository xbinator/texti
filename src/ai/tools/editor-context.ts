/**
 * @file editor-context.ts
 * @description 编辑器工具上下文注册表，管理活动编辑器的上下文
 */
import type { AIToolContext } from 'types/ai';

/**
 * 编辑器工具上下文注册表接口
 * @description 定义上下文注册、注销和获取的方法
 */
export interface EditorToolContextRegistry {
  /**
   * 注册编辑器上下文
   * @param editorId - 编辑器 ID
   * @param context - 工具上下文
   */
  register: (editorId: string, context: AIToolContext) => void;
  /**
   * 注销编辑器上下文
   * @param editorId - 编辑器 ID
   */
  unregister: (editorId: string) => void;
  /**
   * 获取当前活动编辑器的上下文
   * @returns 工具上下文或 undefined
   */
  getCurrentContext: () => AIToolContext | undefined;
  /**
   * 按文档 ID 查找编辑器上下文
   * @param documentId - 文档 ID（注册时用作 Map key）
   * @returns 工具上下文或 undefined
   */
  getContext: (documentId: string) => AIToolContext | undefined;
}

/**
 * 创建编辑器工具上下文注册表
 * @returns 注册表实例
 */
export function createEditorToolContextRegistry(): EditorToolContextRegistry {
  /** 编辑器 ID 到上下文的映射 */
  const contexts = new Map<string, AIToolContext>();
  /** 当前活动编辑器 ID */
  let activeEditorId: string | null = null;

  return {
    register(editorId: string, context: AIToolContext): void {
      contexts.set(editorId, context);
      activeEditorId = editorId;
    },
    unregister(editorId: string): void {
      contexts.delete(editorId);

      // 如果注销的是当前活动编辑器，切换到最后一个注册的编辑器
      if (activeEditorId === editorId) {
        activeEditorId = Array.from(contexts.keys()).at(-1) ?? null;
      }
    },
    getCurrentContext(): AIToolContext | undefined {
      return activeEditorId ? contexts.get(activeEditorId) : undefined;
    },
    getContext(documentId: string): AIToolContext | undefined {
      return contexts.get(documentId);
    }
  };
}

/** 全局编辑器工具上下文注册表单例 */
export const editorToolContextRegistry = createEditorToolContextRegistry();
