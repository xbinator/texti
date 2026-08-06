/**
 * @file types.ts
 * @description 记忆系统类型定义
 */

/** 记忆分区名称 */
export type MemoryCategory = 'Instructions' | 'Preferences' | 'Habits' | 'Facts' | 'Projects' | 'Current Context';

/** 所有分区名称的有序列表，用于序列化时保持顺序 */
export const MEMORY_CATEGORIES: MemoryCategory[] = ['Instructions', 'Preferences', 'Habits', 'Facts', 'Projects', 'Current Context'];

/** 单条记忆 */
export interface MemoryItem {
  content: string;
}

/** 记忆分区 */
export interface MemorySection {
  category: MemoryCategory;
  items: MemoryItem[];
}

/** 完整记忆文档 */
export interface MemoryDoc {
  sections: MemorySection[];
}

/** 记忆文件路径常量 */
export const MEMORY_FILE_NAME = 'MEMORY.md';

/** 记忆注入模式 */
export type MemoryInjectionMode = 'relevant' | 'full';

/** 当前请求用于记忆相关性筛选的上下文 */
export interface MemorySelectionContext {
  /** 当前用户消息文本 */
  userMessage: string;
  /** 当前消息引用的文件路径或资源路径 */
  references: string[];
  /** 当前工作区根目录，仅用于提取项目名等关键词 */
  workspaceRoot?: string;
  /** 记忆注入模式，未传时按 relevant 处理 */
  mode?: MemoryInjectionMode;
}

/** 记忆选择调试条目 */
export interface MemorySelectionDebugItem {
  /** 分区名称 */
  category: MemoryCategory;
  /** 条目预览，避免日志持久化完整记忆内容 */
  preview: string;
  /** 相关性分数 */
  score: number;
}

/** 记忆选择调试信息 */
export interface MemorySelectionDebugInfo {
  /** 实际注入模式 */
  mode: MemoryInjectionMode;
  /** 最大注入字符数 */
  maxChars: number;
  /** 最终注入字符数 */
  finalChars: number;
  /** 当前请求提取出的召回关键词 */
  keywords: string[];
  /** 最终注入的记忆条目 */
  selectedItems: MemorySelectionDebugItem[];
  /** 未进入最终注入文本的记忆条目 */
  droppedItems: MemorySelectionDebugItem[];
}

/** 构建 runtime context 记忆上下文的选项 */
export interface BuildMemoryContextOptions {
  /** 最大注入字符数 */
  maxChars?: number;
  /** 当前请求的记忆选择上下文 */
  selection?: MemorySelectionContext;
  /** 记忆选择调试回调 */
  onSelectionDebug?: (debugInfo: MemorySelectionDebugInfo) => void;
}
