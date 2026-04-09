import type { CustomProviderPayload, Provider, ProviderModel, ProviderRequestFormat, StoredProviderSettings } from './types';
import { cloneDeep, omitBy, isUndefined, pick, isBoolean, isString, isArray } from 'lodash-es';
import { getElectronAPI, hasElectronAPI } from '../../platform/electron-api';
import { DEFAULT_PROVIDERS } from './defaults';

// ─────────────────────────────────────────────
// 常量：SQL 语句
// ─────────────────────────────────────────────

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
// 数据库 IPC 访问层
// ─────────────────────────────────────────────

function isAvailable(): boolean {
  return hasElectronAPI();
}

async function dbSelect<T>(sql: string, params?: unknown[]): Promise<T[]> {
  if (!isAvailable()) return [];
  return getElectronAPI().dbSelect<T>(sql, params);
}

async function dbExecute(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid: number }> {
  if (!isAvailable()) return { changes: 0, lastInsertRowid: 0 };
  return getElectronAPI().dbExecute(sql, params);
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

function parseModelsJson(json: string | null): ProviderModel[] | undefined {
  if (!json) return undefined;

  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return undefined;
    return cloneModels(parsed as ProviderModel[]);
  } catch {
    return undefined;
  }
}

function stringifyModels(models?: ProviderModel[]): string | null {
  return models ? JSON.stringify(cloneModels(models)) : null;
}

// ─────────────────────────────────────────────
// 数据校验 & 映射
// ─────────────────────────────────────────────

function sanitizeProviderSettings(raw: Partial<StoredProviderSettings>): StoredProviderSettings {
  const result: StoredProviderSettings = {};

  if (isBoolean(raw.isEnabled)) result.isEnabled = raw.isEnabled;

  if (isString(raw.apiKey)) result.apiKey = raw.apiKey;

  if (isString(raw.baseUrl)) result.baseUrl = raw.baseUrl;

  if (isArray(raw.models)) result.models = raw.models;

  return result;
}

function mapRowToStoredSettings(row: ProviderSettingsRow): StoredProviderSettings {
  return sanitizeProviderSettings({
    isEnabled: Boolean(row.is_enabled),
    apiKey: row.api_key ?? undefined,
    baseUrl: row.base_url ?? undefined,
    models: parseModelsJson(row.models_json)
  });
}

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

function mergeProvider(base: Provider, stored?: StoredProviderSettings): Provider {
  const overrides = stored ? sanitizeProviderSettings(stored) : {};

  return {
    ...cloneProvider(base),
    ...omitBy(overrides, isUndefined),
    models: overrides.models ?? cloneModels(base.models ?? [])
  };
}

// ─────────────────────────────────────────────
// 内置服务商映射表（Map 加速 O(1) 查询）
// ─────────────────────────────────────────────

const DEFAULT_PROVIDERS_MAP = new Map(DEFAULT_PROVIDERS.map((p) => [p.id, p]));

function getDefaultProvider(id: string): Provider | undefined {
  return DEFAULT_PROVIDERS_MAP.get(id);
}

// ─────────────────────────────────────────────
// ID 规范化
// ─────────────────────────────────────────────

function sanitizeProviderId(id: string): string {
  return id.trim().toLowerCase();
}

// ─────────────────────────────────────────────
// 数据库 CRUD 底层操作
// ─────────────────────────────────────────────

async function loadAllStoredSettings(): Promise<Map<string, StoredProviderSettings>> {
  if (!isAvailable()) return new Map();

  const rows = await dbSelect<ProviderSettingsRow>(SELECT_ALL_SETTINGS_SQL);
  return new Map(rows.map((row) => [row.id, mapRowToStoredSettings(row)]));
}

async function loadStoredSetting(id: string): Promise<StoredProviderSettings | undefined> {
  if (!isAvailable()) return undefined;

  const rows = await dbSelect<ProviderSettingsRow>(SELECT_ONE_SETTING_SQL, [id]);
  return rows[0] ? mapRowToStoredSettings(rows[0]) : undefined;
}

async function persistSettings(id: string, settings: StoredProviderSettings): Promise<void> {
  await dbExecute(UPSERT_SETTINGS_SQL, [
    id,
    settings.isEnabled ? 1 : 0,
    settings.apiKey ?? null,
    settings.baseUrl ?? null,
    stringifyModels(settings.models),
    Date.now()
  ]);
}

async function loadAllCustomProviders(): Promise<Provider[]> {
  if (!isAvailable()) return [];

  const rows = await dbSelect<CustomProviderRow>(SELECT_ALL_CUSTOM_PROVIDERS_SQL);
  return rows
    .map(mapRowToCustomProvider)
    .filter((p): p is Provider => Boolean(p))
    .map(cloneProvider);
}

async function loadCustomProvider(id: string): Promise<Provider | null> {
  if (!isAvailable()) return null;

  const rows = await dbSelect<CustomProviderRow>(SELECT_ONE_CUSTOM_PROVIDER_SQL, [id]);
  if (!rows[0]) return null;

  const provider = mapRowToCustomProvider(rows[0]);
  return provider ? cloneProvider(provider) : null;
}

async function persistCustomProvider(provider: Provider, createdAt?: number): Promise<void> {
  const now = Date.now();

  await dbExecute(UPSERT_CUSTOM_PROVIDER_SQL, [
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
  async listProviders(): Promise<Provider[]> {
    const [stored, customProviders] = await Promise.all([loadAllStoredSettings(), loadAllCustomProviders()]);

    const defaults = DEFAULT_PROVIDERS.map((p) => mergeProvider(p, stored.get(p.id)));
    return [...defaults, ...customProviders];
  },

  async getProvider(id: string): Promise<Provider | null> {
    const normalizedId = sanitizeProviderId(id);
    const base = getDefaultProvider(normalizedId);

    if (base) {
      const stored = await loadStoredSetting(normalizedId);
      return mergeProvider(base, stored);
    }

    return loadCustomProvider(normalizedId);
  },

  async createOrUpdateCustomProvider(payload: CustomProviderPayload): Promise<Provider | null> {
    if (!isAvailable()) return null;

    const normalized = normalizeCustomProviderPayload(payload);
    const { id } = normalized;

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
      models: cloneModels(current?.models ?? []),
      isCustom: true,
      readonly: false
    };

    await persistCustomProvider(nextProvider);
    return cloneProvider(nextProvider);
  },

  async updateProvider(id: string, patch: StoredProviderSettings): Promise<Provider | null> {
    const normalizedId = sanitizeProviderId(id);
    if (!isAvailable()) return null;

    const base = getDefaultProvider(normalizedId);

    if (base) {
      const current = (await loadStoredSetting(normalizedId)) ?? {};
      const next = sanitizeProviderSettings({ ...current, ...patch });

      await persistSettings(normalizedId, next);
      return mergeProvider(base, next);
    }

    const currentCustom = await loadCustomProvider(normalizedId);
    if (!currentCustom) return null;

    const nextCustom: Provider = {
      ...currentCustom,
      ...sanitizeProviderSettings({ ...currentCustom, ...patch }),
      id: currentCustom.id,
      name: currentCustom.name,
      description: currentCustom.description,
      type: currentCustom.type,
      logo: currentCustom.logo,
      isCustom: true,
      readonly: false,
      models: patch.models ? cloneModels(patch.models) : cloneModels(currentCustom.models ?? [])
    };

    await persistCustomProvider(nextCustom);
    return cloneProvider(nextCustom);
  },

  async toggleProvider(id: string, enabled: boolean): Promise<Provider | null> {
    return this.updateProvider(id, { isEnabled: enabled });
  },

  async saveProviderConfig(id: string, config: Pick<StoredProviderSettings, 'apiKey' | 'baseUrl'>): Promise<Provider | null> {
    return this.updateProvider(id, config);
  },

  async saveProviderModels(id: string, models: ProviderModel[]): Promise<Provider | null> {
    return this.updateProvider(id, { models: cloneModels(models) });
  },

  async deleteCustomProvider(id: string): Promise<boolean> {
    const normalizedId = sanitizeProviderId(id);
    if (!isAvailable()) return false;

    const provider = await loadCustomProvider(normalizedId);
    if (!provider || !provider.isCustom) return false;

    await dbExecute('DELETE FROM custom_providers WHERE id = ?', [normalizedId]);
    return true;
  }
};
