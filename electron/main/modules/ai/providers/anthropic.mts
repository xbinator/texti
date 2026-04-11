import type { AIServiceError } from '../errors/codes.mjs';
import type { AIProvider } from '../types.mjs';
import type { LanguageModel } from 'ai';
import type { AICreateOptions } from 'types/ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { AI_ERROR_CODE, createAIServiceError } from '../errors/codes.mjs';
import { mapCommonError } from '../errors/common.mjs';
import { extractErrorDetails } from '../errors/utils.mjs';

export class AnthropicProvider implements AIProvider {
  readonly type = 'anthropic' as const;

  create(options: AICreateOptions) {
    const { apiKey, baseUrl: baseURL, providerName } = options;

    return createAnthropic({ apiKey, baseURL, name: providerName }) as unknown as LanguageModel;
  }

  normalizeError(error: unknown, fallbackMessage = '服务调用失败'): AIServiceError {
    const commonError = mapCommonError(error, fallbackMessage);
    if (commonError) {
      return commonError;
    }

    const details = extractErrorDetails(error, fallbackMessage);

    const { statusCode, normalizedMessage, errorType } = details;

    if (statusCode === 404 || /model.*not found|not found.*model/i.test(normalizedMessage)) {
      return createAIServiceError(AI_ERROR_CODE.MODEL_NOT_FOUND, '模型不存在或当前账号无法访问该模型', error);
    }

    if (errorType === 'authentication_error') {
      return createAIServiceError(AI_ERROR_CODE.UNAUTHORIZED, 'API Key 无效或已过期', error);
    }

    if (statusCode === 400) {
      return createAIServiceError(AI_ERROR_CODE.INVALID_REQUEST, normalizedMessage || '请求参数不合法', error);
    }

    return createAIServiceError(AI_ERROR_CODE.REQUEST_FAILED, normalizedMessage || fallbackMessage, error);
  }
}
