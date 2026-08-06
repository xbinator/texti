<!--
  @file LogFilterBar.vue
  @description 日志过滤工具栏，提供日志级别、关键词与日期筛选能力。
-->
<template>
  <div class="log-filter-bar">
    <BSelect v-model:value="value.level" placeholder="日志级别" default-value="" :width="140" :options="levels" @change="handleLevelChange" />

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
</template>

<script setup lang="ts">
import { computed } from 'vue';
import dayjs, { type Dayjs } from 'dayjs';
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
  /** 当前筛选栏数据对象。 */
  value: LogFilterBarDataItem;
  /** 当前存在日志数据的日期集合。 */
  availableDates?: string[];
}

const props = withDefaults(defineProps<Props>(), {
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

const levels = [
  { value: '', label: '全部' },
  { value: 'ERROR', label: '错误' },
  { value: 'WARN', label: '警告' },
  { value: 'INFO', label: '信息' }
];

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
 * 禁用没有日志数据的日期，但当天始终可选。
 * @param current - 当前渲染的日期对象。
 * @returns `true` 表示禁用。
 */
function disabledDate(current: Dayjs): boolean {
  const dateStr = current.format('YYYY-MM-DD');
  if (dateStr === dayjs().format('YYYY-MM-DD')) return false;
  return !availableDateSet.value.has(dateStr);
}
</script>

<style scoped lang="less">
.log-filter-bar {
  display: flex;
  gap: 12px;
  align-items: center;

  // 日志级别下拉框及其内部节点
  & :deep(.b-select) {
    height: 28px;
    font-size: 12px;

    .ant-select-selector {
      box-sizing: border-box;
      height: 28px;
      min-height: 28px;
      font-size: 12px;
    }

    .ant-select-selection-item,
    .ant-select-selection-placeholder {
      font-size: 12px;
      line-height: 26px;
    }
  }

  // 关键词输入框及其内部节点
  .log-filter-bar__input {
    box-sizing: border-box;
    height: 28px;
    font-size: 12px;

    :deep(.ant-input) {
      font-size: 12px;
    }
  }

  // 日期选择器及其内部节点
  .log-filter-bar__date {
    box-sizing: border-box;
    width: 200px;
    height: 28px;
    font-size: 12px;

    :deep(.ant-picker-input > input) {
      font-size: 12px;
    }
  }
}
</style>
