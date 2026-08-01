<template>
  <div class="provider-layout" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
    <div class="provider-sidebar">
      <SidebarSearch v-model="searchKeyword" :collapsed="sidebarCollapsed" @toggle="toggleSidebarCollapsed" />

      <div class="sidebar-inner">
        <template v-if="searchKeyword">
          <SidebarSection :collapsed="sidebarCollapsed">
            <div v-if="filteredAllProviders.length === 0" class="empty-state">
              <Icon icon="lucide:search-x" width="24" height="24" />
              <span>无匹配结果</span>
            </div>
            <SidebarItem
              v-for="provider in filteredAllProviders"
              :key="provider.value"
              :active="activeProvider === provider.value && activeCategory === 'all'"
              :collapsed="sidebarCollapsed"
              :is-custom="provider.isCustom"
              :label="provider.label"
              :logo="providerLogos[provider.value]"
              :provider="provider.value"
              @click="handleNavigate('provider', provider.value)"
            />
          </SidebarSection>
        </template>

        <template v-else>
          <SidebarSection :collapsed="sidebarCollapsed">
            <template #title>分类</template>
            <SidebarItem
              v-for="category in categories"
              :key="category.key"
              :active="activeCategory === category.key && activeProvider === 'all'"
              :collapsed="sidebarCollapsed"
              :count="categoryCountMap[category.key]"
              :icon="category.icon"
              :label="category.label"
              :title="sidebarCollapsed ? category.label : ''"
              @click="handleNavigate('category', category.key)"
            />
          </SidebarSection>

          <SidebarSection
            v-model:section-collapsed="customCollapsed"
            action-icon="lucide:plus"
            action-title="添加模型平台"
            :collapsed="sidebarCollapsed"
            collapsible
            title="自定义"
            @action="handleAddProvider"
          >
            <div v-if="!customProviders.length" class="empty-state">
              <Icon icon="lucide:inbox" width="24" height="24" />
              <span class="item-label">暂无自定义模型平台</span>
            </div>
            <SidebarItem
              v-for="provider in customProviders"
              :key="provider.value"
              :active="activeProvider === provider.value && activeCategory === 'all'"
              :collapsed="sidebarCollapsed"
              :is-custom="provider.isCustom"
              :label="provider.label"
              :logo="providerLogos[provider.value]"
              :title="sidebarCollapsed ? provider.label : ''"
              @click="handleNavigate('provider', provider.value)"
            >
              <template #extra>
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
              </template>
            </SidebarItem>
          </SidebarSection>

          <SidebarSection v-model:section-collapsed="defaultCollapsed" :collapsed="sidebarCollapsed" collapsible title="模型平台">
            <SidebarItem
              v-for="provider in defaultProviders"
              :key="provider.value"
              :active="activeProvider === provider.value && activeCategory === 'all'"
              :collapsed="sidebarCollapsed"
              :label="provider.label"
              :logo="providerLogos[provider.value]"
              :provider="provider.value"
              :title="sidebarCollapsed ? provider.label : ''"
              @click="handleNavigate('provider', provider.value)"
            />
          </SidebarSection>
        </template>
      </div>
    </div>

    <div class="provider-content">
      <RouterView />
    </div>
  </div>

  <ProviderModal v-model:open="modalVisible" :provider="editingProvider" />
</template>

<script setup lang="ts">
import type { Category, ProviderComputedData, ProviderOption } from './types';
import type { AIProvider } from 'types/ai';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { Icon } from '@iconify/vue';
import BDropdown from '@/components/BDropdown/index.vue';
import BDropdownMenu from '@/components/BDropdown/Menu.vue';
import type { DropdownOptionItem } from '@/components/BDropdown/type';
import { useProviderStore } from '@/stores/ai/provider';
import { useSettingStore } from '@/stores/ui/setting';
import { Modal } from '@/utils/modal';
import ProviderModal from './components/ProviderModal.vue';
import SidebarItem from './components/SidebarItem.vue';
import SidebarSearch from './components/SidebarSearch.vue';
import SidebarSection from './components/SidebarSection.vue';

const router = useRouter();
const route = useRoute();
const providerStore = useProviderStore();
const providers = computed(() => providerStore.providers);
const settingStore = useSettingStore();
const { providerSidebarCollapsed: sidebarCollapsed } = storeToRefs(settingStore);

const searchKeyword = ref<string>('');

function toggleSidebarCollapsed(): void {
  settingStore.setProviderSidebarCollapsed(!sidebarCollapsed.value);
}

const providerComputedData = computed<ProviderComputedData>(() => {
  const custom: ProviderOption[] = [];
  const default_: ProviderOption[] = [];
  const map: Record<string, AIProvider> = {};
  let enabledCount = 0;

  providers.value.forEach((provider: AIProvider) => {
    map[provider.id] = provider;
    if (provider.isCustom) {
      custom.push({ label: provider.name, value: provider.id, isCustom: true });
    } else {
      default_.push({ label: provider.name, value: provider.id, isCustom: false });
    }
    if (provider.isEnabled) enabledCount++;
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

const filteredAllProviders = computed<ProviderOption[]>(() => {
  const keyword = searchKeyword.value.toLowerCase();
  return [...customProviders.value, ...defaultProviders.value].filter((provider) => provider.label.toLowerCase().includes(keyword));
});

const categories: Category[] = [
  { key: 'all', label: '全部', icon: 'lucide:layout-grid' },
  { key: 'enabled', label: '已启用', icon: 'lucide:check-circle' }
];

const modalVisible = ref<boolean>(false);
const editingProvider = ref<AIProvider | null>(null);
const customCollapsed = ref<boolean>(false);
const defaultCollapsed = ref<boolean>(false);

const activeCategory = computed(() => (route.query.category as string) || 'all');

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

/**
 * 处理分类或供应商点击导航，若当前已在目标路由则忽略。
 * @param type - 点击类型：'category' 或 'provider'
 * @param value - 点击的值，'all' 时导航到列表页
 */
function handleNavigate(type: 'category' | 'provider', value: string): void {
  if (type === 'category' && activeCategory.value === value && route.name === 'provider-list') return;
  if (type === 'provider' && activeProvider.value === value && route.name === 'provider-detail') return;

  if (value === 'all') {
    router.push({ name: 'provider-list' });
  } else if (type === 'category') {
    router.push({ name: 'provider-list', query: { category: value } });
  } else {
    router.push({ name: 'provider-detail', params: { provider: value } });
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
  if (!provider || !provider.isCustom) return;
  editingProvider.value = provider;
  modalVisible.value = true;
}

async function handleDeleteProvider(providerId: string): Promise<void> {
  const provider = providerMap.value[providerId];
  if (!provider || !provider.isCustom) return;

  const [, confirmed] = await Modal.delete(`确定要删除模型平台 "${provider.name}" 吗？`);
  if (!confirmed) return;

  const success = await providerStore.deleteCustomProvider(providerId);
  if (success && activeProvider.value === providerId) {
    router.push('/settings/provider');
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
  gap: 12px;
  height: 100%;
  padding: 16px 12px;
  background: var(--bg-primary);
  border: var(--surface-border-width) solid var(--border-primary);
  border-radius: var(--surface-radius);
}

.provider-sidebar {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  width: 220px;
  transition: width var(--motion-duration-slow) var(--motion-easing-standard);

  .provider-layout.sidebar-collapsed & {
    width: 36px;
  }
}

.sidebar-inner {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.provider-layout.sidebar-collapsed {
  .empty-state {
    display: none;
    padding: 12px 0;

    span {
      display: none;
    }
  }

  :deep(.sidebar-section + .sidebar-section) {
    margin-top: 12px;
  }
}

.provider-content {
  flex: 1;
  min-width: 0;
  height: 100%;
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
  border-radius: var(--control-radius);
  opacity: 0;
  transition: color var(--motion-duration-fast) var(--motion-easing-standard), background var(--motion-duration-fast) var(--motion-easing-standard),
    opacity var(--motion-duration-fast) var(--motion-easing-standard);

  &:hover {
    color: var(--text-primary);
    background: var(--bg-secondary);
  }
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

<style lang="less">
/*
 * 视图过渡样式：仅对 provider-nav 类型生效，避免污染未来其他 View Transition。
 * hero（卡片→详情容器）在 0–0.3s 缩放 morph；列表（::view-transition-old(root)）
 * 保持可见至 0.3s 后再用 0.2s 淡出，实现“缩放完成后列表淡出”。
 */
:root:active-view-transition-type(provider-nav) {
  ::view-transition-group(provider-hero) {
    animation-duration: 0.3s;
    animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  }

  ::view-transition-old(root) {
    animation: provider-nav-list-fade 0.2s ease 0.3s both;
  }

  ::view-transition-new(root) {
    animation: none;
  }
}

@keyframes provider-nav-list-fade {
  from {
    opacity: 1;
  }

  to {
    opacity: 0;
  }
}
</style>
