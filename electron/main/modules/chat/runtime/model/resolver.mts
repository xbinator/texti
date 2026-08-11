/**
 * @file chat-model-resolver.mts
 * @description ChatRuntime chat 模型配置解析器。
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AICreateOptions, AIProvider, AIProviderType } from 'types/ai';
import type { ChatRuntimeModelSelection } from 'types/chat-runtime';
import { dbSelect } from '../../../database/service.mjs';
import { ensureTibisWorkspaceRoot } from '../../../workspace/root.mjs';

/** settings.json 中的 provider 条目形状。 */
export interface StoredChatProviderEntry {
  /** Provider id。 */
  id: string;
  /** 是否启用。 */
  isEnabled?: boolean;
  /** API key。 */
  apiKey?: string;
  /** Base URL。 */
  baseUrl?: string;
  /** Provider 名称。 */
  name?: string;
  /** Provider 描述。 */
  description?: string;
  /** 请求格式类型。 */
  type?: AIProviderType;
  /** 模型列表。 */
  models?: AIProvider['models'];
}

/** service_models 行结构。 */
interface ChatServiceModelRow {
  /** Provider id。 */
  provider_id: string | null;
  /** Model id。 */
  model_id: string | null;
}

/** settings.json 形状。 */
interface ChatSettingsFile {
  /** Provider 条目。 */
  providers?: StoredChatProviderEntry[];
}

/** 查询聊天模型配置 SQL。 */
const SELECT_CHAT_MODEL_SQL = "SELECT provider_id, model_id FROM service_models WHERE service_type = 'chat' LIMIT 1";

/** settings 文件名。 */
const SETTINGS_FILE_NAME = 'settings.json';

/** 聊天服务模型配置。 */
export interface ChatModelConfig {
  /** Provider id。 */
  providerId?: string;
  /** Model id。 */
  modelId?: string;
}

/** chat 模型解析结果。 */
export interface ChatModelResolution {
  /** AI 服务创建参数。 */
  createOptions: AICreateOptions;
  /** 模型 ID。 */
  modelId: string;
  /** Provider 模型配置的单次最大输出 Token 数。 */
  maxOutputTokens?: number;
}

/** chat 模型解析依赖。 */
export interface ChatModelResolverDependencies {
  /**
   * 读取当前聊天模型配置。
   * @returns 聊天模型配置
   */
  getChatModelConfig: () => Promise<ChatModelConfig | null>;
  /**
   * 读取 provider 配置。
   * @param providerId - provider id
   * @returns provider 配置
   */
  getProvider: (providerId: string) => Promise<AIProvider | null>;
}

/**
 * 读取主进程聊天模型配置。
 * @returns 聊天模型配置
 */
async function getDefaultChatModelConfig(): Promise<ChatModelConfig | null> {
  const rows = dbSelect<ChatServiceModelRow>(SELECT_CHAT_MODEL_SQL);
  const row = rows[0];
  if (!row) return null;

  return {
    providerId: row.provider_id ?? undefined,
    modelId: row.model_id ?? undefined
  };
}

/**
 * 读取 settings.json。
 * @returns settings 文件内容
 */
async function readChatSettingsFile(): Promise<ChatSettingsFile> {
  try {
    const root = await ensureTibisWorkspaceRoot();
    const content = await fs.readFile(path.join(root.rootPath, SETTINGS_FILE_NAME), 'utf8');
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};

    const source = parsed as ChatSettingsFile;
    return {
      providers: Array.isArray(source.providers) ? source.providers : []
    };
  } catch {
    return {};
  }
}

/** chat 模型解析器。 */
export interface ChatModelResolver {
  /**
   * 解析 chat 模型调用配置。
   * @param model - 可选的 Runtime 显式模型；缺失时读取全局默认模型
   * @returns chat 模型配置，不可用时返回 null
   */
  resolve(model?: ChatRuntimeModelSelection): Promise<ChatModelResolution | null>;
}

/**
 * 判断 provider 模型是否可用。
 * @param provider - provider 配置
 * @param modelId - 模型 ID
 * @returns 模型是否可用
 */
function hasEnabledModel(provider: AIProvider, modelId: string): boolean {
  if (!provider.models) return true;

  return Boolean(provider.models?.some((model) => model.id === modelId && model.isEnabled && !model.isDelete));
}

/**
 * 读取已启用模型配置中的有效输出 Token 上限。
 * @param provider - provider 配置
 * @param modelId - 模型 ID
 * @returns 正整数上限；未配置或无效时返回 undefined
 */
function getMaxOutputTokens(provider: AIProvider, modelId: string): number | undefined {
  const value = provider.models?.find((model) => model.id === modelId && model.isEnabled && !model.isDelete)?.maxOutputTokens;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

/**
 * 读取主进程 provider 配置。
 * @param providerId - provider id
 * @returns provider 配置
 */
async function getDefaultProvider(providerId: string): Promise<AIProvider | null> {
  const settings = await readChatSettingsFile();
  const normalizedId = providerId.trim().toLowerCase();
  const entry = settings.providers?.find((provider) => provider.id.trim().toLowerCase() === normalizedId);

  return (entry as AIProvider) ?? null;
}

/**
 * 创建 chat 模型解析器。
 * @param dependencies - 解析依赖
 * @returns chat 模型解析器
 */
export function createChatModelResolver(dependencies: ChatModelResolverDependencies): ChatModelResolver {
  return {
    async resolve(model?: ChatRuntimeModelSelection): Promise<ChatModelResolution | null> {
      const config = model ?? (await dependencies.getChatModelConfig());
      if (!config?.providerId || !config.modelId) return null;

      const provider = await dependencies.getProvider(config.providerId);
      if (!provider?.isEnabled || !hasEnabledModel(provider, config.modelId)) return null;

      const maxOutputTokens = getMaxOutputTokens(provider, config.modelId);
      return {
        createOptions: {
          providerId: provider.id,
          providerName: provider.name,
          apiKey: provider.apiKey ?? '',
          baseUrl: provider.baseUrl ?? '',
          providerType: provider.type
        },
        modelId: config.modelId,
        ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {})
      };
    }
  };
}

/**
 * 创建默认 chat 模型解析器。
 * @returns chat 模型解析器
 */
export function createDefaultChatModelResolver(): ChatModelResolver {
  return createChatModelResolver({
    getChatModelConfig: getDefaultChatModelConfig,
    getProvider: getDefaultProvider
  });
}
