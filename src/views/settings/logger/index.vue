<!--
  @file index.vue
  @description 日志查看器主页面，使用时间轴卡片布局展示日志。
  首次加载在 onMounted 中触发初始日志拉取。
-->
<template>
  <div class="logger-view">
    <LogFilterBar v-model:value="dataItem" :count="entries.length" :available-dates="availableDates" @change="handleFilterChange" />
    <div class="logger-view__content">
      <BScrollbar inset="auto" @scroll="handleScroll">
        <div v-if="entries.length === 0 && !loading" class="log-empty">
          <div class="log-empty__text">暂无日志数据</div>
          <div class="log-empty__subtext">{{ emptyStateSubtext }}</div>
        </div>

        <div v-else class="log-timeline">
          <LogTimeline
            v-for="(entry, index) in entries"
            :key="`${entry.timestamp}-${entry.scope}-${index}`"
            :entry="entry"
            :is-first="index === 0"
            :is-last="index === entries.length - 1"
            :is-only="entries.length === 1"
          />
        </div>

        <div v-if="loading" class="log-loading">
          <ASpin />
        </div>
      </BScrollbar>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import dayjs from 'dayjs';
import { pickBy } from 'lodash-es';
import { logger } from '@/shared/logger';
import type { LogEntry, LogFileInfo, LogQueryOptions } from '@/shared/logger/types';
import LogFilterBar, { type LogFilterBarDataItem } from './components/LogFilterBar.vue';
import LogTimeline from './components/LogTimeline.vue';

/** 每页加载的日志条数。 */
const PAGE_SIZE = 100;
/** 当前加载的日志条目列表。 */
const entries = ref<LogEntry[]>([]);
/** 是否正在加载。 */
const loading = ref(false);

/**
 * 获取今天对应的日志筛选日期字符串。
 * @returns `YYYY-MM-DD` 格式的今天日期。
 */
function getTodayDate(): string {
  return dayjs().format('YYYY-MM-DD');
}

/** 当前筛选栏数据对象。 */
const dataItem = ref<LogFilterBarDataItem>({ level: '', keyword: '', date: getTodayDate() });
/** 当前存在日志数据的日期集合。 */
const availableDates = ref<string[]>([]);
/** 当前分页偏移量。 */
const offset = ref(0);
/** 是否还有更多日志。 */
const hasMore = ref(true);
/** 当前选中日期是否存在日志文件。 */
const hasLogsForSelectedDate = computed<boolean>(() => availableDates.value.includes(dataItem.value.date));
/** 当前是否存在除日期外的筛选条件。 */
const hasAdditionalFilters = computed<boolean>(() => Boolean(dataItem.value.level || dataItem.value.keyword));
/** 空状态副文案。 */
const emptyStateSubtext = computed<string>(() => {
  if (!hasLogsForSelectedDate.value) {
    return `${dataItem.value.date} 暂无日志数据`;
  }

  if (hasAdditionalFilters.value) {
    return '该日期下没有符合当前筛选条件的日志';
  }

  return `${dataItem.value.date} 暂无日志数据`;
});

/**
 * 从日志文件列表中提取存在数据的日期集合。
 * 支持 `tibis-YYYY-MM-DD.log` 与 `tibis-YYYY-MM-DD-序号.log` 两种命名。
 * @param files - 日志文件列表。
 * @returns 排序后的日期字符串数组。
 */
function extractAvailableDates(files: LogFileInfo[]): string[] {
  const availableDateValues = new Set<string>();

  for (const file of files) {
    const matchedDate = file.name.match(/^tibis-(\d{4}-\d{2}-\d{2})(?:-\d+)?\.log$/);
    if (matchedDate?.[1]) {
      availableDateValues.add(matchedDate[1]);
    }
  }

  return Array.from(availableDateValues).sort();
}

/**
 * 构建当前日志查询参数。
 * @param nextOffset - 本次请求的分页偏移量。
 * @returns 日志查询参数。
 */
function buildQueryOptions(nextOffset: number): LogQueryOptions {
  const { level, keyword, date } = dataItem.value;

  return pickBy({ level, keyword, date, limit: PAGE_SIZE, offset: nextOffset }, (value) => value !== '');
}

/**
 * 加载日志列表。
 * @param reset - 是否重置并从第一页开始加载。
 */
async function loadLogs(reset = false): Promise<void> {
  if (loading.value) return;
  loading.value = true;

  const nextOffset = reset ? 0 : offset.value;

  try {
    const result = await logger.getLogs(buildQueryOptions(nextOffset));

    if (reset) {
      entries.value = result;
      offset.value = result.length;
      hasMore.value = result.length >= PAGE_SIZE;
      return;
    }

    entries.value = [...entries.value, ...result];
    offset.value += result.length;
    hasMore.value = result.length >= PAGE_SIZE;
  } catch {
    // 加载失败时保持现有数据。
  } finally {
    loading.value = false;
  }
}

/**
 * 加载存在日志数据的日期集合。
 */
async function loadAvailableDates(): Promise<void> {
  try {
    availableDates.value = extractAvailableDates(await logger.getLogFiles());
  } catch {
    // 加载失败时保留空日期集合。
    availableDates.value = [];
  }
}

/**
 * 触底时尝试加载更多日志。
 */
function onLoadMore() {
  if (!hasMore.value || loading.value) return;
  loadLogs(false);
}

/**
 * 处理筛选条件变更并重置分页状态。
 * @param nextDataItem - 最新的筛选栏数据对象。
 */
function handleFilterChange() {
  offset.value = 0;
  hasMore.value = true;
  loadLogs(true);
}

/**
 * 处理滚动事件，触底时加载更多。
 * @param event - 滚动事件对象。
 */
function handleScroll(event: Event) {
  const target = event.target as HTMLElement;
  if (!target) return;

  const { scrollTop, scrollHeight, clientHeight } = target;
  if (scrollHeight - scrollTop - clientHeight < 50) {
    onLoadMore();
  }
}

onMounted(() => {
  loadAvailableDates();
  loadLogs(true);
});
</script>

<style scoped lang="less">
.logger-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  border-radius: 8px;
}

.logger-view__content {
  flex: 1;
  height: 0;
  padding: 24px;
}

.log-timeline {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.log-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 48px 0;

  &__text {
    margin-top: 16px;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  &__subtext {
    margin-top: 8px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-secondary);
  }
}

.log-loading {
  display: flex;
  justify-content: center;
  padding: 24px 0 12px;
}
</style>
