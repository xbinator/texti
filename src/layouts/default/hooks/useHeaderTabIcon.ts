/**
 * @file useHeaderTabIcon.ts
 * @description 统一解析 HeaderTab 最近记录图标、文件名图标与 WebView 回退图标属性。
 */
import { computed, type ComputedRef, type Ref } from 'vue';
import type { RecentRecord, WebviewRecord } from '@/shared/storage';
import { createRecentKey } from '@/shared/storage';
import { useRecentStore } from '@/stores/workspace/recent';
import type { Tab } from '@/stores/workspace/tabs';
import { WEB_RECORD_ICON } from '@/utils/file/icons';

/** Widget 标签页使用固定的工具图标，避免落到 widget.json 文件图标。 */
const WIDGET_TAB_ICON = 'lucide:blocks';

/**
 * HeaderTab 传给 BRecentIcon 的图标属性。
 */
export interface HeaderTabIconProps {
  /** 命中的最近记录。 */
  record?: RecentRecord;
  /** 用于文件图标推断的文件名。 */
  fileName: string;
  /** 显式 Iconify 图标名。 */
  icon: string;
}

/**
 * 判断标签页路径是否来自 WebView 路由。
 * @param path - 标签页路由路径
 * @returns 是否为 WebView 标签页路径
 */
function isWebviewPath(path: string): boolean {
  return path.startsWith('/webview/');
}

/**
 * 判断标签页路径是否来自 Widget 编辑器路由。
 * @param path - 标签页路由路径
 * @returns 是否为 Widget 标签页路径
 */
function isWidgetPath(path: string): boolean {
  return path.startsWith('/widget/');
}

/**
 * 安全解码路由 query 值。
 * @param value - query 字段值
 * @returns 解码后的字段值
 */
function decodeRouteQuery(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 从 WebView 标签页路径解析原始 URL。
 * @param path - 标签页路由路径
 * @returns WebView URL；非 WebView 路由或缺失 URL 时返回空字符串
 */
function getWebviewUrl(path: string): string {
  if (!isWebviewPath(path)) return '';

  const queryStartIndex = path.indexOf('?');
  if (queryStartIndex === -1) return '';

  const query = path.slice(queryStartIndex + 1);
  const url = new URLSearchParams(query).get('url') ?? '';

  return url ? decodeRouteQuery(url).trim() : '';
}

/**
 * 读取标签显式配置图标。
 * @param tab - 标签页
 * @returns Iconify 图标名，未配置时返回空字符串
 */
function getConfiguredIcon(tab: Tab): string {
  return tab.icon?.trim() ?? '';
}

/**
 * 根据标签页 recentKey 或 WebView URL 匹配最近记录。
 * @param tab - 标签页
 * @param recordsByKey - 最近记录稳定键索引
 * @param webviewsByUrl - WebView URL 索引
 * @returns 命中的最近记录
 */
function getRecentRecord(
  tab: Tab,
  recordsByKey: ReadonlyMap<string, RecentRecord>,
  webviewsByUrl: ReadonlyMap<string, WebviewRecord>
): RecentRecord | undefined {
  const recentKey = tab.recentKey?.trim() ?? '';
  const record = recentKey ? recordsByKey.get(recentKey) : undefined;
  if (record) return record;

  const webviewUrl = getWebviewUrl(tab.path);
  return webviewUrl ? webviewsByUrl.get(webviewUrl) : undefined;
}

/**
 * 解析 HeaderTab 传给 BRecentIcon 的属性。
 * @param tabRef - 标签页响应式引用
 * @returns BRecentIcon 属性
 */
export function useHeaderTabIcon(tabRef: Ref<Tab>): ComputedRef<HeaderTabIconProps> {
  const recentStore = useRecentStore();

  /** 最近记录稳定键索引。 */
  const recordsByKey = computed<Map<string, RecentRecord>>(() => {
    const entries = (recentStore.recentRecords ?? []).map((record: RecentRecord): [string, RecentRecord] => [createRecentKey(record), record]);

    return new Map(entries);
  });

  /** WebView URL 索引，兼容 WebView recent 记录晚于 tab 创建的场景。 */
  const webviewsByUrl = computed<Map<string, WebviewRecord>>(() => {
    const entries = (recentStore.recentRecords ?? [])
      .filter((record: RecentRecord): record is WebviewRecord => record.type === 'webview')
      .map((record: WebviewRecord): [string, WebviewRecord] => [record.url, record]);

    return new Map(entries);
  });

  return computed<HeaderTabIconProps>(() => {
    const tab = tabRef.value;
    const configuredIcon = getConfiguredIcon(tab);
    if (configuredIcon) {
      return { record: undefined, fileName: '', icon: configuredIcon };
    }

    if (isWidgetPath(tab.path)) {
      return { record: undefined, fileName: '', icon: WIDGET_TAB_ICON };
    }

    const record = getRecentRecord(tab, recordsByKey.value, webviewsByUrl.value);
    if (record) {
      return { record, fileName: '', icon: '' };
    }

    if (isWebviewPath(tab.path)) {
      return { record: undefined, fileName: '', icon: WEB_RECORD_ICON };
    }

    return { record: undefined, fileName: tab.title, icon: '' };
  });
}
