import type { AIProviderConfig, AIServiceResult, GenerateTextInput, GenerateTextResult } from './types';
import type { StreamTextResult } from 'ai';
import type { Provider } from '@/shared/storage';
import { asyncTo } from '@/utils/asyncTo';
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

  async generateText(input: { providerId: string; ignoreEnabled?: boolean } & GenerateTextInput): Promise<AIServiceResult<GenerateTextResult>> {
    const [error, resolved] = await asyncTo(this.resolver.resolve(input.providerId, input.modelId, { ignoreEnabled: input.ignoreEnabled }));
    if (error) return [toAIServiceError(error)];

    const driver = this.registry.get(resolved.provider.type);
    const providerConfig = this.buildProviderConfig(resolved.provider);
    const [generateError, result] = await asyncTo(driver.generateText(providerConfig, input));

    if (generateError) return [toAIServiceError(generateError)];

    return [undefined, result];
  }

  async streamText(input: { providerId: string; ignoreEnabled?: boolean } & GenerateTextInput): Promise<AIServiceResult<StreamTextResult<any, any>>> {
    const [error, resolved] = await asyncTo(this.resolver.resolve(input.providerId, input.modelId, { ignoreEnabled: input.ignoreEnabled }));
    if (error) return [toAIServiceError(error)];

    const driver = this.registry.get(resolved.provider.type);
    const providerConfig = this.buildProviderConfig(resolved.provider);

    try {
      const result = await driver.streamText(providerConfig, input);

      return [undefined, result];
    } catch (streamError) {
      return [toAIServiceError(streamError)];
    }
  }
}
