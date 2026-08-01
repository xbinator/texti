<!--
  @file index.vue
  @description Skill 设置页，管理搜索路径、查看和启用/禁用 Skill。
-->
<template>
  <SettingsPage class="skill-settings" :title="MENU_ITEMS.skill.label">
    <template #extra>
      <BButton icon="lucide:plus" type="primary" size="small" @click="creatorVisible = true">创建技能</BButton>
    </template>
    <!-- 搜索路径说明 -->
    <SettingsSection title="搜索路径" content-class="skill-settings__content">
      <div class="skill-settings__hint">Skill 文件放置在 <code>.agents/skills/&lt;name&gt;/SKILL.md</code> 目录下即可自动发现</div>
    </SettingsSection>

    <!-- Skill 列表 -->
    <SettingsSection title="已安装">
      <div v-if="store.skills.length === 0" class="skill-settings__empty">
        {{ store.initialized ? '未发现任何 Skill' : '正在扫描…' }}
      </div>

      <div v-for="skill in pagedSkills" :key="skill.filePath" class="skill-settings__item">
        <SkillItemRow :skill="skill" />
      </div>

      <!-- 分页 -->
      <SettingsPagination v-model:current="currentPage" :total="store.skills.length" :page-size="PAGE_SIZE" />
    </SettingsSection>

    <!-- 创建技能模态框 -->
    <SkillCreator v-model:open="creatorVisible" />
  </SettingsPage>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { SkillDefinition } from '@/ai/skill/types';
import { useSkillStore } from '@/stores/ai/skill';
import SettingsPage from '@/views/settings/_components/SettingsPage.vue';
import SettingsPagination from '@/views/settings/_components/SettingsPagination.vue';
import SettingsSection from '@/views/settings/_components/SettingsSection.vue';
import { MENU_ITEMS } from '@/views/settings/constants';
import SkillCreator from './components/SkillCreator.vue';
import SkillItemRow from './components/SkillItemRow.vue';

/** 每页显示数量。 */
const PAGE_SIZE = 8;

const route = useRoute();
const router = useRouter();
const store = useSkillStore();
/** 创建技能模态框可见性。 */
const creatorVisible = ref(false);

/**
 * 当前页码，来源为路由查询参数 `page`，缺省值为 1。
 * 切换分页时通过 `router.replace` 同步到 URL，便于从详情页返回时保持原页码。
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

/** 总页数，最少为 1，用于在页码越界时兜底。 */
const totalPages = computed<number>(() => Math.max(1, Math.ceil(store.skills.length / PAGE_SIZE)));

/** 当前页的 skill 列表。 */
const pagedSkills = computed<SkillDefinition[]>((): SkillDefinition[] => {
  const start = (currentPage.value - 1) * PAGE_SIZE;
  return store.skills.slice(start, start + PAGE_SIZE);
});

/** 当技能列表收缩导致当前页码越界时，自动回退到最后一页。 */
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
.skill-settings {
  height: 100%;
  min-height: 0;
}

.skill-settings__hint {
  font-size: 12px;
  color: var(--text-secondary);
  user-select: text;

  code {
    padding: 1px 4px;
    font-size: 11px;
    background: var(--bg-tertiary);
    border-radius: var(--control-radius);
  }
}

:deep(.skill-settings__content) {
  padding: 16px 20px;
}

.skill-settings__empty {
  padding: 16px;
  font-size: 12px;
  color: var(--text-secondary);
}

.skill-settings__item {
  padding: 12px 20px;

  &:hover {
    background: var(--bg-hover);
  }

  &:not(:first-child) {
    border-top: 1px solid var(--border-tertiary);
  }
}
</style>
