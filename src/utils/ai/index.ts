import type { ModelConfig } from './types';
import { generateText, streamText } from 'ai';
import { getModelClient } from './providers';

export interface GenerateTextOptions {
  prompt: string;
  systemPrompt?: string | null;
  temperature?: number;
  maxTokens?: number;
}

export interface StreamTextOptions extends GenerateTextOptions {
  onToken?: (token: string) => void;
}

export async function generateAIText(modelConfig: ModelConfig, options: GenerateTextOptions): Promise<string> {
  const model = getModelClient(modelConfig.provider, { apiKey: modelConfig.apiKey, baseURL: modelConfig.baseUrl || undefined }, modelConfig.modelId);

  const result = await generateText({
    model,
    prompt: options.prompt,
    system: options.systemPrompt || undefined,
    temperature: options.temperature ?? modelConfig.temperature,
    maxTokens: options.maxTokens ?? modelConfig.maxTokens
  });

  return result.text;
}

async function consumeStream(
  reader: ReadableStreamDefaultReader<string>,
  onToken: ((token: string) => void) | undefined,
  accumulated: string
): Promise<string> {
  const { done, value } = await reader.read();

  if (done) {
    return accumulated;
  }

  const newAccumulated = accumulated + value;
  if (onToken) {
    onToken(value);
  }

  return consumeStream(reader, onToken, newAccumulated);
}

export async function streamAIText(modelConfig: ModelConfig, options: StreamTextOptions): Promise<string> {
  const model = getModelClient(modelConfig.provider, { apiKey: modelConfig.apiKey, baseURL: modelConfig.baseUrl || undefined }, modelConfig.modelId);

  const result = streamText({
    model,
    prompt: options.prompt,
    system: options.systemPrompt || undefined,
    temperature: options.temperature ?? modelConfig.temperature,
    maxTokens: options.maxTokens ?? modelConfig.maxTokens
  });

  const reader = result.textStream.getReader();

  return consumeStream(reader, options.onToken, '');
}

export { getModelClient } from './providers';
export type { ModelConfig, AIProviderConfig, AIModel } from './types';
