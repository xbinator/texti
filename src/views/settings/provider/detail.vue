<template>
  <div class="provider-detail-page">
    <ProviderSidebar />

    <div class="detail-container">
      <DetailHeader :title="headerTitle" :is-enabled="provider?.isEnabled ?? false" @back="handleBack" @toggle="handleToggle" />

      <div class="detail-content">
        <div v-if="!provider" class="loading-state">
          <Icon icon="lucide:loader-2" class="loading-icon" />
          <p>加载中...</p>
        </div>

        <div v-else class="provider-info">
          <ProviderInfo :provider="provider" />

          <ApiConfig v-model:value="provider" @test="handleTestConnection" />

          <ModelList :models="models" @refresh="handleRefreshModels" @toggle="handleToggleModel" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Model, Provider } from './types';
import { ref, computed, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { Icon } from '@iconify/vue';
import { message } from 'ant-design-vue';
import { debounce } from 'lodash-es';
import ApiConfig from './components/ApiConfig.vue';
import DetailHeader from './components/DetailHeader.vue';
import ModelList from './components/ModelList.vue';
import ProviderInfo from './components/ProviderInfo.vue';
import ProviderSidebar from './components/ProviderSidebar.vue';
import { useProviders } from './hooks/useProviders';

const router = useRouter();
const route = useRoute();

const providerId = computed(() => route.params.provider as string);

const { getProviderById, loadProviders, toggleProvider, saveProviderConfig, saveProviderModels } = useProviders();

const provider = ref<Provider | null>(null);
const models = ref<Model[]>([]);
const isLoadingProvider = ref(false);

const headerTitle = computed(() => (provider.value ? `${provider.value.name} 配置` : '配置'));

async function loadProvider(): Promise<void> {
  isLoadingProvider.value = true;
  try {
    await loadProviders();
    provider.value = await getProviderById(providerId.value);
    models.value = provider.value?.models ? provider.value.models.map((model: Model) => ({ ...model, tags: model.tags ? [...model.tags] : [] })) : [];
  } finally {
    isLoadingProvider.value = false;
  }
}

const persistProviderConfig = debounce(async () => {
  if (!provider.value || isLoadingProvider.value) {
    return;
  }

  await saveProviderConfig(provider.value.id, {
    apiKey: provider.value.apiKey,
    baseUrl: provider.value.baseUrl
  });
}, 300);

watch(providerId, () => loadProvider(), { immediate: true });

watch(
  () => [provider.value?.apiKey, provider.value?.baseUrl],
  () => persistProviderConfig()
);

function handleBack(): void {
  router.push('/settings/provider');
}

async function handleToggle(enabled: boolean): Promise<void> {
  if (!provider.value) {
    return;
  }

  await toggleProvider(provider.value.id, enabled);
  provider.value = { ...provider.value, isEnabled: enabled };
  message.success(enabled ? '已启用服务商' : '已禁用服务商');
}

function handleTestConnection(): void {
  message.info('连通性检查功能待实现');
}

function handleRefreshModels(): void {
  message.info('获取模型列表功能待实现');
}

async function handleToggleModel(modelId: string, enabled: boolean): Promise<void> {
  if (!provider.value) {
    return;
  }

  const model = models.value.find((item: Model) => item.id === modelId);
  if (model) {
    model.isEnabled = enabled;
    await saveProviderModels(provider.value.id, models.value);
    message.success(enabled ? '已启用模型' : '已禁用模型');
  }
}
</script>

<style scoped lang="less">
.provider-detail-page {
  display: flex;
  gap: 20px;
  height: 100%;
  padding: 20px;
}

.detail-container {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  background: var(--bg-primary);
  border-radius: 8px;
}

.detail-content {
  flex: 1;
  overflow-y: auto;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: var(--text-tertiary);
}

.loading-icon {
  font-size: 48px;
  opacity: 0.5;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.provider-info {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
</style>
