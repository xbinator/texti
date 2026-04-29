<!--
  @file LogFilterBar.vue
  @description 日志过滤工具栏，提供级别筛选、来源筛选、搜索和文件夹打开功能。
  交互直接调用 Pinia Store，不通过父组件中转。
-->
<template>
  <div class="log-toolbar">
    <div class="log-header">
      <div class="log-header-title">
        <h3>运行日志</h3>
        <span class="log-header-count">共 {{ store.entries.length }} 条记录</span>
      </div>
      <div class="log-header-actions">
        <BButton icon="lucide:refresh-cw" type="text" @click="store.loadLogs(true)"> 刷新 </BButton>
        <BButton icon="lucide:folder-open" type="text" @click="logger.openLogFolder()"> 打开目录 </BButton>
      </div>
    </div>

    <div class="log-filter-bar">
      <ARadioGroup v-model:value="levelModel">
        <ARadioButton value=""> 全部 </ARadioButton>
        <ARadioButton value="ERROR"> 错误 </ARadioButton>
        <ARadioButton value="WARN"> 警告 </ARadioButton>
        <ARadioButton value="INFO"> 信息 </ARadioButton>
      </ARadioGroup>

      <BSelect v-model:value="scopeModel" placeholder="全部来源" allow-clear style="width: 148px">
        <ASelectOption value=""> 全部来源 </ASelectOption>
        <ASelectOption value="main"> 主进程 </ASelectOption>
        <ASelectOption value="renderer"> 渲染进程 </ASelectOption>
        <ASelectOption value="preload"> 预加载脚本 </ASelectOption>
      </BSelect>

      <ADatePicker v-model:value="dateModel" placeholder="选择日期" style="width: 168px" value-format="YYYY-MM-DD" />

      <div class="log-filter-bar-spacer"></div>

      <AInputSearch v-model:value="keywordModel" placeholder="搜索日志内容..." allow-clear style="width: 320px" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { logger } from '@/shared/logger';
import { useLogViewerStore } from '../stores/logViewer';

/** 日志查看器全局状态 */
const store = useLogViewerStore();

/** 级别筛选 v-model 计算属性 */
const levelModel = computed({
  get: () => store.filterLevel,
  set: (val: 'ERROR' | 'WARN' | 'INFO' | '') => store.setLevel(val)
});

/** 来源筛选 v-model 计算属性 */
const scopeModel = computed({
  get: () => store.filterScope,
  set: (val: 'main' | 'renderer' | 'preload' | '') => store.setScope(val)
});

/** 日期筛选 v-model 计算属性 */
const dateModel = computed({
  get: () => store.selectedDate || undefined,
  set: (val: string | undefined) => store.setDate(val || '')
});

/** 关键字搜索 v-model 计算属性 */
const keywordModel = computed({
  get: () => store.keyword,
  set: (val: string) => store.setKeyword(val)
});
</script>

<style scoped lang="less">
.log-toolbar {
  padding: 18px 20px 0;
}

.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 16px;
}

.log-header-title {
  display: flex;
  gap: 12px;
  align-items: baseline;
}

.log-header-title h3 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
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
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 18px;
}

.log-filter-bar-spacer {
  flex: 1;
}
</style>
