/**
 * @file types.ts
 * @description BPromptEditor shared type definitions.
 */
import type { ChipResolver } from './extensions/variableChip';

/**
 * Slash command option metadata.
 */
export interface SlashCommandOption {
  /** Stable command identifier. */
  id: string;
  /** Slash trigger text shown to the user. */
  trigger: string;
  /** Human-readable command title. */
  title: string;
  /** Command description shown in UI hints. */
  description: string;
  /** Command kind; action commands run immediately, prompt commands open prompt flows. */
  type: 'action' | 'prompt';
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
  /** Slash command metadata exposed to the editor. */
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
