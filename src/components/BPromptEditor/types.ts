/**
 * @file types.ts
 * @description BPromptEditor 共享类型定义
 */
import type { ChipResolver } from './extensions/variableChip';

/**
 * 斜杠命令选项元数据
 */
export type SlashCommandId = 'model' | 'usage' | 'new' | 'clear';

/**
 * 斜杠命令类型
 */
export type SlashCommandType = 'action' | 'prompt';

/**
 * 斜杠命令选项元数据，供提示词编辑器和聊天侧边栏使用
 */
export interface SlashCommandOption {
  /** 稳定的命令标识符 */
  id: SlashCommandId;
  /** 展示给用户的斜杠触发文本 */
  trigger: string;
  /** 人类可读的命令标题 */
  title: string;
  /** 在 UI 提示中显示的命令描述 */
  description: string;
  /** 命令类型；action 命令立即执行，prompt 命令打开提示词流程 */
  type: SlashCommandType;
}

/**
 * 变量定义
 */
export interface Variable {
  /** 变量显示名称 */
  label: string;
  /** 变量值（插入到 {{ }} 中间） */
  value: string;
  /** 变量描述（可选） */
  description?: string;
}

/**
 * 变量选项分组
 */
export interface VariableOptionGroup {
  /** 分组选项类型 */
  type: 'variable';
  /** 当前类型下的变量选项 */
  options: Variable[];
}

/**
 * BPromptEditor 组件属性
 */
export interface BPromptEditorProps {
  /** 占位符 */
  placeholder?: string;
  /** 变量选项 */
  options?: VariableOptionGroup[];
  /** 暴露给编辑器的斜杠命令元数据 */
  slashCommands?: SlashCommandOption[];
  /** 是否禁用 */
  disabled?: boolean;
  /** 最大高度 */
  maxHeight?: number | string;
  /** 是否在按下 Enter 时提交（Shift+Enter 换行） */
  submitOnEnter?: boolean;
  /** Chip 解析器，由消费者提供 */
  chipResolver?: ChipResolver;
  /** 文件粘贴回调（当前仅支持同步） */
  onPasteFiles?: (files: File[]) => Promise<string | null> | string | null;
}
