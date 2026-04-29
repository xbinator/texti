/**
 * @file logViewer.ts
 * @description 日志查看器 Pinia Store，管理日志条目列表、筛选状态和分页加载。
 */
import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import { logger } from '@/shared/logger';
import type { LogEntry, LogLevel, LogScope } from '@/shared/logger/types';

/** 每页加载的日志条数 */
const PAGE_SIZE = 100;

export const useLogViewerStore = defineStore('logViewer', () => {
  /** 当前加载的日志条目列表 */
  const entries = ref<LogEntry[]>([]);
  /** 是否正在加载 */
  const isLoading = ref(false);
  /** 日志级别筛选 */
  const filterLevel = ref<LogLevel | ''>('');
  /** 进程来源筛选 */
  const filterScope = ref<LogScope | ''>('');
  /** 关键字搜索 */
  const keyword = ref('');
  /** 选中的日志日期 */
  const selectedDate = ref('');
  /** 当前分页偏移量（过滤后结果集的偏移量，不是文件行号） */
  const offset = ref(0);
  /** 是否还有更多数据 */
  const hasMore = ref(true);

  /**
   * 构建当前查询参数
   */
  const queryOptions = computed(() => {
    const opts: Record<string, unknown> = {
      limit: PAGE_SIZE,
      offset: offset.value
    };
    if (filterLevel.value) opts.level = filterLevel.value;
    if (filterScope.value) opts.scope = filterScope.value;
    if (keyword.value) opts.keyword = keyword.value;
    if (selectedDate.value) opts.date = selectedDate.value;
    return opts;
  });

  /**
   * 加载日志条目
   * @param reset - 是否重置列表并从开头加载
   */
  async function loadLogs(reset = false): Promise<void> {
    if (isLoading.value) return;
    isLoading.value = true;

    const newOffset = reset ? 0 : entries.value.length;

    try {
      const result = await logger.getLogs({
        ...queryOptions.value,
        offset: newOffset
      } as Parameters<typeof logger.getLogs>[0]);

      if (reset) {
        entries.value = result;
        offset.value = result.length;
      } else {
        entries.value = [...entries.value, ...result];
        offset.value += result.length;
      }
      hasMore.value = result.length >= PAGE_SIZE;
    } catch {
      // 加载失败时保持现有数据
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 加载更多（触底滚动触发）
   */
  function loadMore(): void {
    if (!hasMore.value || isLoading.value) return;
    loadLogs(false);
  }

  /**
   * 设置日志级别筛选
   */
  function setLevel(level: LogLevel | ''): void {
    filterLevel.value = level;
    loadLogs(true);
  }

  /**
   * 设置进程来源筛选
   */
  function setScope(scope: LogScope | ''): void {
    filterScope.value = scope;
    loadLogs(true);
  }

  /**
   * 设置关键字搜索
   */
  function setKeyword(kw: string): void {
    keyword.value = kw;
    loadLogs(true);
  }

  /**
   * 设置查询日期
   */
  function setDate(date: string): void {
    selectedDate.value = date;
    loadLogs(true);
  }

  return {
    entries,
    isLoading,
    filterLevel,
    filterScope,
    keyword,
    selectedDate,
    offset,
    hasMore,
    loadLogs,
    loadMore,
    setLevel,
    setScope,
    setKeyword,
    setDate
  };
});
