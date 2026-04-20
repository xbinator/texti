import type { ServiceModelConfig, ServiceModelConfigMap, ServiceModelType } from 'types/model';
import localforage from 'localforage';
import { cloneDeep } from 'lodash-es';
import { dbSelect, dbExecute, isDatabaseAvailable } from '../utils';

const LEGACY_SERVICE_MODELS_KEY = 'service_model_configs';

const legacyServiceModelStorage = localforage.createInstance({
  name: 'Tibis',
  storeName: 'service_models',
  description: 'Tibis 服务模型配置存储'
});

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

let legacyMigrationDone = false;

async function migrateLegacyConfigsToDatabase(): Promise<void> {
  if (legacyMigrationDone) return;
  if (!isDatabaseAvailable()) return;

  const legacyConfigs = await loadLegacyConfigs();
  const serviceTypes = Object.keys(legacyConfigs) as ServiceModelType[];

  if (!serviceTypes.length) {
    return;
  }

  const existingRows = await dbSelect<ServiceModelRow>(SELECT_ALL_CONFIGS_SQL);
  if (existingRows.length > 0) {
    await removeLegacyConfigs();
    legacyMigrationDone = true;
    return;
  }

  await Promise.all(
    serviceTypes.map(async (serviceType) => {
      const config = legacyConfigs[serviceType];
      if (!config) return;

      await dbExecute(UPSERT_CONFIG_SQL, [serviceType, config.providerId ?? null, config.modelId ?? null, config.customPrompt ?? null, config.updatedAt]);
    })
  );

  await removeLegacyConfigs();
  legacyMigrationDone = true;
}

export const serviceModelsStorage = {
  async getAllConfigs(): Promise<ServiceModelConfigMap> {
    if (!isDatabaseAvailable()) {
      return loadLegacyConfigs();
    }

    await migrateLegacyConfigsToDatabase();

    const rows = await dbSelect<ServiceModelRow>(SELECT_ALL_CONFIGS_SQL);
    return cloneConfigMap(
      rows.reduce<ServiceModelConfigMap>((configs, row) => {
        configs[row.service_type as ServiceModelType] = mapRowToConfig(row);
        return configs;
      }, {})
    );
  },

  async getConfig(serviceType: ServiceModelType): Promise<ServiceModelConfig | null> {
    if (!isDatabaseAvailable()) {
      const configs = await loadLegacyConfigs();
      const config = configs[serviceType];
      return config ? cloneConfig(config) : null;
    }

    await migrateLegacyConfigsToDatabase();

    const rows = await dbSelect<ServiceModelRow>(SELECT_ONE_CONFIG_SQL, [serviceType]);
    if (!rows[0]) return null;

    return cloneConfig(mapRowToConfig(rows[0]));
  },

  async saveConfig(serviceType: ServiceModelType, config: Omit<ServiceModelConfig, 'updatedAt'>): Promise<ServiceModelConfig> {
    const nextConfig: ServiceModelConfig = { ...config, updatedAt: Date.now() };

    if (isDatabaseAvailable()) {
      await dbExecute(UPSERT_CONFIG_SQL, [
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
    if (!isDatabaseAvailable()) {
      const configs = await loadLegacyConfigs();
      delete configs[serviceType];
      await saveLegacyConfigs(configs);
      return;
    }

    await dbExecute(DELETE_CONFIG_SQL, [serviceType]);
  }
};
