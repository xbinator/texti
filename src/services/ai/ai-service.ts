import type { AIProviderConfig, AIServiceResult, GenerateTextInput, GenerateTextResult } from './types';
import { asyncTo } from '@/utils/asyncTo';
import type { Provider } from '@/utils/storage';
import { toAIServiceError } from './errors';
import { AIModelResolver } from './model-resolver';
import { AIProviderRegistry } from './provider-registry';

export class AIService {
  // eslint-disable-next-line no-useless-constructor
  constructor(private readonly registry: AIProviderRegistry, private readonly resolver: AIModelResolver) {}

  private buildProviderConfig(provider: Provider): AIProviderConfig {
    const { id, type, apiKey, baseUrl } = provider;

    return { providerId: id, type, apiKey: apiKey ?? '', baseUrl: baseUrl ?? '' };
  }

  async generateText(input: { providerId: string } & GenerateTextInput): AIServiceResult<GenerateTextResult> {
    const [error, resolved] = await asyncTo(this.resolver.resolve(input.providerId, input.modelId));
    if (error) return [toAIServiceError(error)];

    const driver = this.registry.get(resolved.provider.type);
    const providerConfig = this.buildProviderConfig(resolved.provider);
    const [generateError, result] = await asyncTo(driver.generateText(providerConfig, input));

    if (generateError || !result) {
      return [toAIServiceError(generateError)];
    }

    return [undefined, result];
  }
}
