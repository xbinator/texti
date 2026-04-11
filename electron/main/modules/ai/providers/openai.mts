import type { AIServiceError } from '../errors/codes.mjs';
import type { AIProvider } from '../types.mjs';
import type { LanguageModel } from 'ai';
import type { AICreateOptions } from 'types/ai';
import { createOpenAI } from '@ai-sdk/openai';
import { AI_ERROR_CODE, createAIServiceError } from '../errors/codes.mjs';
import { mapCommonError } from '../errors/common.mjs';
import { extractErrorDetails } from '../errors/utils.mjs';

export class OpenAIProvider implements AIProvider {
  readonly type = 'openai' as const;

  create(options: AICreateOptions) {
    const { apiKey, baseUrl: baseURL, providerName } = options;

    return createOpenAI({ apiKey, baseURL, name: providerName }) as unknown as LanguageModel;
  }

  normalizeError(error: unknown, fallbackMessage = '服务调用失败'): AIServiceError {
    const commonError = mapCommonError(error, fallbackMessage);
    if (commonError) {
      return commonError;
    }

    const details = extractErrorDetails(error, fallbackMessage);

    const { statusCode, errorCode, normalizedMessage } = details;

    if (statusCode === 404 || errorCode === 'model_not_found' || /model not found|no such model|does not exist/i.test(normalizedMessage)) {
      return createAIServiceError(AI_ERROR_CODE.MODEL_NOT_FOUND, '模型不存在或当前服务商未提供该模型', error);
    }

    if (statusCode === 400 && (normalizedMessage.includes('model') || normalizedMessage.includes('deployment'))) {
      return createAIServiceError(AI_ERROR_CODE.MODEL_NOT_FOUND, '模型配置无效，请检查模型 ID 是否正确', error);
    }

    if (statusCode === 400) {
      return createAIServiceError(AI_ERROR_CODE.INVALID_REQUEST, normalizedMessage || '请求参数不合法', error);
    }

    return createAIServiceError(AI_ERROR_CODE.REQUEST_FAILED, normalizedMessage || fallbackMessage, error);
  }
}
