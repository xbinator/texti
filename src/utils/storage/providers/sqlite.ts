import type { CustomProviderPayload, Provider, ProviderModel, ProviderRequestFormat, StoredProviderSettings } from './types';
import { isTauri } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import { cloneDeep, omitBy, isUndefined, pick, isBoolean, isString, isArray } from 'lodash-es';
import { DEFAULT_PROVIDERS } from './defaults';

// ─────────────────────────────────────────────
// 常量：数据库路径 & SQL 语句
// ─────────────────────────────────────────────

/** SQLite 数据库文件路径（Tauri 应用数据目录） */
const SETTINGS_DB_PATH = 'sqlite:texti.db';

/** 内置服务商覆盖配置表 DDL */
const CREATE_PROVIDER_SETTINGS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS provider_settings (
    id          TEXT    PRIMARY KEY,
    is_enabled  INTEGER NOT NULL,
    api_key     TEXT,
    base_url    TEXT,
    models_json TEXT,
    updated_at  INTEGER NOT NULL
  )
`;

/** 自定义服务商表 DDL */
const CREATE_CUSTOM_PROVIDERS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS custom_providers (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL,
    type        TEXT    NOT NULL,
    logo        TEXT,
    is_enabled  INTEGER NOT NULL,
    api_key     TEXT,
    base_url    TEXT,
    models_json TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  )
`;

const SELECT_ALL_SETTINGS_SQL = 'SELECT id, is_enabled, api_key, base_url, models_json FROM provider_settings';
const SELECT_ONE_SETTING_SQL = `${SELECT_ALL_SETTINGS_SQL} WHERE id = ? LIMIT 1`;
const UPSERT_SETTINGS_SQL = `
  INSERT OR REPLACE INTO provider_settings
    (id, is_enabled, api_key, base_url, models_json, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
`;

const SELECT_ALL_CUSTOM_PROVIDERS_SQL = 'SELECT id, name, description, type, logo, is_enabled, api_key, base_url, models_json FROM custom_providers';
const SELECT_ONE_CUSTOM_PROVIDER_SQL = `${SELECT_ALL_CUSTOM_PROVIDERS_SQL} WHERE id = ? LIMIT 1`;
const UPSERT_CUSTOM_PROVIDER_SQL = `
  INSERT OR REPLACE INTO custom_providers
    (id, name, description, type, logo, is_enabled, api_key, base_url, models_json, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/** 所有合法的请求格式枚举值 */
const REQUEST_FORMATS: ProviderRequestFormat[] = ['openai', 'anthropic', 'google'];

// ─────────────────────────────────────────────
// 数据库行类型
// ─────────────────────────────────────────────

interface ProviderSettingsRow {
  id: string;
  is_enabled: number;
  api_key: string | null;
  base_url: string | null;
  models_json: string | null;
}

interface CustomProviderRow {
  id: string;
  name: string;
  description: string;
  type: string;
  logo: string | null;
  is_enabled: number;
  api_key: string | null;
  base_url: string | null;
  models_json: string | null;
}

// ─────────────────────────────────────────────
// 数据库单例管理
// ─────────────────────────────────────────────

/** 已初始化的数据库实例（懒加载单例） */
let dbInstance: Database | null = null;

/** 防止并发初始化的 Promise 锁 */
let dbInitPromise: Promise<Database | null> | null = null;

/**
 * 获取数据库实例（懒加载 + 单例）
 * - 非 Tauri 环境直接返回 null，调用方需做降级处理
 * - 首次调用时执行建表，后续调用直接复用已有实例
 */
async function getDatabase(): Promise<Database | null> {
  if (!isTauri()) return null;
  if (dbInstance) return dbInstance;

  // 使用 ??= 保证并发调用时只初始化一次
  dbInitPromise ??= (async () => {
    try {
      const db = await Database.load(SETTINGS_DB_PATH);
      await db.execute(CREATE_PROVIDER_SETTINGS_TABLE_SQL);
      await db.execute(CREATE_CUSTOM_PROVIDERS_TABLE_SQL);
      dbInstance = db;
      return db;
    } catch (err) {
      // 初始化失败时重置 Promise 锁，允许下次重试
      dbInitPromise = null;
      console.error('[providerStorage] 数据库初始化失败:', err);
      return null;
    }
  })();

  return dbInitPromise;
}

// ─────────────────────────────────────────────
// 克隆工具（使用 lodash-es cloneDeep 保证深拷贝）
// ─────────────────────────────────────────────

/** 深克隆模型列表，防止外部修改污染内部状态 */
function cloneModels(models: ProviderModel[]): ProviderModel[] {
  return cloneDeep(models);
}

/** 深克隆服务商对象 */
function cloneProvider(provider: Provider): Provider {
  return cloneDeep(provider);
}

// ─────────────────────────────────────────────
// 类型守卫
// ─────────────────────────────────────────────

/** 判断一个值是否为合法的请求格式标识符 */
function isProviderRequestFormat(value: unknown): value is ProviderRequestFormat {
  return typeof value === 'string' && REQUEST_FORMATS.includes(value as ProviderRequestFormat);
}

// ─────────────────────────────────────────────
// JSON 序列化 / 反序列化
// ─────────────────────────────────────────────

/**
 * 将数据库中存储的 models_json 字符串解析为 ProviderModel 数组
 * 解析失败或字段为空时返回 undefined
 */
function parseModelsJson(json: string | null): ProviderModel[] | undefined {
  if (!json) return undefined;

  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return undefined;
    // 过滤掉不合法的模型条目
    return cloneModels(parsed as ProviderModel[]);
  } catch {
    return undefined;
  }
}

/**
 * 将 ProviderModel 数组序列化为 JSON 字符串用于数据库存储
 * models 为空时返回 null（对应数据库 NULL）
 */
function stringifyModels(models?: ProviderModel[]): string | null {
  return models ? JSON.stringify(cloneModels(models)) : null;
}

// ─────────────────────────────────────────────
// 数据校验 & 映射
// ─────────────────────────────────────────────

/**
 * 对外部传入的 StoredProviderSettings 做白名单过滤
 * 只保留类型合法的字段，防止脏数据写入数据库
 */
function sanitizeProviderSettings(raw: Partial<StoredProviderSettings>): StoredProviderSettings {
  const result: StoredProviderSettings = {};

  if (isBoolean(raw.isEnabled)) result.isEnabled = raw.isEnabled;

  if (isString(raw.apiKey)) result.apiKey = raw.apiKey;

  if (isString(raw.baseUrl)) result.baseUrl = raw.baseUrl;

  if (isArray(raw.models)) result.models = raw.models;

  return result;
}

/** 将数据库行（snake_case）映射为业务对象（camelCase） */
function mapRowToStoredSettings(row: ProviderSettingsRow): StoredProviderSettings {
  return sanitizeProviderSettings({
    isEnabled: Boolean(row.is_enabled),
    apiKey: row.api_key ?? undefined,
    baseUrl: row.base_url ?? undefined,
    models: parseModelsJson(row.models_json)
  });
}

/**
 * 将自定义服务商数据库行映射为 Provider 对象
 * 若 type 字段不合法则返回 null，调用方需过滤
 */
function mapRowToCustomProvider(row: CustomProviderRow): Provider | null {
  if (!isProviderRequestFormat(row.type)) return null;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    logo: row.logo ?? undefined,
    isEnabled: Boolean(row.is_enabled),
    apiKey: row.api_key ?? undefined,
    baseUrl: row.base_url ?? undefined,
    models: parseModelsJson(row.models_json) ?? [],
    isCustom: true,
    readonly: false
  };
}

// ─────────────────────────────────────────────
// 合并逻辑
// ─────────────────────────────────────────────

/**
 * 将数据库中的覆盖配置合并到内置服务商默认值上
 * 以 stored 中的字段为高优先级，models 若无覆盖则沿用默认值
 */
function mergeProvider(base: Provider, stored?: StoredProviderSettings): Provider {
  const overrides = stored ? sanitizeProviderSettings(stored) : {};

  return {
    ...cloneProvider(base),
    // 使用 lodash-es omitBy 去掉 undefined 字段，避免覆盖默认值
    ...omitBy(overrides, isUndefined),
    models: overrides.models ?? cloneModels(base.models ?? [])
  };
}

// ─────────────────────────────────────────────
// 内置服务商映射表（Map 加速 O(1) 查询）
// ─────────────────────────────────────────────

/** 以 id 为 key 的内置服务商 Map，避免每次 find 遍历 */
const DEFAULT_PROVIDERS_MAP = new Map(DEFAULT_PROVIDERS.map((p) => [p.id, p]));

/** 根据 id 查找内置服务商，未找到返回 undefined */
function getDefaultProvider(id: string): Provider | undefined {
  return DEFAULT_PROVIDERS_MAP.get(id);
}

// ─────────────────────────────────────────────
// ID 规范化
// ─────────────────────────────────────────────

/** 统一将服务商 id 转为小写并去除首尾空格，防止大小写歧义 */
function sanitizeProviderId(id: string): string {
  return id.trim().toLowerCase();
}

// ─────────────────────────────────────────────
// 数据库 CRUD 底层操作
// ─────────────────────────────────────────────

/** 读取所有内置服务商的覆盖配置，以 Map<id, settings> 返回 */
async function loadAllStoredSettings(): Promise<Map<string, StoredProviderSettings>> {
  const db = await getDatabase();
  if (!db) return new Map();

  const rows = await db.select<ProviderSettingsRow[]>(SELECT_ALL_SETTINGS_SQL);
  return new Map(rows.map((row) => [row.id, mapRowToStoredSettings(row)]));
}

/** 读取单个内置服务商的覆盖配置，不存在时返回 undefined */
async function loadStoredSetting(id: string): Promise<StoredProviderSettings | undefined> {
  const db = await getDatabase();
  if (!db) return undefined;

  const rows = await db.select<ProviderSettingsRow[]>(SELECT_ONE_SETTING_SQL, [id]);
  return rows[0] ? mapRowToStoredSettings(rows[0]) : undefined;
}

/** 持久化内置服务商覆盖配置（INSERT OR REPLACE） */
async function persistSettings(db: Database, id: string, settings: StoredProviderSettings): Promise<void> {
  await db.execute(UPSERT_SETTINGS_SQL, [
    id,
    settings.isEnabled ? 1 : 0,
    settings.apiKey ?? null,
    settings.baseUrl ?? null,
    stringifyModels(settings.models),
    Date.now()
  ]);
}

/** 读取所有自定义服务商，过滤掉 type 非法的行 */
async function loadAllCustomProviders(): Promise<Provider[]> {
  const db = await getDatabase();
  if (!db) return [];

  const rows = await db.select<CustomProviderRow[]>(SELECT_ALL_CUSTOM_PROVIDERS_SQL);
  return rows
    .map(mapRowToCustomProvider)
    .filter((p): p is Provider => Boolean(p))
    .map(cloneProvider);
}

/** 读取单个自定义服务商，不存在或 type 非法时返回 null */
async function loadCustomProvider(id: string): Promise<Provider | null> {
  const db = await getDatabase();
  if (!db) return null;

  const rows = await db.select<CustomProviderRow[]>(SELECT_ONE_CUSTOM_PROVIDER_SQL, [id]);
  if (!rows[0]) return null;

  const provider = mapRowToCustomProvider(rows[0]);
  return provider ? cloneProvider(provider) : null;
}

/**
 * 持久化自定义服务商（INSERT OR REPLACE）
 * @param createdAt 可选，首次创建时传入；更新时不传，保留原始创建时间
 */
async function persistCustomProvider(db: Database, provider: Provider, createdAt?: number): Promise<void> {
  const now = Date.now();

  await db.execute(UPSERT_CUSTOM_PROVIDER_SQL, [
    provider.id,
    provider.name,
    provider.description,
    provider.type,
    provider.logo ?? null,
    provider.isEnabled ? 1 : 0,
    provider.apiKey ?? null,
    provider.baseUrl ?? null,
    stringifyModels(provider.models),
    createdAt ?? now,
    now
  ]);
}

// ─────────────────────────────────────────────
// 自定义服务商 Payload 规范化
// ─────────────────────────────────────────────

/**
 * 对用户传入的 CustomProviderPayload 做字段规范化
 * 使用 pick 只保留已知字段，防止多余属性污染
 */
function normalizeCustomProviderPayload(payload: CustomProviderPayload): CustomProviderPayload {
  return {
    ...pick(payload, ['id', 'name', 'description', 'type', 'logo', 'isEnabled', 'apiKey', 'baseUrl']),
    id: sanitizeProviderId(payload.id),
    name: payload.name.trim(),
    description: payload.description?.trim(),
    logo: payload.logo?.trim()
  };
}

// ─────────────────────────────────────────────
// 对外暴露的存储层接口
// ─────────────────────────────────────────────

export const providerStorage = {
  /**
   * 获取所有服务商列表（内置 + 自定义）
   * 内置服务商会与数据库中的覆盖配置合并后返回
   */
  async listProviders(): Promise<Provider[]> {
    const [stored, customProviders] = await Promise.all([loadAllStoredSettings(), loadAllCustomProviders()]);

    const defaults = DEFAULT_PROVIDERS.map((p) => mergeProvider(p, stored.get(p.id)));
    return [...defaults, ...customProviders];
  },

  /**
   * 获取单个服务商详情
   * - 内置服务商：基础默认值 + 数据库覆盖配置合并
   * - 自定义服务商：直接从 custom_providers 表读取
   * @returns 找不到时返回 null
   */
  async getProvider(id: string): Promise<Provider | null> {
    const normalizedId = sanitizeProviderId(id);
    const base = getDefaultProvider(normalizedId);

    if (base) {
      const stored = await loadStoredSetting(normalizedId);
      return mergeProvider(base, stored);
    }

    return loadCustomProvider(normalizedId);
  },

  /**
   * 创建或更新自定义服务商
   * - id 与内置服务商冲突时拒绝写入（返回 null）
   * - 已存在时更新，不存在时新建；模型列表保留已有数据不被清空
   * @returns 写入成功后返回最新的 Provider 对象，失败返回 null
   */
  async createOrUpdateCustomProvider(payload: CustomProviderPayload): Promise<Provider | null> {
    const db = await getDatabase();
    if (!db) return null;

    const normalized = normalizeCustomProviderPayload(payload);
    const { id } = normalized;

    // 前置校验：id、name、type 必填，且 id 不得与内置服务商重复
    if (!id || !normalized.name || !isProviderRequestFormat(normalized.type) || getDefaultProvider(id)) {
      return null;
    }

    const current = await loadCustomProvider(id);

    const nextProvider: Provider = {
      id,
      name: normalized.name,
      description: normalized.description || current?.description || '自定义服务商',
      type: normalized.type,
      logo: normalized.logo || undefined,
      isEnabled: normalized.isEnabled ?? current?.isEnabled ?? true,
      apiKey: normalized.apiKey ?? current?.apiKey,
      baseUrl: normalized.baseUrl ?? current?.baseUrl,
      // 更新时保留已有模型列表，不会因 payload 未携带 models 而被清空
      models: cloneModels(current?.models ?? []),
      isCustom: true,
      readonly: false
    };

    await persistCustomProvider(db, nextProvider);
    return cloneProvider(nextProvider);
  },

  /**
   * 更新服务商的部分配置字段（patch 模式）
   * - 内置服务商：只写差量到 provider_settings 表
   * - 自定义服务商：整体更新 custom_providers 表
   * @returns 更新后的 Provider 对象，服务商不存在时返回 null
   */
  async updateProvider(id: string, patch: StoredProviderSettings): Promise<Provider | null> {
    const normalizedId = sanitizeProviderId(id);
    const db = await getDatabase();
    if (!db) return null;

    const base = getDefaultProvider(normalizedId);

    if (base) {
      // 内置服务商：读取现有配置 → 合并 patch → 写回
      const current = (await loadStoredSetting(normalizedId)) ?? {};
      const next = sanitizeProviderSettings({ ...current, ...patch });
      console.log('🚀 ~ updateProvider ~ next:', next);

      await persistSettings(db, normalizedId, next);
      return mergeProvider(base, next);
    }

    // 自定义服务商：先读取完整记录再做字段级 patch
    const currentCustom = await loadCustomProvider(normalizedId);
    if (!currentCustom) return null;

    const nextCustom: Provider = {
      ...currentCustom,
      ...sanitizeProviderSettings({ ...currentCustom, ...patch }),
      // 以下字段不允许通过 patch 修改，始终保持原值
      id: currentCustom.id,
      name: currentCustom.name,
      description: currentCustom.description,
      type: currentCustom.type,
      logo: currentCustom.logo,
      isCustom: true,
      readonly: false,
      // models 有显式 patch 时才替换，否则保留原列表
      models: patch.models ? cloneModels(patch.models) : cloneModels(currentCustom.models ?? [])
    };

    await persistCustomProvider(db, nextCustom);
    return cloneProvider(nextCustom);
  },

  /**
   * 切换服务商的启用 / 禁用状态
   * @param enabled true = 启用，false = 禁用
   */
  async toggleProvider(id: string, enabled: boolean): Promise<Provider | null> {
    return this.updateProvider(id, { isEnabled: enabled });
  },

  /**
   * 保存服务商的认证配置（API Key 和 Base URL）
   * 只更新这两个字段，不影响其他配置
   */
  async saveProviderConfig(id: string, config: Pick<StoredProviderSettings, 'apiKey' | 'baseUrl'>): Promise<Provider | null> {
    return this.updateProvider(id, config);
  },

  /**
   * 保存服务商的模型列表
   * 会完整替换该服务商的 models 字段
   */
  async saveProviderModels(id: string, models: ProviderModel[]): Promise<Provider | null> {
    return this.updateProvider(id, { models: cloneModels(models) });
  },

  /**
   * 删除自定义服务商
   * @param id 服务商 ID
   * @returns 删除成功返回 true，失败返回 false
   */
  async deleteCustomProvider(id: string): Promise<boolean> {
    const normalizedId = sanitizeProviderId(id);
    const db = await getDatabase();
    if (!db) return false;

    // 检查是否为自定义服务商
    const provider = await loadCustomProvider(normalizedId);
    if (!provider || !provider.isCustom) return false;

    await db.execute('DELETE FROM custom_providers WHERE id = ?', [normalizedId]);
    return true;
  }
};
