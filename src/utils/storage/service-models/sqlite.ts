import type { ServiceModelConfig, ServiceModelConfigMap, ServiceModelType } from './types';
import { isTauri } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import localforage from 'localforage';
import { cloneDeep } from 'lodash-es';

const SETTINGS_DB_PATH = 'sqlite:texti.db';
const LEGACY_SERVICE_MODELS_KEY = 'service_model_configs';

const legacyServiceModelStorage = localforage.createInstance({
  name: 'Texti',
  storeName: 'service_models',
  description: 'Texti 服务模型配置存储'
});

const CREATE_SERVICE_MODELS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS service_models (
    service_type TEXT PRIMARY KEY,
    provider_id TEXT,
    model_id TEXT,
    custom_prompt TEXT,
    updated_at INTEGER NOT NULL
  )
`;

const SELECT_ALL_CONFIGS_SQL = 'SELECT service_type, provider_id, model_id, custom_prompt, updated_at FROM service_models';
const SELECT_ONE_CONFIG_SQL = `${SELECT_ALL_CONFIGS_SQL} WHERE service_type = ? LIMIT 1`;
const UPSERT_CONFIG_SQL = `
  INSERT OR REPLACE INTO service_models
    (service_type, provider_id, model_id, custom_prompt, updated_at)
  VALUES (?, ?, ?, ?, ?)
`;
const DELETE_CONFIG_SQL = 'DELETE FROM service_models WHERE service_type = ?';

interface ServiceModelRow {
  service_type: string;
  provider_id: string | null;
  model_id: string | null;
  custom_prompt: string | null;
  updated_at: number;
}

let dbInstance: Database | null = null;
let dbInitPromise: Promise<Database | null> | null = null;
let legacyMigrationPromise: Promise<void> | null = null;

function cloneConfig(config: ServiceModelConfig): ServiceModelConfig {
  return cloneDeep(config);
}

function cloneConfigMap(configs: ServiceModelConfigMap): ServiceModelConfigMap {
  return cloneDeep(configs);
}

function mapRowToConfig(row: ServiceModelRow): ServiceModelConfig {
  return {
    providerId: row.provider_id ?? undefined,
    modelId: row.model_id ?? undefined,
    customPrompt: row.custom_prompt ?? undefined,
    updatedAt: row.updated_at
  };
}

async function loadLegacyConfigs(): Promise<ServiceModelConfigMap> {
  const configs = await legacyServiceModelStorage.getItem<ServiceModelConfigMap>(LEGACY_SERVICE_MODELS_KEY);
  return cloneConfigMap(configs || {});
}

async function saveLegacyConfigs(configs: ServiceModelConfigMap): Promise<void> {
  await legacyServiceModelStorage.setItem(LEGACY_SERVICE_MODELS_KEY, cloneConfigMap(configs));
}

async function removeLegacyConfigs(): Promise<void> {
  await legacyServiceModelStorage.removeItem(LEGACY_SERVICE_MODELS_KEY);
}

async function migrateLegacyConfigsToDatabase(db: Database): Promise<void> {
  legacyMigrationPromise ??= (async () => {
    const legacyConfigs = await loadLegacyConfigs();
    const serviceTypes = Object.keys(legacyConfigs) as ServiceModelType[];

    if (!serviceTypes.length) {
      return;
    }

    const existingRows = await db.select<ServiceModelRow[]>(SELECT_ALL_CONFIGS_SQL);
    if (existingRows.length > 0) {
      await removeLegacyConfigs();
      return;
    }

    await Promise.all(
      serviceTypes.map(async (serviceType) => {
        const config = legacyConfigs[serviceType];
        if (!config) return;

        await db.execute(UPSERT_CONFIG_SQL, [serviceType, config.providerId ?? null, config.modelId ?? null, config.customPrompt ?? null, config.updatedAt]);
      })
    );

    await removeLegacyConfigs();
  })();

  try {
    await legacyMigrationPromise;
  } finally {
    legacyMigrationPromise = null;
  }
}

async function getDatabase(): Promise<Database | null> {
  if (!isTauri()) return null;
  if (dbInstance) return dbInstance;

  dbInitPromise ??= (async () => {
    try {
      const db = await Database.load(SETTINGS_DB_PATH);
      await db.execute(CREATE_SERVICE_MODELS_TABLE_SQL);
      await migrateLegacyConfigsToDatabase(db);
      dbInstance = db;
      return db;
    } catch (err) {
      dbInitPromise = null;
      console.error('[serviceModelsStorage] 数据库初始化失败:', err);
      return null;
    }
  })();

  return dbInitPromise;
}

export const serviceModelsStorage = {
  async getAllConfigs(): Promise<ServiceModelConfigMap> {
    const db = await getDatabase();
    if (!db) {
      return loadLegacyConfigs();
    }

    const rows = await db.select<ServiceModelRow[]>(SELECT_ALL_CONFIGS_SQL);
    return cloneConfigMap(
      rows.reduce<ServiceModelConfigMap>((configs, row) => {
        configs[row.service_type as ServiceModelType] = mapRowToConfig(row);
        return configs;
      }, {})
    );
  },

  async getConfig(serviceType: ServiceModelType): Promise<ServiceModelConfig | null> {
    const db = await getDatabase();
    if (!db) {
      const configs = await loadLegacyConfigs();
      const config = configs[serviceType];
      return config ? cloneConfig(config) : null;
    }

    const rows = await db.select<ServiceModelRow[]>(SELECT_ONE_CONFIG_SQL, [serviceType]);
    if (!rows[0]) return null;

    return cloneConfig(mapRowToConfig(rows[0]));
  },

  async saveConfig(serviceType: ServiceModelType, config: Omit<ServiceModelConfig, 'updatedAt'>): Promise<ServiceModelConfig> {
    const db = await getDatabase();
    const nextConfig: ServiceModelConfig = { ...config, updatedAt: Date.now() };

    if (db) {
      await db.execute(UPSERT_CONFIG_SQL, [
        serviceType,
        nextConfig.providerId ?? null,
        nextConfig.modelId ?? null,
        nextConfig.customPrompt ?? null,
        nextConfig.updatedAt
      ]);
    } else {
      const configs = await loadLegacyConfigs();
      configs[serviceType] = nextConfig;
      await saveLegacyConfigs(configs);
    }

    return cloneConfig(nextConfig);
  },

  async removeConfig(serviceType: ServiceModelType): Promise<void> {
    const db = await getDatabase();
    if (!db) {
      const configs = await loadLegacyConfigs();
      delete configs[serviceType];
      await saveLegacyConfigs(configs);
      return;
    }

    await db.execute(DELETE_CONFIG_SQL, [serviceType]);
  }
};
