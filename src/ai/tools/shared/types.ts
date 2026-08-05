/**
 * @file types.ts
 * @description AI 工具共享类型定义
 */
import type { AIToolConfirmationAdapter } from '../confirmation';
import type { AIToolContext } from 'types/ai';
import type { StoredFile } from '@/shared/storage/files/types';

/**
 * 草稿打开的输入参数。
 */
export interface OpenDraftInput {
  /** 模型传入的原始相对路径。 */
  originalPath: string;
  /** 草稿内容。 */
  content: string;
}

/**
 * 草稿打开的返回结果。
 */
export interface OpenDraftResult {
  /** 创建的文件记录。 */
  file: StoredFile;
  /** 未保存文档虚拟路径。 */
  unsavedPath: string;
}

/**
 * 工具基础选项 - 工作区相关能力
 */
export interface ToolWorkspaceOptions {
  /** 获取工作区根目录，无工作区时返回 null */
  getWorkspaceRoot?: () => string | null;
  /** 判断文件路径是否在最近文件列表中，命中时跳过绝对路径确认 */
  isFileInRecent?: (filePath: string) => boolean;
}

/**
 * 工具基础选项 - 文件查找能力
 */
export interface ToolFileLookupOptions {
  /**
   * 通过文件路径查询文件记录，用于获取文件 ID。
   * @param filePath - 文件绝对路径
   * @returns 文件记录（含 id），未找到时返回 null
   */
  findFileByPath?: (filePath: string) => Promise<{ id: string } | null>;
  /**
   * 通过文件 ID 获取编辑器上下文，用于读取内存中的最新内容。
   * @param documentId - 文件 ID
   * @returns 编辑器上下文，文件未打开时返回 undefined
   */
  getEditorContext?: (documentId: string) => AIToolContext | undefined;
}

/**
 * 工具基础选项 - 页面上下文读取能力
 */
export interface ToolPageContextOptions {
  /** 获取当前 WebView 上下文。 */
  getWebviewContext?: () => unknown;
  /** 获取当前 Widget 编辑器上下文。 */
  getWidgetContext?: () => unknown;
}

/**
 * 工具基础选项 - 确认能力（可选）
 */
export interface ToolConfirmationOptions {
  /** 用户确认适配器 */
  confirm?: AIToolConfirmationAdapter;
}

/**
 * 工具基础选项 - 确认能力（必需）
 * 用于写工具，必须提供确认适配器
 */
export interface ToolRequiredConfirmationOptions {
  /** 用户确认适配器 */
  confirm: AIToolConfirmationAdapter;
}

/**
 * 工具基础选项 - 草稿能力
 */
export interface ToolDraftOptions {
  /** 打开草稿，无工作区 + 相对路径时降级调用。 */
  openDraft?: (input: OpenDraftInput) => Promise<OpenDraftResult>;
}

/**
 * 内置工具共享基础选项
 */
export interface BuiltinToolBaseOptions
  extends ToolConfirmationOptions,
    ToolWorkspaceOptions,
    ToolFileLookupOptions,
    ToolPageContextOptions,
    ToolDraftOptions {}
