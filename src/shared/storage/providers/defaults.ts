import type { Provider } from './types';

export const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: '提供 GPT 系列模型，适用于通用对话、内容生成、代码辅助与多模态能力。',
    baseUrl: 'https://api.openai.com/v1',
    type: 'openai',
    isEnabled: false,
    readonly: true,
    models: []
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: '提供 Claude 系列模型，擅长长文本理解、分析推理和高质量写作。',
    baseUrl: 'https://api.anthropic.com',
    type: 'anthropic',
    isEnabled: false,
    readonly: true,
    models: []
  },
  {
    id: 'google',
    name: 'Google AI',
    description: '提供 Gemini 系列模型，支持多模态处理、搜索增强与高效推理能力。',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    type: 'openai',
    isEnabled: false,
    readonly: true,
    models: []
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: '提供高性能推理与代码生成模型，适用于编程辅助和复杂逻辑任务。',
    baseUrl: 'https://api.deepseek.com',
    type: 'openai',
    isEnabled: false,
    readonly: true,
    models: []
  },
  {
    id: 'moonshot',
    name: 'Moonshot',
    description: '提供 Kimi 系列大模型，擅长长上下文处理、文档阅读和知识问答。',
    baseUrl: 'https://api.moonshot.cn/v1',
    type: 'openai',
    isEnabled: false,
    readonly: true,
    models: []
  },
  {
    id: 'zhipu',
    name: '智谱 AI',
    description: '提供 GLM 系列模型，支持中文场景优化、对话生成与智能问答。',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    type: 'openai',
    isEnabled: false,
    readonly: true,
    models: []
  },
  {
    id: 'alibaba',
    name: '阿里云',
    description: '提供通义千问系列模型，支持中文优化、多模态处理与企业级应用。',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    type: 'openai',
    isEnabled: false,
    readonly: true,
    models: []
  },
  {
    id: 'baidu',
    name: '百度',
    description: '提供文心一言系列模型，深耕中文场景，支持知识增强与对话生成。',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    type: 'openai',
    isEnabled: false,
    readonly: true,
    models: []
  },
  {
    id: 'bytedance',
    name: '字节跳动',
    description: '提供豆包系列模型，适用于对话生成、内容创作与智能助手场景。',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    type: 'openai',
    isEnabled: false,
    readonly: true,
    models: []
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    description: '提供 MiniMax 系列模型，支持长上下文、多模态与角色扮演。',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    type: 'anthropic',
    isEnabled: false,
    readonly: true,
    models: []
  },
  {
    id: 'xiaomi',
    name: '小米',
    description: '提供小米大模型，支持智能助手与多场景应用。',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    type: 'openai',
    isEnabled: false,
    readonly: true,
    models: []
  },
  {
    id: 'tencentcloud',
    name: '腾讯云',
    description: '提供混元系列大模型，擅长对话、创作、代码与企业级智能服务。',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    type: 'openai',
    isEnabled: false,
    readonly: true,
    models: []
  },
  {
    id: 'longcat',
    name: 'LongCat',
    description: '提供 LongCat 系列大模型，擅长长上下文、多模态与角色扮演。',
    baseUrl: 'https://api.longcat.chat/openai/v1',
    type: 'openai',
    isEnabled: false,
    readonly: true,
    models: []
  }
];
