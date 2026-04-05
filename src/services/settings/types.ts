export type ConnectionStatus = 'connected' | 'failed' | 'untested';

export type Provider = 'openai' | 'anthropic' | 'deepseek' | 'moonshot' | 'zhipu' | 'google' | 'custom';

export interface ApiKeyProfile {
  id: string;
  name: string;
  provider: Provider;
  keyRef: string;
  baseUrl: string | null;
  connectionStatus: ConnectionStatus;
  lastTestedAt: number | null;
  latencyMs: number | null;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateApiKeyProfileInput {
  name: string;
  provider: Provider;
  apiKey: string;
  baseUrl?: string;
  isDefault?: boolean;
}

export interface UpdateApiKeyProfileInput {
  name?: string;
  apiKey?: string;
  baseUrl?: string;
  isDefault?: boolean;
}

export interface Model {
  id: string;
  name: string;
  provider: Provider;
  modelId: string;
  apiKeyProfileId: string;
  maxTokens: number;
  temperature: number;
  isEnabled: boolean;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateModelInput {
  name: string;
  provider: Provider;
  modelId: string;
  apiKeyProfileId: string;
  maxTokens?: number;
  temperature?: number;
  isDefault?: boolean;
}

export interface UpdateModelInput {
  name?: string;
  modelId?: string;
  apiKeyProfileId?: string;
  maxTokens?: number;
  temperature?: number;
  isEnabled?: boolean;
  isDefault?: boolean;
}

export interface Assistant {
  id: string;
  name: string;
  modelId: string;
  systemPrompt: string | null;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateAssistantInput {
  name: string;
  modelId: string;
  systemPrompt?: string;
  isDefault?: boolean;
}

export interface UpdateAssistantInput {
  name?: string;
  modelId?: string;
  systemPrompt?: string;
  isDefault?: boolean;
}

export interface ConnectionTestResult {
  success: boolean;
  latencyMs: number | null;
  error: string | null;
}
