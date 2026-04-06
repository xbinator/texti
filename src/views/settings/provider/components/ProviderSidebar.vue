<template>
  <div class="provider-sidebar">
    <div class="sidebar-section">
      <div class="section-title">分类</div>
      <div
        v-for="category in categories"
        :key="category.key"
        class="sidebar-item"
        :class="{ active: activeCategory === category.key && activeProvider === 'all' }"
        @click="handleCategoryClick(category.key)"
      >
        <Icon :icon="category.icon" />
        <span>{{ category.label }}</span>
        <span class="count">{{ getCategoryCount(category.key) }}</span>
      </div>
    </div>

    <div class="sidebar-section">
      <div class="section-header">
        <div class="section-title">服务商</div>
        <div class="section-actions" @click="handleAddProvider">
          <Icon icon="lucide:plus" width="14" height="14" />
        </div>
      </div>
      <div
        v-for="provider in providerList"
        :key="provider.value"
        class="sidebar-item"
        :class="{ active: activeProvider === provider.value && activeCategory === 'all' }"
        @click="handleProviderClick(provider.value)"
      >
        <BModelIcon v-if="provider.value !== 'all'" :provider="provider.value" :size="16" />
        <Icon v-else icon="lucide:layout-grid" width="16" height="16" />
        <span>{{ provider.label }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { Icon } from '@iconify/vue';
import BModelIcon from '@/components/BModelIcon/index.vue';
import { useProviders } from '../hooks/useProviders';

interface Category {
  key: string;
  label: string;
  icon: string;
}

const router = useRouter();
const route = useRoute();
const { providers, providerList } = useProviders();

const categories: Category[] = [
  { key: 'all', label: '全部', icon: 'lucide:layout-grid' },
  { key: 'enabled', label: '已启用', icon: 'lucide:check-circle' }
];

const activeCategory = computed(() => {
  const category = route.query.category as string;
  return category || 'all';
});

const activeProvider = computed(() => {
  const { path } = route;
  if (path.includes('/settings/provider/') && path !== '/settings/provider') {
    const parts = path.split('/');
    return parts[parts.length - 1];
  }
  return 'all';
});

function getCategoryCount(category: string): number {
  if (category === 'all') return providers.value.length;
  if (category === 'enabled') return providers.value.filter((p) => p.isEnabled).length;
  if (category === 'disabled') return providers.value.filter((p) => !p.isEnabled).length;
  return 0;
}

function handleCategoryClick(value: string): void {
  if (value === 'all') {
    router.push('/settings/provider');
  } else {
    router.push({ path: '/settings/provider', query: { category: value } });
  }
}

function handleProviderClick(value: string): void {
  if (value === 'all') {
    router.push('/settings/provider');
  } else {
    router.push(`/settings/provider/${value}`);
  }
}

function handleAddProvider(): void {
  router.push('/settings/provider/custom');
}
</script>

<style scoped lang="less">
.provider-sidebar {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  gap: 20px;
  width: 220px;
}

.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  margin-bottom: 8px;
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.section-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s;

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
}

.sidebar-item {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s;

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  &.active {
    font-weight: 500;
    color: var(--text-primary);
    background: var(--color-primary-bg);
  }
}

.count {
  padding: 1px 6px;
  margin-left: auto;
  font-size: 11px;
  color: var(--text-tertiary);
  background: var(--bg-secondary);
  border-radius: 8px;
}
</style>
