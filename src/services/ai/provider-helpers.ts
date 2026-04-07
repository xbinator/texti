import type { AIProviderConfig, CreateLanguageModelInput, GenerateTextInput } from './types';
import type { LanguageModel } from 'ai';
import { generateText } from 'ai';
import { asyncTo } from '@/utils/asyncTo';
import { AIError, AI_ERROR_CODE } from './errors';

export interface AIProviderErrorNormalizerContext {
  fallbackMessage?: string;
}

export type AIProviderErrorNormalizer = (error: unknown, context?: AIProviderErrorNormalizerContext) => AIError;

export interface LanguageModelFactory {
  createLanguageModel(input: CreateLanguageModelInput): LanguageModel;
}

export interface AIProviderExecutor extends LanguageModelFactory {
  normalizeError(error: unknown, context?: AIProviderErrorNormalizerContext): AIError;
}

export async function executeGenerateText(executor: AIProviderExecutor, config: AIProviderConfig, input: GenerateTextInput) {
  const { modelId, system, prompt, temperature, maxTokens } = input;

  const model = executor.createLanguageModel({ config, modelId });

  const [error, result] = await asyncTo(generateText({ model, system, prompt, temperature, maxTokens }));

  if (error) {
    throw executor.normalizeError(error, { fallbackMessage: '文本生成失败' });
  }

  if (!result.text) {
    throw new AIError(AI_ERROR_CODE.INVALID_RESPONSE, '模型未返回有效文本');
  }

  return { text: result.text };
}
