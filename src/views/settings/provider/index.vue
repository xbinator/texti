<template>
  <div class="provider-content">
    <div class="provider-header">
      <!--  -->
      <div class="header-left">
        <h2 class="content-title">AI 服务商</h2>
        <span class="enabled-count">已启用 {{ enabledCount }} 个服务商</span>
      </div>
    </div>

    <div class="provider-scroll">
      <div class="provider-grid">
        <ProviderCard v-for="provider in filteredProviders" :key="provider.id" :provider="provider" @toggle="handleToggleProvider" />
      </div>

      <div v-if="filteredProviders.length === 0" class="empty-state">
        <Icon icon="lucide:search-x" class="empty-icon" />
        <p>未找到匹配的服务商</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AIProvider } from 'types/ai';
import type { ComputedRef, Ref } from 'vue';
import { ref, computed } from 'vue';
import { useRoute } from 'vue-router';
import { Icon } from '@iconify/vue';
import { message } from 'ant-design-vue';
import { useProviderStore } from '@/stores/provider';
import ProviderCard from './components/ProviderCard.vue';

const route = useRoute();
const providerStore = useProviderStore();
const providers = computed(() => providerStore.providers);
const searchText: Ref<string> = ref('');

const enabledCount: ComputedRef<number> = computed(() => providers.value.filter((provider: AIProvider) => provider.isEnabled).length);

const activeCategory: ComputedRef<string> = computed((): string => {
  const category = route.query.category as string;
  return category || 'all';
});

const filteredProviders: ComputedRef<AIProvider[]> = computed((): AIProvider[] => {
  let result = providers.value;

  if (activeCategory.value === 'enabled') {
    result = result.filter((provider: AIProvider) => provider.isEnabled);
  } else if (activeCategory.value === 'disabled') {
    result = result.filter((provider: AIProvider) => !provider.isEnabled);
  }

  if (searchText.value) {
    const regex = new RegExp(searchText.value, 'i');
    result = result.filter((provider: AIProvider) => regex.test(provider.name) || regex.test(provider.description));
  }

  return result;
});

async function handleToggleProvider(id: string, enabled: boolean): Promise<void> {
  await providerStore.toggleProvider(id, enabled);

  message.success(enabled ? '已启用服务商' : '已禁用服务商');
}
</script>

<style scoped lang="less">
.provider-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.provider-header {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.header-left {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.content-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.enabled-count {
  padding: 3px 10px;
  font-size: 12px;
  color: var(--color-primary);
  background: var(--color-primary-bg);
  border-radius: 10px;
}

:deep(.ant-input-affix-wrapper) {
  background: var(--bg-secondary);
  border-color: var(--border-primary);
}

:deep(.ant-input) {
  background: transparent;
}

.provider-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  grid-auto-rows: 200px;
  gap: 12px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: var(--text-tertiary);
}

.empty-icon {
  font-size: 48px;
  opacity: 0.5;
}
</style>
