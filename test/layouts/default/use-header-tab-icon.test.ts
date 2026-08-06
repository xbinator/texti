/**
 * @file use-header-tab-icon.test.ts
 * @description 验证 HeaderTab 图标属性解析 Hook 的优先级与 WebView recent 兼容匹配。
 */
import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHeaderTabIcon } from '@/layouts/default/hooks/useHeaderTabIcon';
import type { RecentRecord } from '@/shared/storage';
import type { Tab } from '@/stores/workspace/tabs';

/** 最近记录列表 mock。 */
const recentRecordsMock = vi.hoisted<{ value: RecentRecord[] }>(() => ({ value: [] }));

vi.mock('@/stores/workspace/recent', () => ({
  useRecentStore: (): { recentRecords: RecentRecord[] } => ({
    get recentRecords(): RecentRecord[] {
      return recentRecordsMock.value;
    }
  })
}));

/**
 * 创建标签页测试数据。
 * @param overrides - 需要覆盖的标签字段
 * @returns 标签页数据
 */
function createTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 'tab-a',
    path: '/welcome',
    title: '欢迎',
    cacheKey: 'tab-a',
    ...overrides
  };
}

/**
 * 创建文件最近记录。
 * @param overrides - 需要覆盖的字段
 * @returns 文件最近记录
 */
function createFileRecord(overrides: Partial<Extract<RecentRecord, { type: 'file' }>> = {}): Extract<RecentRecord, { type: 'file' }> {
  return {
    type: 'file',
    id: 'file-a',
    url: '/editor/file-a',
    title: 'note.md',
    description: '/tmp/note.md',
    path: '/tmp/note.md',
    content: '',
    savedContent: '',
    name: 'note',
    ext: 'md',
    ...overrides
  };
}

/**
 * 创建 Widget 最近记录。
 * @param overrides - 需要覆盖的字段
 * @returns Widget 最近记录
 */
function createWidgetRecord(overrides: Partial<Extract<RecentRecord, { type: 'widget' }>> = {}): Extract<RecentRecord, { type: 'widget' }> {
  return {
    type: 'widget',
    id: 'widget-weather',
    url: '/widget/widget-weather',
    title: 'widget.json',
    description: '/home/user/.tibis/widgets/weather/widget.json',
    path: '/home/user/.tibis/widgets/weather/widget.json',
    content: '',
    savedContent: '',
    name: 'widget',
    ext: 'json',
    ...overrides
  };
}

/**
 * 创建 WebView 最近记录。
 * @param overrides - 需要覆盖的字段
 * @returns WebView 最近记录
 */
function createWebviewRecord(overrides: Partial<Extract<RecentRecord, { type: 'webview' }>> = {}): Extract<RecentRecord, { type: 'webview' }> {
  return {
    type: 'webview',
    id: 'web-a',
    url: 'https://example.com/path',
    title: 'Example',
    description: 'https://example.com/path',
    createdAt: 1,
    openedAt: 2,
    favicon: 'https://example.com/favicon.ico',
    ...overrides
  };
}

describe('useHeaderTabIcon', (): void => {
  beforeEach((): void => {
    recentRecordsMock.value = [];
  });

  it('uses configured tab icons before recent records or title inference', (): void => {
    const tab = ref(createTab({ icon: 'lucide:settings', recentKey: 'file:file-a', title: 'package.json' }));
    recentRecordsMock.value = [createFileRecord()];

    const iconProps = useHeaderTabIcon(tab);

    expect(iconProps.value).toEqual({
      record: undefined,
      fileName: '',
      icon: 'lucide:settings'
    });
  });

  it('uses explicit recentKey to resolve document records', (): void => {
    const record = createFileRecord({ id: 'file-a', title: 'note.md' });
    const tab = ref(createTab({ recentKey: 'file:file-a', title: 'Preview' }));
    recentRecordsMock.value = [record];

    const iconProps = useHeaderTabIcon(tab);

    expect(iconProps.value.record).toBe(record);
    expect(iconProps.value.fileName).toBe('');
    expect(iconProps.value.icon).toBe('');
  });

  it('uses the blocks icon for widget tabs instead of the widget.json record icon', (): void => {
    const tab = ref(createTab({ path: '/widget/widget-weather', recentKey: 'widget:widget-weather', title: 'widget.json' }));
    recentRecordsMock.value = [createWidgetRecord()];

    const iconProps = useHeaderTabIcon(tab);

    expect(iconProps.value).toEqual({
      record: undefined,
      fileName: '',
      icon: 'lucide:blocks'
    });
  });

  it('matches WebView records by decoded route URL when recentKey is absent', (): void => {
    const record = createWebviewRecord();
    const encodedUrl = encodeURIComponent(record.url);
    const tab = ref(createTab({ path: `/webview/web?url=${encodeURIComponent(encodedUrl)}`, title: 'Example' }));
    recentRecordsMock.value = [record];

    const iconProps = useHeaderTabIcon(tab);

    expect(iconProps.value.record).toBe(record);
    expect(iconProps.value.icon).toBe('');
    expect(iconProps.value.fileName).toBe('');
  });

  it('uses the WebView fallback icon when route URL has no recent record yet', (): void => {
    const tab = ref(createTab({ path: '/webview/web?url=https%253A%252F%252Fexample.com', title: 'Example' }));

    const iconProps = useHeaderTabIcon(tab);

    expect(iconProps.value).toEqual({
      record: undefined,
      fileName: '',
      icon: 'vscode-icons:file-type-geojson'
    });
  });

  it('uses the tab title for non-WebView tabs without recent records', (): void => {
    const tab = ref(createTab({ path: '/settings/provider', title: 'settings.json' }));

    const iconProps = useHeaderTabIcon(tab);

    expect(iconProps.value).toEqual({
      record: undefined,
      fileName: 'settings.json',
      icon: ''
    });
  });
});
