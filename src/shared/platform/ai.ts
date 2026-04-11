import type { AIGenerateResult, ElectronAIRequestPayload } from './electron-api';
import type { AIProvider, AICreateOptions, AIRequestOptions } from 'types/ai';
import { providerStorage } from '@/shared/storage';
import { getElectronAPI, hasElectronAPI } from './electron-api';

export interface AITextRequestInput extends AIRequestOptions {
  providerId: string;
  ignoreEnabled?: boolean;
  providerOverride?: Partial<AIProvider>;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function resolveProvider(input: AITextRequestInput): Promise<AIProvider> {
  const storedProvider = await providerStorage.getProvider(input.providerId);
  const provider = {
    ...storedProvider,
    ...input.providerOverride,
    id: input.providerOverride?.id ?? storedProvider?.id ?? input.providerId
  } as Partial<AIProvider>;

  if (!provider.id) {
    throw new Error('服务商不存在');
  }

  if (!input.ignoreEnabled && !provider.isEnabled) {
    throw new Error('服务商未启用');
  }

  if (!provider.type) {
    throw new Error('服务商类型缺失');
  }

  if (!provider.name?.trim()) {
    throw new Error('服务商名称缺失');
  }

  if (!provider.apiKey?.trim()) {
    throw new Error('请先配置 API Key');
  }

  return provider as AIProvider;
}

function buildCreateOptions(provider: AIProvider): AICreateOptions {
  return {
    providerType: provider.type,
    providerId: provider.id,
    providerName: provider.name,
    apiKey: provider.apiKey ?? '',
    baseUrl: provider.baseUrl
  };
}

export async function buildElectronAIRequestPayload(input: AITextRequestInput): Promise<ElectronAIRequestPayload> {
  if (!hasElectronAPI()) {
    throw new Error('Electron AI 不可用');
  }

  const provider = await resolveProvider(input);

  return {
    createOptions: buildCreateOptions(provider),
    request: {
      modelId: input.modelId,
      prompt: input.prompt,
      system: input.system,
      temperature: input.temperature
    }
  };
}

export async function generateElectronAIText(input: AITextRequestInput): Promise<[Error] | [undefined, AIGenerateResult]> {
  try {
    const payload = await buildElectronAIRequestPayload(input);
    const result = await getElectronAPI().aiGenerate(payload);

    return [undefined, result];
  } catch (error: unknown) {
    return [toError(error)];
  }
}
