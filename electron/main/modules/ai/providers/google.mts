import type { AIServiceError } from '../errors/codes.mjs';
import type { AIProvider } from '../types.mjs';
import type { LanguageModel } from 'ai';
import type { AICreateOptions } from 'types/ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { AI_ERROR_CODE, createAIServiceError } from '../errors/codes.mjs';
import { mapCommonError } from '../errors/common.mjs';
import { extractErrorDetails } from '../errors/utils.mjs';

export class GoogleProvider implements AIProvider {
  readonly type = 'google' as const;

  create(options: AICreateOptions) {
    const { apiKey, baseUrl: baseURL, providerName } = options;

    return createGoogleGenerativeAI({ apiKey, baseURL, name: providerName }) as unknown as LanguageModel;
  }

  normalizeError(error: unknown, fallbackMessage = '服务调用失败'): AIServiceError {
    const commonError = mapCommonError(error, fallbackMessage);
    if (commonError) {
      return commonError;
    }

    const details = extractErrorDetails(error, fallbackMessage);

    const { statusCode, normalizedMessage, providerStatus } = details;

    if (providerStatus === 'not_found' || statusCode === 404 || /model not found|publisher model/i.test(normalizedMessage)) {
      return createAIServiceError(AI_ERROR_CODE.MODEL_NOT_FOUND, '模型不存在或当前 Google AI 配置无法访问该模型', error);
    }

    if (statusCode === 400 && normalizedMessage.includes('api key')) {
      return createAIServiceError(AI_ERROR_CODE.UNAUTHORIZED, 'Google AI API Key 无效', error);
    }

    if (statusCode === 400) {
      return createAIServiceError(AI_ERROR_CODE.INVALID_REQUEST, normalizedMessage || 'Google AI 请求参数不合法', error);
    }

    return createAIServiceError(AI_ERROR_CODE.REQUEST_FAILED, details.message || fallbackMessage, error);
  }
}
