export const AI_ERROR_CODE = {
  PROVIDER_NOT_FOUND: 'PROVIDER_NOT_FOUND',
  PROVIDER_DISABLED: 'PROVIDER_DISABLED',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  MODEL_DISABLED: 'MODEL_DISABLED',
  API_KEY_MISSING: 'API_KEY_MISSING',
  UNSUPPORTED_PROVIDER_TYPE: 'UNSUPPORTED_PROVIDER_TYPE',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_BASE_URL: 'INVALID_BASE_URL',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  REQUEST_FAILED: 'REQUEST_FAILED'
} as const;

export type AIErrorCode =
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_DISABLED'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_DISABLED'
  | 'API_KEY_MISSING'
  | 'UNSUPPORTED_PROVIDER_TYPE'
  | 'INVALID_RESPONSE'
  | 'INVALID_REQUEST'
  | 'INVALID_BASE_URL'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'REQUEST_FAILED';

export class AIError extends Error {
  readonly code: AIErrorCode;

  readonly cause?: unknown;

  constructor(code: AIErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AIError';
    this.code = code;
    this.cause = cause;
  }
}

export function isAIError(error: unknown): error is AIError {
  return error instanceof AIError;
}

export function createAIError(code: AIErrorCode, message: string, cause?: unknown): AIError {
  return new AIError(code, message, cause);
}

interface ExtractedErrorDetails {
  message: string;
  normalizedMessage: string;
  statusCode?: number;
  errorCode?: string;
  errorType?: string;
  providerStatus?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getStringValue(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

function getNumberValue(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' ? value : undefined;
}

function getNestedRecord(source: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = source[key];
  return isRecord(value) ? value : undefined;
}

function extractErrorDetails(error: unknown, fallbackMessage: string): ExtractedErrorDetails {
  const root = isRecord(error) ? error : undefined;
  const responseBody = root ? getNestedRecord(root, 'responseBody') : undefined;
  const bodyError = responseBody ? getNestedRecord(responseBody, 'error') : undefined;
  const data = root ? getNestedRecord(root, 'data') : undefined;
  const dataError = data ? getNestedRecord(data, 'error') : undefined;
  const message = error instanceof Error ? error.message : fallbackMessage;
  const statusCode = root ? getNumberValue(root, 'statusCode') : undefined;
  const errorCode = getStringValue(bodyError ?? dataError ?? root ?? {}, 'code');
  const errorType = getStringValue(bodyError ?? dataError ?? root ?? {}, 'type');
  const providerStatus = getStringValue(bodyError ?? dataError ?? root ?? {}, 'status');

  return {
    message,
    normalizedMessage: message.toLowerCase(),
    statusCode,
    errorCode: errorCode?.toLowerCase(),
    errorType: errorType?.toLowerCase(),
    providerStatus: providerStatus?.toLowerCase()
  };
}

function mapCommonError(error: unknown, fallbackMessage: string): AIError | null {
  if (isAIError(error)) {
    return error;
  }

  const details = extractErrorDetails(error, fallbackMessage);

  if (details.statusCode === 401 || details.normalizedMessage.includes('unauthorized')) {
    return createAIError(AI_ERROR_CODE.UNAUTHORIZED, 'API Key 无效或已过期', error);
  }

  if (details.statusCode === 403 || details.providerStatus === 'permission_denied') {
    return createAIError(AI_ERROR_CODE.FORBIDDEN, '当前账号没有访问该服务或模型的权限', error);
  }

  if (
    details.statusCode === 429 ||
    details.statusCode === 529 ||
    details.providerStatus === 'resource_exhausted' ||
    details.errorType === 'rate_limit_error' ||
    details.errorType === 'overloaded_error' ||
    details.normalizedMessage.includes('rate limit') ||
    details.normalizedMessage.includes('too many requests') ||
    details.normalizedMessage.includes('quota') ||
    details.normalizedMessage.includes('resource exhausted')
  ) {
    return createAIError(AI_ERROR_CODE.RATE_LIMITED, '请求过于频繁或额度已耗尽，请稍后重试', error);
  }

  if (details.statusCode === 500 || details.statusCode === 502 || details.statusCode === 503 || details.statusCode === 504) {
    return createAIError(AI_ERROR_CODE.SERVICE_UNAVAILABLE, 'AI 服务暂时不可用，请稍后重试', error);
  }

  if (
    details.normalizedMessage.includes('base url') ||
    details.normalizedMessage.includes('invalid url') ||
    details.normalizedMessage.includes('failed to parse url') ||
    details.normalizedMessage.includes('unsupported protocol')
  ) {
    return createAIError(AI_ERROR_CODE.INVALID_BASE_URL, 'API 地址格式不正确', error);
  }

  return null;
}

export function normalizeOpenAIError(error: unknown, fallbackMessage = 'OpenAI 兼容服务调用失败'): AIError {
  const commonError = mapCommonError(error, fallbackMessage);
  if (commonError) {
    return commonError;
  }

  const details = extractErrorDetails(error, fallbackMessage);

  if (
    details.statusCode === 404 ||
    details.errorCode === 'model_not_found' ||
    details.normalizedMessage.includes('model not found') ||
    details.normalizedMessage.includes('no such model') ||
    details.normalizedMessage.includes('does not exist')
  ) {
    return createAIError(AI_ERROR_CODE.MODEL_NOT_FOUND, '模型不存在或当前服务商未提供该模型', error);
  }

  if (details.statusCode === 400 && (details.normalizedMessage.includes('model') || details.normalizedMessage.includes('deployment'))) {
    return createAIError(AI_ERROR_CODE.MODEL_NOT_FOUND, '模型配置无效，请检查模型 ID 是否正确', error);
  }

  if (details.statusCode === 400) {
    return createAIError(AI_ERROR_CODE.INVALID_REQUEST, details.message || '请求参数不合法', error);
  }

  return createAIError(AI_ERROR_CODE.REQUEST_FAILED, details.message || fallbackMessage, error);
}

export function normalizeAnthropicError(error: unknown, fallbackMessage = 'Anthropic 服务调用失败'): AIError {
  const commonError = mapCommonError(error, fallbackMessage);
  if (commonError) {
    return commonError;
  }

  const details = extractErrorDetails(error, fallbackMessage);

  if (details.statusCode === 404 || (details.normalizedMessage.includes('model') && details.normalizedMessage.includes('not found'))) {
    return createAIError(AI_ERROR_CODE.MODEL_NOT_FOUND, '模型不存在或当前账号无法访问该模型', error);
  }

  if (details.errorType === 'authentication_error') {
    return createAIError(AI_ERROR_CODE.UNAUTHORIZED, 'Anthropic API Key 无效或已过期', error);
  }

  if (details.statusCode === 400) {
    return createAIError(AI_ERROR_CODE.INVALID_REQUEST, details.message || 'Anthropic 请求参数不合法', error);
  }

  return createAIError(AI_ERROR_CODE.REQUEST_FAILED, details.message || fallbackMessage, error);
}

export function normalizeGoogleError(error: unknown, fallbackMessage = 'Google AI 服务调用失败'): AIError {
  const commonError = mapCommonError(error, fallbackMessage);
  if (commonError) {
    return commonError;
  }

  const details = extractErrorDetails(error, fallbackMessage);

  if (
    details.providerStatus === 'not_found' ||
    details.statusCode === 404 ||
    details.normalizedMessage.includes('model not found') ||
    details.normalizedMessage.includes('publisher model')
  ) {
    return createAIError(AI_ERROR_CODE.MODEL_NOT_FOUND, '模型不存在或当前 Google AI 配置无法访问该模型', error);
  }

  if (details.statusCode === 400 && details.normalizedMessage.includes('api key')) {
    return createAIError(AI_ERROR_CODE.UNAUTHORIZED, 'Google AI API Key 无效', error);
  }

  if (details.statusCode === 400) {
    return createAIError(AI_ERROR_CODE.INVALID_REQUEST, details.message || 'Google AI 请求参数不合法', error);
  }

  return createAIError(AI_ERROR_CODE.REQUEST_FAILED, details.message || fallbackMessage, error);
}

export function toAIError(error: unknown, fallbackMessage = 'AI 请求失败'): AIError {
  const commonError = mapCommonError(error, fallbackMessage);

  if (commonError) {
    return commonError;
  }

  const details = extractErrorDetails(error, fallbackMessage);

  if (
    details.statusCode === 404 &&
    (details.normalizedMessage.includes('model') || details.errorCode?.includes('model') || details.errorType?.includes('model'))
  ) {
    return createAIError(AI_ERROR_CODE.MODEL_NOT_FOUND, '模型不存在', error);
  }

  if (details.statusCode === 400) {
    return createAIError(AI_ERROR_CODE.INVALID_REQUEST, details.message || fallbackMessage, error);
  }

  return createAIError(AI_ERROR_CODE.REQUEST_FAILED, details.message || fallbackMessage, error);
}

export { AIError as AIServiceError };
export type { AIErrorCode as AIServiceErrorCode };
export const isAIServiceError = isAIError;
export const toAIServiceError = toAIError;
