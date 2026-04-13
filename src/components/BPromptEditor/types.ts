export interface Variable {
  // 变量显示名称
  label: string;
  // 变量值（插入到 {{ }} 中间）
  value: string;
  // 变量描述（可选）
  description?: string;
}

export interface VariableOptionGroup {
  // 分组选项类型
  type: 'variable';
  // 当前类型下的变量选项
  options: Variable[];
}

export interface BPromptEditorProps {
  // 占位符
  placeholder?: string;
  // 变量选项
  options?: VariableOptionGroup[];
  // 是否禁用
  disabled?: boolean;
  // 最大高度
  maxHeight?: number | string;
  // 形态变体
  variant?: 'outlined' | 'borderless' | 'filled' | 'underlined';
}
