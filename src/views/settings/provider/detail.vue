<template>
  <div class="detail-container">
    <div class="detail-header">
      <!--  -->
      <div class="flex flex-wrap gap-6 items-center cursor-pointer">
        <h2 class="page-title">{{ headerTitle }}</h2>
        <span v-if="provider" class="provider-type-tag">{{ providerTypeLabel }}</span>
      </div>
      <div class="flex flex-wrap gap-3 items-center">
        <div v-if="provider?.isCustom" class="edit-btn" @click="handleEdit">
          <Icon icon="lucide:settings" width="14" height="14" />
        </div>

        <ASwitch :checked="provider?.isEnabled ?? false" size="small" @change="(checked) => handleToggle(checked as boolean)" />
      </div>
    </div>

    <div class="flex-1 p-4 overflow-y-auto">
      <div v-if="!provider" class="loading-state">
        <Icon icon="lucide:loader-2" class="loading-icon" />
        <p>加载中...</p>
      </div>

      <div v-else class="flex flex-col gap-6">
        <ProviderInfo :provider="provider" />

        <ApiConfig v-model:value="provider" :models="models" />

        <ModelList :provider-id="provider.id" :models="models" @refresh="handleRefreshModels" />
      </div>
    </div>

    <ProviderModal v-model:open="modalVisible" :provider="provider" @success="handleModalSuccess" />
  </div>
</template>

<script setup lang="ts">
import type { AIProvider, AIProviderModel } from 'types/ai';
import type { ComputedRef, Ref } from 'vue';
import { ref, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Icon } from '@iconify/vue';
import { message } from 'ant-design-vue';
import { debounce } from 'lodash-es';
import { providerFormatLabels } from '../constants';
import ApiConfig from './components/ApiConfig.vue';
import ModelList from './components/ModelList.vue';
import ProviderInfo from './components/ProviderInfo.vue';
import ProviderModal from './components/ProviderModal.vue';
import { useProviderStore } from '@/stores/provider';

const route = useRoute();
const providerStore = useProviderStore();

const providerId: ComputedRef<string> = computed(() => route.params.provider as string);

const provider: Ref<AIProvider | null> = ref(null);
const models: Ref<AIProviderModel[]> = ref([]);
const isLoadingProvider: Ref<boolean> = ref(false);
const modalVisible: Ref<boolean> = ref(false);

const headerTitle: ComputedRef<string> = computed(() => (provider.value ? `${provider.value.name} 配置` : '配置'));

const providerTypeLabel: ComputedRef<string> = computed((): string => {
  if (!provider.value) {
    return '';
  }

  return providerFormatLabels[provider.value.type] || provider.value.type;
});

async function loadProvider(): Promise<void> {
  isLoadingProvider.value = true;

  await providerStore.loadProviders();

  provider.value = await providerStore.getProviderById(providerId.value);

  models.value = provider.value?.models ? provider.value.models.map((model) => ({ ...model })) : [];

  isLoadingProvider.value = false;
}

function syncProviderState(): void {
  loadProvider().catch(() => undefined);
}

const persistProviderConfig = debounce(async () => {
  if (!provider.value || isLoadingProvider.value) {
    return;
  }

  await providerStore.saveProviderConfig(provider.value.id, { apiKey: provider.value.apiKey, baseUrl: provider.value.baseUrl });
}, 300);

watch(
  providerId,
  (): void => {
    syncProviderState();
  },
  { immediate: true }
);

watch(
  () => [provider.value?.apiKey, provider.value?.baseUrl],
  (): void => {
    persistProviderConfig();
  }
);

function handleEdit(): void {
  modalVisible.value = true;
}

function handleModalSuccess(updatedProvider: AIProvider): void {
  provider.value = updatedProvider;
  modalVisible.value = false;
}

async function handleToggle(enabled: boolean): Promise<void> {
  if (!provider.value) {
    return;
  }

  await providerStore.toggleProvider(provider.value.id, enabled);
  provider.value = { ...provider.value, isEnabled: enabled };
  message.success(enabled ? '已启用服务商' : '已禁用服务商');
}

async function handleRefreshModels(): Promise<void> {
  await loadProvider();
}
</script>

<style scoped lang="less">
.detail-container {
  display: flex;
  flex-direction: column;
  min-width: 500px;
  height: 100%;
  background: var(--bg-primary);
  border-radius: 8px;
}

.detail-header {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-primary);
}

.back-icon {
  width: 20px;
  height: 20px;
  color: var(--text-primary);
}

.edit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.edit-btn:hover {
  color: var(--text-primary);
  background: var(--bg-secondary);
}

.delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.delete-btn:hover {
  color: #ff4d4f;
  background: var(--bg-secondary);
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.provider-type-tag {
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-primary);
  background: var(--color-primary-bg);
  border-radius: 4px;
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
</style>
