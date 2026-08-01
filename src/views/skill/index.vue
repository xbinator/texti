<!--
  @file index.vue
  @description Skill 独立详情页面，从路由参数获取 skill 名称并展示详情与文件预览。
-->
<template>
  <main class="skill-page">
    <!-- 顶部头部：名称 -->
    <header class="skill-page__header">
      <div class="skill-page__title-row">
        <template v-if="skill">
          <div class="skill-page__title">
            <div class="skill-page__name">{{ skill.name }}</div>
          </div>
        </template>
      </div>

      <div v-if="skill" class="skill-page__meta">
        <div class="skill-page__desc">{{ skill.description }}</div>
      </div>

      <div v-if="skill?.parseError" class="skill-page__parse-error">
        <Icon icon="lucide:alert-triangle" :width="14" />
        <span>{{ skill.parseError }}</span>
      </div>

      <div v-if="skill" class="skill-page__path">
        <span class="skill-page__path-text">{{ skill.dirPath }}</span>
        <BButton type="text" square size="small" title="复制路径" @click="handleCopyPath">
          <Icon icon="lucide:copy" :width="12" />
        </BButton>
      </div>
    </header>

    <!-- 主体：文件树 + 文件预览 -->
    <section v-if="skill" class="skill-page__body">
      <BSkill editable :root-path="skill.dirPath" :initial-file-path="skill.filePath" />
    </section>

    <!-- 未找到技能空状态 -->
    <div v-else class="skill-page__empty">
      <Icon icon="lucide:search-x" :width="24" />
      <span>未找到该技能</span>
    </div>
  </main>
</template>

<script setup lang="ts">
/**
 * @file index.vue
 * @description Skill 独立详情页面，从路由参数获取 skill 名称并展示详情与文件预览。
 */

import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { Icon } from '@iconify/vue';
import { useClipboard } from '@/hooks/useClipboard';
import { normalizeRouteParam } from '@/router/routes/helpers/fileRouteTab';
import { useSkillStore } from '@/stores/ai/skill';

const route = useRoute();
const store = useSkillStore();
const { clipboard } = useClipboard();

/** 页面实例创建时捕获的 Skill 名称，避免后台 KeepAlive 页面跟随全局路由变化。 */
const skillName = decodeURIComponent(normalizeRouteParam(route.params.name) ?? '');

/** 当前查看的 Skill 对象。 */
const skill = computed(() => store.getSkillByName(skillName) ?? null);

/** 复制目录路径。 */
function handleCopyPath(): void {
  if (!skill.value?.dirPath) return;
  clipboard(skill.value.dirPath, { successMessage: '路径已复制' });
}
</script>

<style scoped lang="less">
.skill-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  user-select: text;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
}

.skill-page__header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-tertiary);
}

.skill-page__title-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.skill-page__title {
  display: flex;
  flex: 1;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.skill-page__name {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

.skill-page__meta {
  min-width: 0;
}

.skill-page__desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.skill-page__parse-error {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--color-danger, #ff4d4f);
  background: var(--color-danger-bg, #fff2f0);
  border-radius: 6px;
}

.skill-page__path {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 4px 4px 4px 8px;
  overflow: hidden;
  background: var(--bg-secondary);
  border: 1px solid var(--border-tertiary);
  border-radius: 6px;

  // 复制按钮默认隐藏，hover 时显示
  .b-button {
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  &:hover .b-button {
    opacity: 1;
  }
}

.skill-page__path-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-size: 11px;
  white-space: nowrap;
}

.skill-page__body {
  display: flex;
  flex: 1;
  min-height: 0;
  padding: 12px 16px;
  overflow: hidden;
}

.skill-page__empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
  font-size: 13px;
  color: var(--text-tertiary);
}
</style>
