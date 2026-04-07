import { AIService } from './ai-service';
import { AIModelResolver } from './model-resolver';
import { AIProviderRegistry } from './provider-registry';
import { AnthropicProvider } from './providers/anthropic-provider';
import { GoogleProvider } from './providers/google-provider';
import { OpenAIProvider } from './providers/openai-provider';

const aiProviderRegistry = new AIProviderRegistry();

aiProviderRegistry.register(new OpenAIProvider());
aiProviderRegistry.register(new AnthropicProvider());
aiProviderRegistry.register(new GoogleProvider());

const aiModelResolver = new AIModelResolver();

export const aiService = new AIService(aiProviderRegistry, aiModelResolver);

export { AIService } from './ai-service';
export { AI_ERROR_CODE, AIError, AIServiceError, isAIError, isAIServiceError, toAIError, toAIServiceError } from './errors';
export { AIModelResolver } from './model-resolver';
export { AIProviderRegistry } from './provider-registry';
export type {
  AIProvider,
  AIProviderConfig,
  AIProviderDriver,
  AIProviderType,
  AIServiceResult,
  CreateLanguageModelInput,
  GenerateTextInput,
  GenerateTextResult,
  ResolvedProviderModel
} from './types';
