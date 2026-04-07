<template>
  <div class="provider-manager">
    <ProviderSidebar />

    <div class="provider-content">
      <div class="provider-header">
        <div class="header-left">
          <h2 class="content-title">AI 服务商</h2>
          <span class="enabled-count">已启用 {{ enabledCount }} 个服务商</span>
        </div>
        <div class="header-right">
          <AInput v-model:value="searchText" placeholder="搜索服务商" allow-clear class="search-input">
            <template #prefix>
              <Icon icon="lucide:search" />
            </template>
          </AInput>
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
  </div>
</template>

<script setup lang="ts">
import type { Provider } from './types';
import { ref, computed } from 'vue';
import { useRoute } from 'vue-router';
import { Icon } from '@iconify/vue';
import { message } from 'ant-design-vue';
import ProviderCard from './components/ProviderCard.vue';
import ProviderSidebar from './components/ProviderSidebar.vue';
import { useProviders } from './hooks/useProviders';

const route = useRoute();
const searchText = ref<string>('');
const { providers, toggleProvider } = useProviders();

const enabledCount = computed(() => providers.value.filter((provider: Provider) => provider.isEnabled).length);

const activeCategory = computed(() => {
  const category = route.query.category as string;
  return category || 'all';
});

const filteredProviders = computed(() => {
  let result = providers.value;

  if (activeCategory.value === 'enabled') {
    result = result.filter((provider: Provider) => provider.isEnabled);
  } else if (activeCategory.value === 'disabled') {
    result = result.filter((provider: Provider) => !provider.isEnabled);
  }

  if (searchText.value) {
    const regex = new RegExp(searchText.value, 'i');
    result = result.filter((provider: Provider) => regex.test(provider.name) || regex.test(provider.description));
  }

  return result;
});

async function handleToggleProvider(id: string, enabled: boolean): Promise<void> {
  await toggleProvider(id, enabled);

  message.success(enabled ? '已启用服务商' : '已禁用服务商');
}
</script>

<style scoped lang="less">
.provider-manager {
  display: flex;
  gap: 16px;
  height: 100%;
  padding: 20px;
}

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

.header-right {
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

.search-input {
  width: 200px;
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
