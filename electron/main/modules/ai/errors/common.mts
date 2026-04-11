import type { AIServiceError } from 'types/ai';
import { AI_ERROR_CODE, createAIServiceError, isAIServiceError } from './codes.mjs';
import { extractErrorDetails } from './utils.mjs';

const RATE_LIMIT_STATUS_CODES = [429, 529];
const RATE_LIMIT_ERROR_TYPES = ['rate_limit_error', 'overloaded_error'];
const RATE_LIMIT_KEYWORDS = ['rate limit', 'too many requests', 'quota', 'resource exhausted'];

const SERVICE_UNAVAILABLE_STATUS_CODES = [500, 502, 503, 504];

const INVALID_URL_KEYWORDS = ['base url', 'invalid url', 'failed to parse url', 'unsupported protocol'];

export function mapCommonError(error: unknown, fallbackMessage: string): AIServiceError | null {
  if (isAIServiceError(error)) {
    return error;
  }

  const details = extractErrorDetails(error, fallbackMessage);

  if (details.statusCode === 401 || details.normalizedMessage.includes('unauthorized')) {
    return createAIServiceError(AI_ERROR_CODE.UNAUTHORIZED, 'API Key 无效或已过期');
  }

  if (details.statusCode === 403 || details.providerStatus === 'permission_denied') {
    return createAIServiceError(AI_ERROR_CODE.FORBIDDEN, '当前账号没有访问该服务或模型的权限');
  }

  const isRateLimited =
    (details.statusCode && RATE_LIMIT_STATUS_CODES.includes(details.statusCode)) ||
    details.providerStatus === 'resource_exhausted' ||
    (details.errorType && RATE_LIMIT_ERROR_TYPES.includes(details.errorType)) ||
    RATE_LIMIT_KEYWORDS.some((keyword) => details.normalizedMessage.includes(keyword));

  if (isRateLimited) {
    return createAIServiceError(AI_ERROR_CODE.RATE_LIMITED, '请求过于频繁或额度已耗尽，请稍后重试');
  }

  if (details.statusCode && SERVICE_UNAVAILABLE_STATUS_CODES.includes(details.statusCode)) {
    return createAIServiceError(AI_ERROR_CODE.SERVICE_UNAVAILABLE, 'AI 服务暂时不可用，请稍后重试');
  }

  const isInvalidUrl = INVALID_URL_KEYWORDS.some((keyword) => details.normalizedMessage.includes(keyword));

  if (isInvalidUrl) {
    return createAIServiceError(AI_ERROR_CODE.INVALID_BASE_URL, 'API 地址格式不正确');
  }

  return null;
}
