import type { AIServiceError } from 'types/ai';

/**
 * AI 服务错误代码常量
 * 定义了所有可能的 AI 服务错误类型
 */
export const AI_ERROR_CODE = {
  /** 模型未找到 */
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  /** 无效的请求 */
  INVALID_REQUEST: 'INVALID_REQUEST',
  /** 无效的基础 URL */
  INVALID_BASE_URL: 'INVALID_BASE_URL',
  /** 未授权（认证失败） */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** 禁止访问（权限不足） */
  FORBIDDEN: 'FORBIDDEN',
  /** 请求频率限制 */
  RATE_LIMITED: 'RATE_LIMITED',
  /** 服务不可用 */
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  /** 请求失败 */
  REQUEST_FAILED: 'REQUEST_FAILED'
} as const;

/** AI 错误代码类型，从 AI_ERROR_CODE 常量中提取所有值的联合类型 */
export type AIErrorCode = (typeof AI_ERROR_CODE)[keyof typeof AI_ERROR_CODE];

/**
 * 从错误响应中提取的错误详情
 * 包含错误消息、状态码、错误代码等信息
 */
export interface ExtractedErrorDetails {
  /** 原始错误消息 */
  message: string;
  /** 标准化后的错误消息 */
  normalizedMessage: string;
  /** HTTP 状态码 */
  statusCode?: number;
  /** 错误代码 */
  errorCode?: string;
  /** 错误类型 */
  errorType?: string;
  /** 提供商状态 */
  providerStatus?: string;
}

/**
 * 类型守卫函数，检查给定的错误是否为 AIServiceError 类型
 * @param error - 要检查的错误对象
 * @returns 如果是 AIServiceError 类型返回 true，否则返回 false
 */
export function isAIServiceError(error: unknown): error is AIServiceError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as Record<string, unknown>).message === 'string' &&
    typeof (error as Record<string, unknown>).code === 'string'
  );
}

/**
 * 创建 AI 服务错误对象
 * @param code - 错误代码
 * @param message - 错误消息
 * @returns AIServiceError 错误对象
 */
export function createAIServiceError(code: AIErrorCode, message: string): AIServiceError {
  return { code, message };
}
