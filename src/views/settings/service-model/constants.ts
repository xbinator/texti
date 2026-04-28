export interface VariableOption {
  value: string;
  label: string;
}

export interface ServiceConfigOption {
  type: 'variable';
  options: VariableOption[];
}

export const POLISH_SERVICE_CONFIG_OPTIONS: ServiceConfigOption[] = [
  {
    type: 'variable',
    options: [
      { value: 'SELECTED_TEXT', label: '选中文本' },
      { value: 'USER_INPUT', label: '用户指令' }
    ]
  }
];

export const POLISH_DEFAULT_PROMPT = `# Role
你是一个 Markdown 内容编辑助手。

# Task
根据用户的指令，对下方 Markdown 内容进行修改。

# Rules
1. 仅输出修改后的 Markdown 内容，不要包含任何分隔符或额外标记
2. 保持原有 Markdown 语法结构
3. 不要新增解释性文字

# Original Content
{{SELECTED_TEXT}}

# User Instruction
{{USER_INPUT}} `;

export const CHAT_SERVICE_CONFIG_OPTIONS: ServiceConfigOption[] = [];

/**
 * 自动命名服务的变量选项，用于提示首轮对话可引用的变量。
 */
export const AUTONAME_SERVICE_CONFIG_OPTIONS: ServiceConfigOption[] = [
  {
    type: 'variable',
    options: [
      { value: 'USER_MESSAGE', label: '用户首条消息' },
      { value: 'AI_RESPONSE', label: 'AI回复' }
    ]
  }
];

/**
 * 自动命名的默认 Prompt 模板。
 */
export const AUTONAME_DEFAULT_PROMPT = `# Role
你是一个会话标题生成器。

# Task
根据用户与 AI 的对话内容，生成一个简洁准确的会话标题。

# Rules
1. 标题长度不超过 20 个汉字
2. 标题应概括对话的核心主题，而非描述对话格式
3. 只输出标题文本，不要包含引号、标点或任何额外说明
4. 使用用户使用的语言（中文对话输出中文标题，英文对话输出英文标题）

# Conversation
用户: {{USER_MESSAGE}}

AI: {{AI_RESPONSE}}

# Title
`;
