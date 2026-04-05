import { ref, type Ref } from 'vue';
import { getDecryptedApiKey } from '@/services/settings/apiKeyService';
import { useModelStore, useAssistantStore, useApiKeyStore } from '@/stores/settings';
import { generateAIText, streamAIText, type GenerateTextOptions, type StreamTextOptions } from '@/utils/ai';

export interface UseAIOptions {
  modelId?: string;
  assistantId?: string;
}

export interface UseAIReturn {
  isLoading: Ref<boolean>;
  error: Ref<string | null>;
  generate: (prompt: string, options?: Partial<GenerateTextOptions>) => Promise<string>;
  stream: (prompt: string, options?: Partial<StreamTextOptions>) => Promise<string>;
}

export function useAI(options: UseAIOptions = {}): UseAIReturn {
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const modelStore = useModelStore();
  const assistantStore = useAssistantStore();
  const apiKeyStore = useApiKeyStore();

  async function getModelConfig() {
    await Promise.all([modelStore.loadModels(), assistantStore.loadAssistants(), apiKeyStore.loadProfiles()]);

    const model = options.modelId ? modelStore.getModelById(options.modelId) : modelStore.defaultModel;

    if (!model) {
      throw new Error('No model available');
    }

    const apiKey = await getDecryptedApiKey(model.apiKeyProfileId);
    if (!apiKey) {
      throw new Error('API key not found');
    }

    const profile = apiKeyStore.getProfileById(model.apiKeyProfileId);

    return {
      provider: model.provider,
      modelId: model.modelId,
      apiKey,
      baseUrl: profile?.baseUrl,
      temperature: model.temperature,
      maxTokens: model.maxTokens
    };
  }

  async function getSystemPrompt(): Promise<string | null> {
    if (options.assistantId) {
      await assistantStore.loadAssistants();
      const assistant = assistantStore.getAssistantById(options.assistantId);
      return assistant?.systemPrompt || null;
    }
    return null;
  }

  async function generate(prompt: string, generateOptions?: Partial<GenerateTextOptions>): Promise<string> {
    isLoading.value = true;
    error.value = null;

    try {
      const modelConfig = await getModelConfig();
      const systemPrompt = await getSystemPrompt();

      const result = await generateAIText(modelConfig, {
        prompt,
        systemPrompt: generateOptions?.systemPrompt || systemPrompt,
        temperature: generateOptions?.temperature,
        maxTokens: generateOptions?.maxTokens
      });

      return result;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Generation failed';
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  async function stream(prompt: string, streamOptions?: Partial<StreamTextOptions>): Promise<string> {
    isLoading.value = true;
    error.value = null;

    try {
      const modelConfig = await getModelConfig();
      const systemPrompt = await getSystemPrompt();

      const result = await streamAIText(modelConfig, {
        prompt,
        systemPrompt: streamOptions?.systemPrompt || systemPrompt,
        temperature: streamOptions?.temperature,
        maxTokens: streamOptions?.maxTokens,
        onToken: streamOptions?.onToken
      });

      return result;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Streaming failed';
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  return {
    isLoading,
    error,
    generate,
    stream
  };
}
