<!--
  @file LogFilterBar.vue
  @description 日志过滤工具栏，保留日志标题、记录总数、打开目录，以及关键词与日期筛选能力。
-->
<template>
  <div class="log-toolbar">
    <div class="log-header">
      <div class="log-header-title">
        <h3>运行日志</h3>
        <span class="log-header-count">共 {{ count }} 条记录</span>
      </div>
      <div class="log-header-actions">
        <BButton icon="lucide:folder-open" type="text" @click="handleOpenLogFolder"> 打开目录 </BButton>
      </div>
    </div>

    <div class="log-filter-bar">
      <BSelect v-model:value="value.level" placeholder="日志级别" default-value="" :width="140" @change="handleLevelChange">
        <ASelectOption value=""> 全部 </ASelectOption>
        <ASelectOption value="ERROR"> 错误 </ASelectOption>
        <ASelectOption value="WARN"> 警告 </ASelectOption>
        <ASelectOption value="INFO"> 信息 </ASelectOption>
      </BSelect>
      <AInput v-model:value="value.keyword" placeholder="搜索日志内容..." allow-clear class="log-filter-bar__input" @change="handleKeywordChange" />

      <ADatePicker
        v-model:value="value.date"
        input-read-only
        placeholder="选择日期"
        class="log-filter-bar__date"
        value-format="YYYY-MM-DD"
        :allow-clear="false"
        :disabled-date="disabledDate"
        @change="handleDateChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Dayjs } from 'dayjs';
import { computed } from 'vue';
import { logger } from '@/shared/logger';
import type { LogLevel } from '@/shared/logger/types';

/**
 * 日志筛选栏数据对象。
 */
export interface LogFilterBarDataItem {
  /** 当前日志级别筛选。 */
  level: LogLevel | '';
  /** 当前关键词筛选。 */
  keyword: string;
  /** 当前日期筛选。 */
  date: string;
}
/**
 * 组件属性定义。
 */
interface Props {
  /** 当前页面已加载的日志条数。 */
  count?: number;
  /** 当前筛选栏数据对象。 */
  value: LogFilterBarDataItem;
  /** 当前存在日志数据的日期集合。 */
  availableDates?: string[];
}

const props = withDefaults(defineProps<Props>(), {
  count: 0,
  availableDates: () => []
});

const emit = defineEmits<{
  /** 同步最新筛选栏数据。 */
  (e: 'update:value', value: LogFilterBarDataItem): void;
  /** 通知父组件刷新日志列表。 */
  (e: 'change', value: LogFilterBarDataItem): void;
}>();

/** 当前筛选栏数据对象。 */
const value = computed<LogFilterBarDataItem>(() => props.value);
/** 可选择日期集合。 */
const availableDateSet = computed<Set<string>>(() => new Set(props.availableDates));

/**
 * 向父组件同步筛选栏数据，并触发一次刷新通知。
 * @param nextValue - 最新筛选栏数据。
 */
function emitFilterChange(nextValue: LogFilterBarDataItem): void {
  emit('update:value', nextValue);
  emit('change', nextValue);
}

/**
 * 处理日志级别变更。
 * @param level - 最新日志级别。
 */
function handleLevelChange(level: unknown): void {
  emitFilterChange({ ...value.value, level: level as LogLevel | '' });
}

/**
 * 处理关键词变更。
 * @param e - 输入事件。
 */
function handleKeywordChange(e: Event): void {
  const keyword = (e.target as HTMLInputElement).value;
  emitFilterChange({ ...value.value, keyword });
}

/**
 * 处理日期变更。
 * 当日期组件试图清空值时，保持当前日期不变。
 * @param date - 最新日期字符串或 Dayjs 对象。
 */
function handleDateChange(date: string | Dayjs | undefined): void {
  if (!date) return;
  const dateStr = typeof date === 'string' ? date : date.format('YYYY-MM-DD');
  emitFilterChange({ ...value.value, date: dateStr });
}

/**
 * 禁用没有日志数据的日期。
 * @param current - 当前渲染的日期对象。
 * @returns `true` 表示禁用。
 */
function disabledDate(current: Dayjs): boolean {
  return !availableDateSet.value.has(current.format('YYYY-MM-DD'));
}

/**
 * 打开本地日志目录。
 */
function handleOpenLogFolder(): void {
  logger.openLogFolder();
}
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
