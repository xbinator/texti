/**
 * @file summaryGenerator.ts
 * @description AI 摘要生成器，负责调用摘要模型生成结构化摘要。
 */
import type { StructuredConversationSummary, TrimmedMessageItem } from './types';
import type { JSONSchema7 } from 'json-schema';
import { isEmpty } from 'lodash-es';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { providerStorage, serviceModelsStorage } from '@/shared/storage';

/**
 * 摘要生成的系统提示词模板。
 */
const SUMMARY_SYSTEM_PROMPT = `你是一个专业的对话摘要助手。你的任务是将对话历史压缩为结构化摘要。

请严格按照以下 JSON 格式输出摘要，不要包含任何其他文本：
{
  "goal": "用户的主要目标（一句话）",
  "recentTopic": "最近讨论的话题",
  "userPreferences": ["用户偏好1", "用户偏好2"],
  "constraints": ["约束条件1", "约束条件2"],
  "decisions": ["已做出的决策1", "已做出的决策2"],
  "importantFacts": ["重要事实1", "重要事实2"],
  "fileContext": [],
  "openQuestions": ["待解决问题1", "待解决问题2"],
  "pendingActions": ["待处理操作1", "待处理操作2"]
}

注意事项：
1. 只输出 JSON，不要包含任何解释性文本
2. 如果某个字段没有内容，使用空数组 []
3. 提取关键信息，避免冗余描述
4. 保持客观，不要添加主观判断`;

/**
 * 会话摘要结构化输出 schema。
 */
const STRUCTURED_SUMMARY_SCHEMA: JSONSchema7 = {
  type: 'object',
  properties: {
    goal: { type: 'string' },
    recentTopic: { type: 'string' },
    userPreferences: {
      type: 'array',
      items: { type: 'string' }
    },
    constraints: {
      type: 'array',
      items: { type: 'string' }
    },
    decisions: {
      type: 'array',
      items: { type: 'string' }
    },
    importantFacts: {
      type: 'array',
      items: { type: 'string' }
    },
    fileContext: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          startLine: { type: 'number' },
          endLine: { type: 'number' },
          userIntent: { type: 'string' },
          keySnippetSummary: { type: 'string' },
          shouldReloadOnDemand: { type: 'boolean' }
        },
        required: ['filePath', 'userIntent', 'keySnippetSummary', 'shouldReloadOnDemand'],
        additionalProperties: false
      }
    },
    openQuestions: {
      type: 'array',
      items: { type: 'string' }
    },
    pendingActions: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['goal', 'recentTopic', 'userPreferences', 'constraints', 'decisions', 'importantFacts', 'fileContext', 'openQuestions', 'pendingActions'],
  additionalProperties: false
};

/**
 * 构建摘要生成的用户提示词。
 */
function buildSummaryUserPrompt(items: TrimmedMessageItem[]): string {
  const conversationText = items.map((item) => `[${item.role}]: ${item.trimmedText}`).join('\n\n');

  return `以下是对话历史，请生成结构化摘要：

${conversationText}

请生成 JSON 格式的结构化摘要。`;
}

/**
 * 获取摘要模型配置。
 * 优先使用 'summarize' 服务配置，如果未配置则降级使用 'chat' 服务。
 */
async function getSummaryModelConfig(): Promise<{ providerId: string; modelId: string } | null> {
  // 优先使用 summarize 服务配置
  const summarizeConfig = await serviceModelsStorage.getConfig('summarize');
  if (summarizeConfig?.providerId && summarizeConfig?.modelId) {
    const provider = await providerStorage.getProvider(summarizeConfig.providerId);
    if (provider?.isEnabled) {
      return {
        providerId: summarizeConfig.providerId,
        modelId: summarizeConfig.modelId
      };
    }
  }

  // 降级使用 chat 服务配置
  const chatConfig = await serviceModelsStorage.getConfig('chat');
  if (chatConfig?.providerId && chatConfig?.modelId) {
    const provider = await providerStorage.getProvider(chatConfig.providerId);
    if (provider?.isEnabled) {
      return {
        providerId: chatConfig.providerId,
        modelId: chatConfig.modelId
      };
    }
  }

  return null;
}

/**
 * 生成降级的默认摘要（当 AI 调用失败时使用）。
 */
function generateFallbackSummary(items: TrimmedMessageItem[]): StructuredConversationSummary {
  const userMessages = items.filter((i) => i.role === 'user');
  const topics = userMessages.slice(0, 3).map((i) => i.trimmedText.slice(0, 50));

  return {
    goal: '用户正在进行对话',
    recentTopic: topics.join('; ') || '无明确话题',
    userPreferences: [],
    constraints: [],
    decisions: [],
    importantFacts: [],
    fileContext: [],
    openQuestions: [],
    pendingActions: []
  };
}

/**
 * 调用 AI 模型生成结构化摘要。
 * @param items - 规则裁剪后的消息项列表
 * @returns 结构化摘要，失败时返回降级摘要
 */
export async function generateStructuredSummary(items: TrimmedMessageItem[]): Promise<StructuredConversationSummary> {
  const config = await getSummaryModelConfig();
  if (!config) {
    console.warn('[摘要生成器] 没有可用的摘要模型，使用降级方案');
    return generateFallbackSummary(items);
  }

  const provider = await providerStorage.getProvider(config.providerId);
  if (!provider) {
    console.warn('[摘要生成器] 未找到提供商，使用降级方案');
    return generateFallbackSummary(items);
  }

  const userPrompt = buildSummaryUserPrompt(items);

  try {
    const electronAPI = getElectronAPI();
    const [error, result] = await electronAPI.aiInvoke(
      {
        providerId: provider.id,
        providerName: provider.name,
        apiKey: provider.apiKey ?? '',
        baseUrl: provider.baseUrl ?? '',
        providerType: provider.type
      },
      {
        modelId: config.modelId,
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        output: {
          schema: STRUCTURED_SUMMARY_SCHEMA,
          name: 'conversation_summary',
          description: 'Structured summary for compressed chat history context'
        }
      }
    );

    if (error) {
      console.error('[摘要生成器] AI 调用失败，使用降级方案:', error);
      return generateFallbackSummary(items);
    }

    if (result.output && typeof result.output === 'object') {
      const structuredResult = result.output as StructuredConversationSummary;
      if (!isEmpty(structuredResult.goal) && !isEmpty(structuredResult.recentTopic)) {
        return structuredResult;
      }
    }

    // 解析 JSON 响应
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[摘要生成器] 响应中未找到 JSON，使用降级方案');
      return generateFallbackSummary(items);
    }

    const summary = JSON.parse(jsonMatch[0]) as StructuredConversationSummary;

    // 验证必需字段
    if (isEmpty(summary.goal) || isEmpty(summary.recentTopic)) {
      console.error('[摘要生成器] 摘要结构无效，使用降级方案');
      return generateFallbackSummary(items);
    }

    return summary;
  } catch (error) {
    console.error('[摘要生成器] 生成摘要失败，使用降级方案:', error);
    return generateFallbackSummary(items);
  }
}

/**
 * 生成可读性摘要文本。
 */
export function generateSummaryText(summary: StructuredConversationSummary): string {
  const parts: string[] = [];

  parts.push(`目标：${summary.goal}`);
  parts.push(`话题：${summary.recentTopic}`);

  if (!isEmpty(summary.userPreferences)) {
    parts.push(`用户偏好：${summary.userPreferences.join('、')}`);
  }

  if (!isEmpty(summary.decisions)) {
    parts.push(`已做决策：${summary.decisions.join('、')}`);
  }

  if (!isEmpty(summary.importantFacts)) {
    parts.push(`重要事实：${summary.importantFacts.join('、')}`);
  }

  if (!isEmpty(summary.openQuestions)) {
    parts.push(`待解决问题：${summary.openQuestions.join('、')}`);
  }

  if (!isEmpty(summary.pendingActions)) {
    parts.push(`待处理操作：${summary.pendingActions.join('、')}`);
  }

  return parts.join('\n');
}
