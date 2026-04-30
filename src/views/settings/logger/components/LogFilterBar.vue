<!--
  @file LogFilterBar.vue
  @description 日志过滤工具栏，保留日志标题、记录总数、打开目录，以及关键词与日期筛选能力。
-->
<template>
  <div class="log-toolbar">
    <div class="log-header">
      <div class="log-header-title">
        <h3>运行日志</h3>
        <span class="log-header-count">共 {{ store.entries.length }} 条记录</span>
      </div>
      <div class="log-header-actions">
        <BButton icon="lucide:folder-open" type="text" @click="logger.openLogFolder()"> 打开目录 </BButton>
      </div>
    </div>

    <div class="log-filter-bar">
      <AInput v-model:value="keywordModel" placeholder="搜索日志内容..." allow-clear class="log-filter-bar__input" />

      <ADatePicker v-model:value="dateModel" placeholder="选择日期" class="log-filter-bar__date" value-format="YYYY-MM-DD" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { logger } from '@/shared/logger';
import { useLogViewerStore } from '../stores/logViewer';

/** 日志查看器全局状态。 */
const store = useLogViewerStore();

/** 日期筛选的双向绑定，空值时清空筛选条件。 */
const dateModel = computed<string | undefined>({
  get: (): string | undefined => store.selectedDate || undefined,
  set: (value: string | undefined): void => store.setDate(value || '')
});

/** 关键词筛选的双向绑定。 */
const keywordModel = computed<string>({
  get: (): string => store.keyword,
  set: (value: string): void => store.setKeyword(value)
});
</script>

<style scoped lang="less">
.log-toolbar {
  padding: 0 20px;
}

.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
}

.log-header-title {
  display: flex;
  gap: 12px;
  align-items: baseline;
}

.log-header-title h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.log-header-count {
  font-size: 13px;
  color: var(--text-tertiary);
}

.log-header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.log-filter-bar {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 16px;
  background: var(--bg-elevated);
  border-radius: 8px;
}

.log-filter-bar__date {
  width: 200px;
}
</style>
