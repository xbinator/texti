/**
 * 服务商存储的 SQLite 实现
 * 用于在 Tauri 环境中持久化服务商配置
 */
import type { CustomProviderPayload, Provider, ProviderModel, ProviderRequestFormat, StoredProviderSettings } from './types';
import { isTauri } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import { DEFAULT_PROVIDERS } from './defaults';

const SETTINGS_DB_PATH = 'sqlite:texti.db';

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

const REQUEST_FORMATS: ProviderRequestFormat[] = ['openai', 'anthropic', 'google'];

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

let dbInstance: Database | null = null;
let dbInitPromise: Promise<Database | null> | null = null;

async function getDatabase(): Promise<Database | null> {
  if (!isTauri()) return null;
  if (dbInstance) return dbInstance;

  dbInitPromise ??= (async () => {
    try {
      const db = await Database.load(SETTINGS_DB_PATH);
      await db.execute(CREATE_PROVIDER_SETTINGS_TABLE_SQL);
      await db.execute(CREATE_CUSTOM_PROVIDERS_TABLE_SQL);
      dbInstance = db;
      return db;
    } catch (err) {
      dbInitPromise = null;
      console.error('[providerStorage] 数据库初始化失败:', err);
      return null;
    }
  })();

  return dbInitPromise;
}

function cloneModel(model: ProviderModel): ProviderModel {
  return { ...model, tags: model.tags ? [...model.tags] : [] };
}

function cloneModels(models: ProviderModel[]): ProviderModel[] {
  return models.map(cloneModel);
}

function cloneProvider(provider: Provider): Provider {
  return { ...provider, models: cloneModels(provider.models ?? []) };
}

function isProviderModel(value: unknown): value is ProviderModel {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.description === 'string' &&
    typeof candidate.isEnabled === 'boolean' &&
    (candidate.tags === undefined || (Array.isArray(candidate.tags) && candidate.tags.every((tag) => typeof tag === 'string')))
  );
}

function isProviderRequestFormat(value: unknown): value is ProviderRequestFormat {
  return typeof value === 'string' && REQUEST_FORMATS.includes(value as ProviderRequestFormat);
}

function parseModelsJson(json: string | null): ProviderModel[] | undefined {
  if (!json) return undefined;

  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return undefined;
    return cloneModels(parsed.filter(isProviderModel));
  } catch {
    return undefined;
  }
}

function stringifyModels(models?: ProviderModel[]): string | null {
  return models ? JSON.stringify(cloneModels(models)) : null;
}

function sanitizeProviderSettings(raw: Partial<StoredProviderSettings>): StoredProviderSettings {
  const result: StoredProviderSettings = {};

  if (typeof raw.isEnabled === 'boolean') result.isEnabled = raw.isEnabled;
  if (typeof raw.apiKey === 'string') result.apiKey = raw.apiKey;
  if (typeof raw.baseUrl === 'string') result.baseUrl = raw.baseUrl;
  if (Array.isArray(raw.models)) result.models = cloneModels(raw.models.filter(isProviderModel));

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
  if (!isProviderRequestFormat(row.type)) {
    return null;
  }

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

function mergeProvider(base: Provider, stored?: StoredProviderSettings): Provider {
  const overrides = stored ? sanitizeProviderSettings(stored) : {};

  return {
    ...cloneProvider(base),
    ...overrides,
    models: overrides.models ?? cloneModels(base.models ?? [])
  };
}

const DEFAULT_PROVIDERS_MAP = new Map(DEFAULT_PROVIDERS.map((provider) => [provider.id, provider]));

function getDefaultProvider(id: string): Provider | undefined {
  return DEFAULT_PROVIDERS_MAP.get(id);
}

function sanitizeProviderId(id: string): string {
  return id.trim().toLowerCase();
}

async function loadAllStoredSettings(): Promise<Map<string, StoredProviderSettings>> {
  const db = await getDatabase();
  if (!db) return new Map();

  const rows = await db.select<ProviderSettingsRow[]>(SELECT_ALL_SETTINGS_SQL);
  return new Map(rows.map((row) => [row.id, mapRowToStoredSettings(row)]));
}

async function loadStoredSetting(id: string): Promise<StoredProviderSettings | undefined> {
  const db = await getDatabase();
  if (!db) return undefined;

  const rows = await db.select<ProviderSettingsRow[]>(SELECT_ONE_SETTING_SQL, [id]);
  return rows[0] ? mapRowToStoredSettings(rows[0]) : undefined;
}

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

async function loadAllCustomProviders(): Promise<Provider[]> {
  const db = await getDatabase();
  if (!db) return [];

  const rows = await db.select<CustomProviderRow[]>(SELECT_ALL_CUSTOM_PROVIDERS_SQL);
  return rows
    .map(mapRowToCustomProvider)
    .filter((provider): provider is Provider => Boolean(provider))
    .map(cloneProvider);
}

async function loadCustomProvider(id: string): Promise<Provider | null> {
  const db = await getDatabase();
  if (!db) return null;

  const rows = await db.select<CustomProviderRow[]>(SELECT_ONE_CUSTOM_PROVIDER_SQL, [id]);
  if (!rows[0]) return null;

  const provider = mapRowToCustomProvider(rows[0]);
  return provider ? cloneProvider(provider) : null;
}

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

function normalizeCustomProviderPayload(payload: CustomProviderPayload): CustomProviderPayload {
  return {
    id: sanitizeProviderId(payload.id),
    name: payload.name.trim(),
    description: payload.description?.trim(),
    type: payload.type,
    logo: payload.logo?.trim(),
    isEnabled: payload.isEnabled,
    apiKey: payload.apiKey,
    baseUrl: payload.baseUrl
  };
}

export const providerStorage = {
  async listProviders(): Promise<Provider[]> {
    const [stored, customProviders] = await Promise.all([loadAllStoredSettings(), loadAllCustomProviders()]);

    const defaults = DEFAULT_PROVIDERS.map((provider) => mergeProvider(provider, stored.get(provider.id)));
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
    const db = await getDatabase();
    if (!db) return null;

    const normalizedPayload = normalizeCustomProviderPayload(payload);
    const { id } = normalizedPayload;

    if (!id || !normalizedPayload.name || !isProviderRequestFormat(normalizedPayload.type) || getDefaultProvider(id)) {
      return null;
    }

    const current = await loadCustomProvider(id);
    const nextProvider: Provider = {
      id,
      name: normalizedPayload.name,
      description: normalizedPayload.description || current?.description || '自定义服务商',
      type: normalizedPayload.type,
      logo: normalizedPayload.logo || undefined,
      isEnabled: normalizedPayload.isEnabled ?? current?.isEnabled ?? true,
      apiKey: normalizedPayload.apiKey ?? current?.apiKey,
      baseUrl: normalizedPayload.baseUrl ?? current?.baseUrl,
      models: cloneModels(current?.models ?? []),
      isCustom: true,
      readonly: false
    };

    await persistCustomProvider(db, nextProvider);
    return cloneProvider(nextProvider);
  },

  async updateProvider(id: string, patch: StoredProviderSettings): Promise<Provider | null> {
    const normalizedId = sanitizeProviderId(id);
    const db = await getDatabase();
    if (!db) return null;

    const base = getDefaultProvider(normalizedId);

    if (base) {
      const current = (await loadStoredSetting(normalizedId)) ?? {};
      const next = sanitizeProviderSettings({ ...current, ...patch });

      await persistSettings(db, normalizedId, next);
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

    await persistCustomProvider(db, nextCustom);
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
  }
};
