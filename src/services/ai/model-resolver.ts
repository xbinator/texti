import type { ResolvedProviderModel } from './types';
import { providerStorage } from '@/shared/storage';
import { AI_ERROR_CODE, AIError } from './errors';

export class AIModelResolver {
  async resolve(providerId: string, modelId: string, options?: { ignoreEnabled?: boolean }): Promise<ResolvedProviderModel> {
    const providers = await providerStorage.listProviders();
    const provider = providers.find((item) => item.id === providerId);

    if (!provider) {
      throw new AIError(AI_ERROR_CODE.PROVIDER_NOT_FOUND, '服务商不存在');
    }

    if (!options?.ignoreEnabled && !provider.isEnabled) {
      throw new AIError(AI_ERROR_CODE.PROVIDER_DISABLED, '服务商未启用');
    }

    if (!provider.apiKey?.trim()) {
      throw new AIError(AI_ERROR_CODE.API_KEY_MISSING, '请先配置 API Key');
    }

    const model = provider.models?.find((item) => item.id === modelId);

    if (!model) {
      throw new AIError(AI_ERROR_CODE.MODEL_NOT_FOUND, '模型不存在');
    }

    if (!options?.ignoreEnabled && !model.isEnabled) {
      throw new AIError(AI_ERROR_CODE.MODEL_DISABLED, '模型未启用');
    }

    return { provider, model };
  }
}
