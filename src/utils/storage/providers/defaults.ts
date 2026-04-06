import type { Provider } from './types';

export const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: '提供 GPT 系列模型，适用于通用对话、内容生成、代码辅助与多模态能力。',
    isEnabled: true,
    type: 'openai',
    readonly: true,
    models: []
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: '提供 Claude 系列模型，擅长长文本理解、分析推理和高质量写作。',
    isEnabled: false,
    type: 'anthropic',
    readonly: true,
    models: []
  },
  {
    id: 'google',
    name: 'Google AI',
    description: '提供 Gemini 系列模型，支持多模态处理、搜索增强与高效推理能力。',
    type: 'google',
    isEnabled: true,
    readonly: true,
    models: []
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: '提供高性能推理与代码生成模型，适用于编程辅助和复杂逻辑任务。',
    type: 'openai',
    isEnabled: false,
    readonly: true,
    models: []
  },
  {
    id: 'moonshot',
    name: 'Moonshot',
    description: '提供 Kimi 系列大模型，擅长长上下文处理、文档阅读和知识问答。',
    type: 'openai',
    isEnabled: false,
    readonly: true,
    models: []
  },
  {
    id: 'zhipu',
    name: '智谱 AI',
    description: '提供 GLM 系列模型，支持中文场景优化、对话生成与智能问答。',
    type: 'openai',
    isEnabled: false,
    readonly: true,
    models: []
  }
];
