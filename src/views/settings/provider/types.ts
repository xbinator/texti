export interface Model {
  // 模型 ID
  id: string;
  // 模型名称
  name: string;
  // 模型描述
  description: string;
}

export interface Provider {
  // 服务商 ID
  id: string;
  // 服务商名称
  name: string;
  // 服务商描述
  description: string;
  // 接入类型
  type: 'openai' | 'anthropic' | 'google';
  // 是否启用
  isEnabled: boolean;
  // API 密钥
  apiKey?: string;
  // 基础 URL
  baseUrl?: string;
  // 是否只读
  readonly?: boolean;
  // 模型列表
  models?: Model[];
}
