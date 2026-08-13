/**
 * @file types.ts
 * @description BSmartEditor 共享类型定义
 */
import type { ChipResolver } from './extensions/variableChip';

/**
 * 图片粘贴/拖拽接管上下文。
 */
export interface PasteImageContext {
  /** 纯文本内容 */
  text?: string;
  /** HTML 内容 */
  html?: string;
  /** 图片文件列表 */
  imageFiles: File[];
  /** 其他文件列表 */
  otherFiles: File[];
}

/** 斜杠命令选中后的通用行为。 */
export type SlashCommandSelectAction = { type: 'emit' } | { type: 'insert'; text: string };

/** 供提示词编辑器和上层业务使用的通用斜杠选项。 */
export interface SlashCommandOption {
  /** 稳定选项标识。 */
  id: string;
  /** 展示给用户的斜杠触发文本。 */
  trigger: string;
  /** 人类可读标题。 */
  title: string;
  /** UI 提示描述。 */
  description: string;
  /** 上层业务定义的分组标识。 */
  group?: string;
  /** 分组首项上方的展示标题。 */
  groupTitle?: string;
  /** 选中条目后由编辑器执行的行为。 */
  selectAction: SlashCommandSelectAction;
}

/**
 * 变量定义
 */
export interface Variable {
  /** 变量说明标签，无说明时为空字符串 */
  label: string;
  /** 变量值（插入到 {{ }} 中间） */
  value: string;
  /** 变量描述（可选） */
  description?: string;
  /** 子级变量选项，用于表达对象变量的层级结构 */
  children?: Variable[];
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
 * 静态 Smart 值。
 */
export interface BSmartLiteralValue<T> {
  /** 值来源类型 */
  type: 'literal';
  /** 实际静态值 */
  value: T;
}

/**
 * Smart 变量引用。
 */
export interface BSmartVariableValue {
  /** 值来源类型 */
  type: 'variable';
  /** 不带双花括号的变量路径 */
  value: string;
}

/**
 * 静态值或变量引用。
 */
export type BSmartValue<T> = BSmartLiteralValue<T> | BSmartVariableValue;

/**
 * 单行 Smart 输入值。
 */
export type BSmartInputValue = BSmartValue<string>;

/**
 * BSmartSelect 支持的静态选项值。
 */
export type BSmartSelectStaticValue = string | number | boolean | null;

/**
 * BSmartSelect 模型值。
 */
export type BSmartSelectValue<T extends BSmartSelectStaticValue = BSmartSelectStaticValue> = BSmartValue<T> | undefined;

/**
 * BSmartSelect 静态选项。
 */
export interface BSmartSelectOption<T extends BSmartSelectStaticValue = BSmartSelectStaticValue> {
  /** 展示文本 */
  label: string;
  /** 实际写入值 */
  value: T;
  /** 选项说明 */
  description?: string;
}

/**
 * Smart 方法动作配置。
 */
export interface BSmartMethodAction {
  /** 需要调用的方法名 */
  method: string;
  /** 方法参数，可分别保存静态值或变量路径 */
  args: BSmartValue<string>[];
}

/**
 * 可选方法。
 */
export interface BSmartMethodOption {
  /** 展示文本 */
  label: string;
  /** 实际方法名 */
  value: string;
  /** 方法参数名 */
  parameters?: string[];
  /** 方法说明 */
  description?: string;
}

/**
 * 文件提及选项，用于 @ 文件查找功能
 */
export interface FileMentionOption {
  /** 文件唯一标识 */
  id: string;
  /** 展示文件名；可能不含扩展名，图标解析需结合 ext。 */
  name: string;
  /** 文件路径，未保存文件为 null */
  path: string | null;
  /** 文件扩展名 */
  ext: string;
}

/**
 * BSmartEditor 组件属性
 */
export interface BSmartEditorProps {
  /** 占位符 */
  placeholder?: string;
  /** 变量选项 */
  options?: VariableOptionGroup[];
  /** 暴露给编辑器的斜杠命令元数据 */
  slashCommands?: SlashCommandOption[];
  /** 文件提及选项列表，用于 @ 文件查找 */
  fileMentions?: FileMentionOption[];
  /** 是否禁用 */
  disabled?: boolean;
  /** 最大高度 */
  maxHeight?: number | string;
  /** 是否在按下 Enter 时提交（Shift+Enter 换行） */
  submitOnEnter?: boolean;
  /** Chip 解析器，由消费者提供 */
  chipResolver?: ChipResolver;
  /** 文件粘贴回调 */
  onPasteFiles?: (files: File[]) => Promise<string | null> | string | null;
  /** 图片粘贴/拖拽接管回调 */
  onPasteImages?: (context: PasteImageContext) => Promise<void> | void;
  /** 当前是否允许接收图片 */
  canAcceptImages?: () => boolean;
  /** ESC 键取消回调，用于中止流式输出等场景 */
  onCancel?: () => void;
}

/**
 * BSmartEditor 对外暴露的方法。
 */
export interface BSmartEditorExpose {
  /** 聚焦编辑器，可选移动到末尾 */
  focus: (options?: { moveToEnd?: boolean }) => void;
  /** 读取当前光标位置 */
  getCursorPosition: () => number;
  /** 保存当前光标位置 */
  saveCursorPosition: () => void;
  /** 在当前光标位置插入文本 */
  insertTextAtCursor: (text: string) => void;
  /** 替换指定文本范围 */
  replaceTextRange: (from: number, to: number, text: string) => void;
  /** 读取编辑器文本 */
  getText: () => string;
}
