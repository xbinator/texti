<template>
  <div class="detail-container">
    <div v-if="!provider" class="loading-state">
      <Icon icon="lucide:loader-2" class="loading-icon" />
      <p>加载中...</p>
    </div>

    <div v-else class="flex flex-col gap-6">
      <ProviderInfo :provider="provider" :provider-type-label="providerTypeLabel" @edit="handleEdit" @toggle="handleToggle" />

      <ApiConfig v-model:value="provider" :models="models" />

      <ModelList :provider-id="provider.id" :models="models" @refresh="handleRefreshModels" />
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
import { useProviderStore } from '@/stores/ai/provider';
import { asyncTo } from '@/utils/asyncTo';
import { providerFormatLabels } from '../constants';
import ApiConfig from './components/ApiConfig.vue';
import ModelList from './components/ModelList.vue';
import ProviderInfo from './components/ProviderInfo.vue';
import ProviderModal from './components/ProviderModal.vue';

const route = useRoute();
const providerStore = useProviderStore();

const providerId: ComputedRef<string> = computed(() => route.params.provider as string);

// 同步从已填充的 store 读取初始值，使视图过渡的新快照能立即捕获真实内容（避免 morph 期间显示 spinner）。
// watch 仍会从存储刷新一次，对已渲染内容无视觉破坏。
const initialProvider = providerStore.providers.find((item) => item.id === providerId.value) ?? null;
const provider: Ref<AIProvider | null> = ref<AIProvider | null>(initialProvider);
const models: Ref<AIProviderModel[]> = ref<AIProviderModel[]>(initialProvider?.models ? initialProvider.models.map((model) => ({ ...model })) : []);
const isLoadingProvider: Ref<boolean> = ref(false);
const modalVisible: Ref<boolean> = ref(false);

const providerTypeLabel: ComputedRef<string> = computed((): string => {
  if (!provider.value) {
    return '';
  }

  return providerFormatLabels[provider.value.type] || provider.value.type;
});

async function loadProvider(): Promise<void> {
  isLoadingProvider.value = true;

  try {
    await providerStore.loadProviders();

    provider.value = await providerStore.getProviderById(providerId.value);

    models.value = provider.value?.models ? provider.value.models.map((model) => ({ ...model })) : [];
  } finally {
    isLoadingProvider.value = false;
  }
}

async function syncProviderState(): Promise<void> {
  await asyncTo(loadProvider());
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
  message.success(enabled ? '已启用模型平台' : '已禁用模型平台');
}

async function handleRefreshModels(): Promise<void> {
  await loadProvider();
}
</script>

<style scoped lang="less">
.detail-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 400px;
  height: 100%;
  overflow: auto;
  background: var(--bg-primary);
  border-radius: 8px;
  view-transition-name: provider-hero;
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
