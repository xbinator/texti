/**
 * @file service.mts
 * @description AI 服务核心类，封装文本生成和流式文本生成能力
 */
import type { AICreateOptions, AIRequestOptions, AIInvokeResult, AIStreamResult, AIServiceError } from 'types/ai';
import { generateText, jsonSchema, streamText, tool } from 'ai';
import { log } from '../logger/service.mjs';
import { AIProviderRegistry } from './providers/_index.mjs';

/**
 * 将前端工具定义转换为 AI SDK 的工具格式
 * @param tools - 前端工具定义数组
 * @returns AI SDK 兼容的工具对象
 */
function toSdkTools(tools: AIRequestOptions['tools']) {
  if (!tools?.length) return undefined;

  return Object.fromEntries(
    tools.map((item) => [
      item.name,
      tool({
        description: item.description,
        inputSchema: jsonSchema(item.parameters)
      })
    ])
  );
}

/**
 * AI 服务类
 * @description 封装 AI 模型调用能力，支持同步和流式两种模式
 */
class AIService {
  /** AI 服务商注册表 */
  public aiProvider: AIProviderRegistry = new AIProviderRegistry();

  /** AbortController 映射表，用于中止流式请求 */
  private abortControllers = new Map<string, AbortController>();

  /**
   * 中止指定的流式请求
   * @param requestId - 请求 ID
   */
  abortStream(requestId: string) {
    if (!this.abortControllers.has(requestId)) return;

    this.abortControllers.get(requestId)?.abort();
    this.abortControllers.delete(requestId);
    log.info(`[AIService] Stream aborted manually for requestId: ${requestId}`);
  }

  /**
   * 移除指定的 AbortController
   * @param requestId - 请求 ID
   */
  removeController(requestId: string) {
    this.abortControllers.delete(requestId);
  }

  /**
   * 创建语言模型实例
   * @param createOptions - 创建选项
   * @param modelId - 模型 ID
   * @returns 语言模型实例
   */
  private createModel(createOptions: AICreateOptions, modelId: string) {
    return this.aiProvider.create(createOptions, modelId);
  }

  /**
   * 同步生成文本
   * @param createOptions - 创建选项（包含服务商配置）
   * @param request - 请求选项（包含模型 ID、消息等）
   * @returns 错误或生成结果
   */
  async generateText(createOptions: AICreateOptions, request: AIRequestOptions): Promise<[AIServiceError] | [undefined, AIInvokeResult]> {
    try {
      const model = this.createModel(createOptions, request.modelId);
      const { prompt = '', system, temperature, messages } = request;

      log.info(`[AIService] generateText: Provider=${createOptions.providerType}, Model=${request.modelId}, tools=${JSON.stringify(request.tools)}`);
      log.info(`[AIService] generateText payload:`, { prompt, system, temperature, messages });

      const baseOptions = { model, system, temperature, tools: toSdkTools(request.tools) };

      // 根据是否有 messages 选择不同的调用方式
      const result = messages ? await generateText({ ...baseOptions, messages }) : await generateText({ ...baseOptions, prompt });

      const { inputTokens = 0, outputTokens = 0, totalTokens = 0 } = result.usage || {};

      return [undefined, { text: result.text, usage: { inputTokens, outputTokens, totalTokens } }];
    } catch (error: unknown) {
      log.error('[AIService] generateText error:', error);

      return [this.aiProvider.normalizeError(error, createOptions.providerType)];
    }
  }

  /**
   * 流式生成文本
   * @param createOptions - 创建选项（包含服务商配置）
   * @param request - 请求选项（包含模型 ID、消息、请求 ID 等）
   * @returns 错误或流式结果
   */
  async streamText(createOptions: AICreateOptions, request: AIRequestOptions): Promise<[AIServiceError] | [undefined, AIStreamResult]> {
    try {
      const model = this.createModel(createOptions, request.modelId);
      const { prompt = '', system, temperature, requestId, messages } = request;

      // 创建 AbortController 用于中止请求
      let abortSignal: AbortSignal | undefined;
      if (requestId) {
        const controller = new AbortController();
        this.abortControllers.set(requestId, controller);
        abortSignal = controller.signal;
      }

      log.info(`[AIService] streamText: Provider=${createOptions.providerType}, Model=${request.modelId}, tools=${JSON.stringify(request.tools)}`);
      log.info(`[AIService] streamText payload:`, { prompt, system, temperature, messages });

      const baseOptions = { model, system, temperature, abortSignal, tools: toSdkTools(request.tools) };

      // 根据是否有 messages 选择不同的调用方式
      const result = messages ? streamText({ ...baseOptions, messages }) : streamText({ ...baseOptions, prompt });

      return [undefined, { stream: result.fullStream }];
    } catch (error: unknown) {
      log.error('[AIService] streamText error:', error);

      return [this.aiProvider.normalizeError(error, createOptions.providerType)];
    }
  }
}

/** AI 服务单例 */
export const aiService = new AIService();
