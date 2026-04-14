<template>
  <div class="provider-layout">
    <div class="provider-sidebar">
      <BScrollbar inset>
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
            <span class="count">{{ categoryCountMap[category.key] }}</span>
          </div>
        </div>

        <div class="sidebar-section">
          <div class="section-header">
            <div class="section-title-wrapper" @click="customCollapsed = !customCollapsed">
              <div class="section-title">自定义服务商</div>
              <Icon :icon="customCollapsed ? 'lucide:chevron-right' : 'lucide:chevron-down'" width="12" height="12" class="collapse-icon" />
            </div>
            <div class="section-actions" @click.stop="handleAddProvider">
              <Icon icon="lucide:plus" width="14" height="14" />
            </div>
          </div>
          <div v-show="!customCollapsed">
            <div v-if="customProviders.length === 0" class="empty-state">
              <Icon icon="lucide:inbox" width="24" height="24" />
              <span>暂无自定义服务商</span>
            </div>
            <div
              v-for="provider in customProviders"
              :key="provider.value"
              class="sidebar-item"
              :class="{ active: activeProvider === provider.value && activeCategory === 'all' }"
              @click="handleProviderClick(provider.value)"
            >
              <img v-if="providerLogos[provider.value]" class="provider-logo" :src="providerLogos[provider.value]" :alt="provider.label" />
              <Icon v-else icon="lucide:bot" width="16" height="16" />
              <span>{{ provider.label }}</span>

              <BDropdown>
                <button type="button" class="edit-btn" title="更多">
                  <Icon icon="lucide:more-vertical" width="12" height="12" />
                </button>
                <template #overlay>
                  <BDropdownMenu :options="providerDropdownOptionsMap.get(provider.value) || []">
                    <template #menu="{ record }">
                      <div class="dropdown-menu-item" :class="{ danger: record.danger }">
                        <Icon :icon="record.icon" />
                        <span>{{ record.label }}</span>
                      </div>
                    </template>
                  </BDropdownMenu>
                </template>
              </BDropdown>
            </div>
          </div>
        </div>

        <div class="sidebar-section">
          <div class="section-header">
            <div class="section-title-wrapper" @click="defaultCollapsed = !defaultCollapsed">
              <div class="section-title">服务商</div>
              <Icon :icon="defaultCollapsed ? 'lucide:chevron-right' : 'lucide:chevron-down'" width="12" height="12" class="collapse-icon" />
            </div>
          </div>
          <div v-show="!defaultCollapsed">
            <div
              v-for="provider in defaultProviders"
              :key="provider.value"
              class="sidebar-item"
              :class="{ active: activeProvider === provider.value && activeCategory === 'all' }"
              @click="handleProviderClick(provider.value)"
            >
              <img v-if="providerLogos[provider.value]" class="provider-logo" :src="providerLogos[provider.value]" :alt="provider.label" />
              <BModelIcon v-else :provider="provider.value" :size="16" />
              <span>{{ provider.label }}</span>
            </div>
          </div>
        </div>
      </BScrollbar>
    </div>

    <div class="provider-content">
      <RouterView />
    </div>
  </div>

  <ProviderModal v-model:open="modalVisible" :provider="editingProvider" />
</template>

<script setup lang="ts">
import type { AIProvider } from 'types/ai';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import BDropdown from '@/components/BDropdown/index.vue';
import BDropdownMenu from '@/components/BDropdown/Menu.vue';
import type { DropdownOptionItem } from '@/components/BDropdown/type';
import BModelIcon from '@/components/BModelIcon/index.vue';
import { Modal } from '@/utils/modal';
import ProviderModal from './components/ProviderModal.vue';
import { useProviders } from './hooks/useProviders';

interface Category {
  key: string;
  label: string;
  icon: string;
}

interface ProviderOption {
  label: string;
  value: string;
}

interface ProviderComputedData {
  customProviders: ProviderOption[];
  defaultProviders: ProviderOption[];
  providerMap: Record<string, AIProvider>;
  categoryCountMap: Record<string, number>;
}

const router = useRouter();
const route = useRoute();
const { providers, deleteCustomProvider } = useProviders();

const providerComputedData = computed<ProviderComputedData>(() => {
  const custom: ProviderOption[] = [];
  const default_: ProviderOption[] = [];
  const map: Record<string, AIProvider> = {};

  let enabledCount = 0;

  providers.value.forEach((provider: AIProvider) => {
    map[provider.id] = provider;

    if (provider.isCustom) {
      custom.push({ label: provider.name, value: provider.id });
    } else {
      default_.push({ label: provider.name, value: provider.id });
    }

    if (provider.isEnabled) {
      enabledCount++;
    }
  });

  return {
    customProviders: custom,
    defaultProviders: default_,
    providerMap: map,
    categoryCountMap: {
      all: providers.value.length,
      enabled: enabledCount,
      disabled: providers.value.length - enabledCount
    }
  };
});

const customProviders = computed(() => providerComputedData.value.customProviders);
const defaultProviders = computed(() => providerComputedData.value.defaultProviders);

const categories: Category[] = [
  { key: 'all', label: '全部', icon: 'lucide:layout-grid' },
  { key: 'enabled', label: '已启用', icon: 'lucide:check-circle' }
];

const modalVisible = ref<boolean>(false);
const editingProvider = ref<AIProvider | null>(null);
const customCollapsed = ref<boolean>(false);
const defaultCollapsed = ref<boolean>(false);

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

const providerMap = computed(() => providerComputedData.value.providerMap);
const categoryCountMap = computed(() => providerComputedData.value.categoryCountMap);

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

const providerLogos = computed<Record<string, string>>(() => {
  const logos: Record<string, string> = {};

  providers.value.forEach((provider) => (logos[provider.id] = provider.logo || ''));
  return logos;
});

function handleAddProvider(): void {
  editingProvider.value = null;
  modalVisible.value = true;
}

function handleEditProvider(providerId: string): void {
  const provider = providerMap.value[providerId];
  if (!provider || !provider.isCustom) {
    return;
  }
  editingProvider.value = provider;
  modalVisible.value = true;
}

async function handleDeleteProvider(providerId: string): Promise<void> {
  const provider = providerMap.value[providerId];
  if (!provider || !provider.isCustom) {
    return;
  }

  const [, confirmed] = await Modal.delete(`确定要删除服务商 "${provider.name}" 吗？`);
  if (!confirmed) return;

  const success = await deleteCustomProvider(providerId);
  if (success) {
    if (activeProvider.value === providerId) {
      router.push('/settings/provider');
    }
  }
}

const providerDropdownOptionsMap = computed<Map<string, DropdownOptionItem[]>>(() => {
  const optionsMap = new Map<string, DropdownOptionItem[]>();
  providers.value.forEach((provider) => {
    if (provider.isCustom) {
      optionsMap.set(provider.id, [
        {
          type: 'item',
          value: 'edit',
          label: '编辑',
          icon: 'lucide:pencil',
          onClick: () => handleEditProvider(provider.id)
        },
        {
          type: 'item',
          value: 'delete',
          label: '删除',
          icon: 'lucide:trash-2',
          danger: true,
          onClick: () => handleDeleteProvider(provider.id)
        }
      ]);
    }
  });
  return optionsMap;
});
</script>

<style scoped lang="less">
.provider-layout {
  display: flex;
  gap: 16px;
  height: 100%;
  padding: 20px;
}

.provider-content {
  flex: 1;
  min-width: 0;
  height: 100%;
}

.provider-sidebar {
  flex-shrink: 0;
  width: 220px;
}

.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 4px;

  & + .sidebar-section {
    margin-top: 20px;
  }
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  margin-bottom: 8px;
}

.section-title-wrapper {
  display: flex;
  gap: 4px;
  align-items: center;
  cursor: pointer;
  user-select: none;
}

.collapse-icon {
  color: var(--text-tertiary);
  transition: transform 0.2s ease;
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

    .edit-btn {
      opacity: 1;
    }
  }

  &.active {
    font-weight: 500;
    color: var(--text-primary);
    background: var(--color-primary-bg);

    .edit-btn {
      opacity: 1;
    }
  }
}

.provider-logo {
  width: 16px;
  height: 16px;
  object-fit: cover;
  border-radius: 4px;
}

.edit-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: auto;
  color: var(--text-tertiary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 4px;
  opacity: 0;
  transition: all 0.15s;

  &:hover {
    color: var(--text-primary);
    background: var(--bg-secondary);
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

.dropdown-menu-item {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 120px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  padding: 20px 8px;
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>
