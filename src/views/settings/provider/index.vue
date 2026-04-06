<template>
  <div class="provider-manager">
    <ProviderSidebar />

    <div class="provider-content">
      <ProviderHeader v-model:search-text="searchText" :enabled-count="enabledCount" />

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
import { ref, computed } from 'vue';
import { useRoute } from 'vue-router';
import { Icon } from '@iconify/vue';
import { message } from 'ant-design-vue';
import ProviderCard from './components/ProviderCard.vue';
import ProviderHeader from './components/ProviderHeader.vue';
import ProviderSidebar from './components/ProviderSidebar.vue';
import { useProviders } from './hooks/useProviders';

const route = useRoute();
const searchText = ref<string>('');
const { providers, enabledCount, toggleProvider } = useProviders();

const activeCategory = computed(() => {
  const category = route.query.category as string;
  return category || 'all';
});

const filteredProviders = computed(() => {
  let result = providers.value;

  if (activeCategory.value === 'enabled') {
    result = result.filter((p) => p.isEnabled);
  } else if (activeCategory.value === 'disabled') {
    result = result.filter((p) => !p.isEnabled);
  }

  if (searchText.value) {
    const search = searchText.value.toLowerCase();

    result = result.filter((p) => p.name.toLowerCase().includes(search) || p.description.toLowerCase().includes(search));
  }

  return result;
});

function handleToggleProvider(id: string, enabled: boolean): void {
  toggleProvider(id, enabled);
  message.success(enabled ? '已启用服务商' : '已禁用服务商');
}
</script>

<style scoped lang="less">
.provider-manager {
  display: flex;
  gap: 20px;
  height: 100%;
  padding: 20px;
}

.provider-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
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
