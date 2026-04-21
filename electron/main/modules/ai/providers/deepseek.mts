/**
 * @file deepseek.mts
 * @description DeepSeek AI 服务商实现
 */
import type { AIProvider } from '../types.mjs';
import type { LanguageModel } from 'ai';
import type { AIServiceError, AICreateOptions } from 'types/ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { AI_ERROR_CODE, createAIServiceError } from '../errors/codes.mjs';
import { mapCommonError } from '../errors/common.mjs';
import { extractErrorDetails } from '../errors/utils.mjs';

/**
 * DeepSeek 服务商
 * @description 实现 DeepSeek 模型的创建和错误处理
 */
export class DeepSeekProvider implements AIProvider {
  /** 服务商类型标识 */
  readonly type = 'deepseek' as const;

  /**
   * 创建 DeepSeek 语言模型实例
   * @param options - 创建选项（包含 API Key、Base URL 等）
   * @param modelId - 模型 ID
   * @returns 语言模型实例
   */
  create(options: AICreateOptions, modelId: string) {
    const { apiKey, baseUrl: baseURL } = options;

    const deepseek = createDeepSeek({ apiKey, baseURL });
    return deepseek(modelId) as LanguageModel;
  }

  /**
   * 标准化 DeepSeek 错误
   * @param error - 原始错误
   * @param fallbackMessage - 默认错误消息
   * @returns 标准化的 AIServiceError
   */
  normalizeError(error: unknown, fallbackMessage = '服务调用失败'): AIServiceError {
    // 先尝试映射通用错误
    const commonError = mapCommonError(error, fallbackMessage);
    if (commonError) {
      return commonError;
    }

    const details = extractErrorDetails(error, fallbackMessage);

    const { statusCode, errorCode, normalizedMessage } = details;

    // 处理模型未找到错误
    if (errorCode === 'model_not_found' || /model not found|no such model|does not exist/i.test(normalizedMessage)) {
      return createAIServiceError(AI_ERROR_CODE.MODEL_NOT_FOUND, '模型不存在或当前服务商未提供该模型');
    }

    // 处理模型配置无效错误
    if (statusCode === 400 && normalizedMessage.includes('model')) {
      return createAIServiceError(AI_ERROR_CODE.MODEL_NOT_FOUND, '模型配置无效，请检查模型 ID 是否正确');
    }

    // 处理请求参数错误
    if (statusCode === 400) {
      return createAIServiceError(AI_ERROR_CODE.INVALID_REQUEST, normalizedMessage || '请求参数不合法');
    }

    return createAIServiceError(AI_ERROR_CODE.REQUEST_FAILED, normalizedMessage || fallbackMessage);
  }
}
