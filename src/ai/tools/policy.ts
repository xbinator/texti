/**
 * @file policy.ts
 * @description AI 工具服务商支持策略
 */

import { providerStorage } from '@/shared/storage/providers';

/**
 * AI 工具服务商支持信息
 */
export interface AIToolProviderSupport {
  /** 是否支持工具调用 */
  supported: boolean;
  /** 不支持时的原因 */
  reason?: string;
}

/**
 * 默认聊天工具名称列表
 */
const DEFAULT_CHAT_TOOL_NAMES = ['read_current_document', 'get_current_selection', 'search_current_document', 'insert_at_cursor'] as const;

/**
 * 获取模型服务商支持的工具支持状态
 * @param providerId - 服务商 ID
 * @param modelId - 模型 ID
 * @returns 工具支持信息
 */
export async function getModelToolSupport(providerId: string, modelId: string): Promise<AIToolProviderSupport> {
  const provider = await providerStorage.getProvider(providerId);

  if (!provider) {
    return { supported: false, reason: '当前服务商不存在' };
  }

  // 在服务商的模型列表中查找指定模型
  const model = provider.models?.find((m) => m.id === modelId);
  if (!model) {
    return { supported: false, reason: '当前模型不存在' };
  }

  // 优先检查模型的 supportsTools 配置
  if (model.supportsTools === true) {
    return { supported: true };
  }

  return { supported: false, reason: '当前模型不支持工具调用' };
}

/**
 * 获取默认聊天工具名称列表
 * @returns 工具名称数组
 */
export function getDefaultChatToolNames(): string[] {
  return [...DEFAULT_CHAT_TOOL_NAMES];
}
