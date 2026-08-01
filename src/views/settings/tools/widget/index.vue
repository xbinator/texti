<!--
  @file index.vue
  @description 小组件设置页，扫描 .tibis/widgets/<name>/widget.json 并管理创建与启用状态。
-->
<template>
  <SettingsPage class="widget-settings" :title="MENU_ITEMS.widget.label">
    <template #extra>
      <BButton icon="lucide:plus" type="primary" size="small" @click="openCreateModal">创建小组件</BButton>
    </template>

    <SettingsSection title="搜索路径" content-class="widget-settings__content">
      <div class="widget-settings__hint">小组件 JSON 文件放置在 <code>.tibis/widgets/&lt;name&gt;/widget.json</code> 即可自动发现</div>
    </SettingsSection>

    <SettingsSection title="已安装">
      <div v-if="store.widgets.length === 0" class="widget-settings__empty">
        {{ store.initialized ? '未发现任何小组件' : '正在扫描…' }}
      </div>

      <div v-for="widget in pagedWidgets" :key="widget.filePath" class="widget-settings__item">
        <WidgetItemRow :widget="widget" />
      </div>

      <SettingsPagination v-model:current="currentPage" :total="store.widgets.length" :page-size="PAGE_SIZE" />
    </SettingsSection>
  </SettingsPage>

  <WidgetCreator v-model:open="createModalOpen" />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { WidgetDefinition } from '@/ai/widget/types';
import { useWidgetStore } from '@/stores/ai/widget';
import SettingsPage from '@/views/settings/_components/SettingsPage.vue';
import SettingsPagination from '@/views/settings/_components/SettingsPagination.vue';
import SettingsSection from '@/views/settings/_components/SettingsSection.vue';
import { MENU_ITEMS } from '@/views/settings/constants';
import WidgetCreator from './components/WidgetCreator.vue';
import WidgetItemRow from './components/WidgetItemRow.vue';

/** 每页显示数量。 */
const PAGE_SIZE = 8;

const route = useRoute();
const router = useRouter();
const store = useWidgetStore();
/** 创建弹窗开关。 */
const createModalOpen = ref(false);

/**
 * 当前页码，来源为路由查询参数 `page`。
 */
const currentPage = computed<number>({
  get(): number {
    const raw = route.query.page;
    const value = Number(Array.isArray(raw) ? raw[0] : raw);

    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
  },
  set(value: number): void {
    router.replace({ query: { ...route.query, page: String(value) } });
  }
});

/** 总页数，最少为 1。 */
const totalPages = computed<number>(() => Math.max(1, Math.ceil(store.widgets.length / PAGE_SIZE)));

/** 当前页小组件列表。 */
const pagedWidgets = computed<WidgetDefinition[]>((): WidgetDefinition[] => {
  const start = (currentPage.value - 1) * PAGE_SIZE;

  return store.widgets.slice(start, start + PAGE_SIZE);
});

/**
 * 打开小组件创建弹窗。
 */
function openCreateModal(): void {
  createModalOpen.value = true;
}

watch(
  [currentPage, totalPages],
  ([page, pages]: [number, number]): void => {
    if (page > pages) {
      currentPage.value = pages;
    }
  },
  { immediate: true }
);
</script>

<style scoped lang="less">
.widget-settings {
  height: 100%;
  min-height: 0;
}

.widget-settings__hint {
  font-size: 12px;
  color: var(--text-secondary);
  user-select: text;
}

.widget-settings__hint code {
  padding: 1px 4px;
  font-size: 11px;
  background: var(--bg-tertiary);
  border-radius: var(--control-radius);
}

:deep(.widget-settings__content) {
  padding: 16px 20px;
}

.widget-settings__empty {
  padding: 16px;
  font-size: 12px;
  color: var(--text-secondary);
}

.widget-settings__item {
  padding: 12px 20px;
}

.widget-settings__item:hover {
  background: var(--bg-hover);
}

.widget-settings__item:not(:first-child) {
  border-top: 1px solid var(--border-tertiary);
}
</style>
