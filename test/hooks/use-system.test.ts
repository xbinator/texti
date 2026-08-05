/**
 * @file use-system.test.ts
 * @description 系统级事件监听启动行为测试，覆盖文件打开与 WebView 新标签页路由。
 * @vitest-environment jsdom
 */
import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSystem } from '@/hooks/useSystem';

/** Electron 打开文件监听取消函数 mock。 */
const unregisterOpenFileListenerMock = vi.hoisted(() => vi.fn<() => void>());
/** Electron 打开文件监听注册 mock。 */
const onOpenFileMock = vi.hoisted(() => vi.fn<() => () => void>(() => unregisterOpenFileListenerMock));
/** WebView 新标签页监听取消函数 mock。 */
const unregisterWebviewNewTabListenerMock = vi.hoisted(() => vi.fn<() => void>());
/** WebView 新标签页监听注册 mock。 */
const onOpenInNewTabMock = vi.hoisted(
  () => vi.fn<(callback: (url: string) => void) => () => void>(() => unregisterWebviewNewTabListenerMock)
);
/** Electron API 可用性开关。 */
const electronAvailable = vi.hoisted(() => ({ value: true }));
/** 打开文件能力 mock。 */
const openFileByPathMock = vi.hoisted(() => vi.fn<(filePath: string) => Promise<void>>().mockResolvedValue(undefined));
/** 记忆加载 mock。 */
const loadMemoryMock = vi.hoisted(() => vi.fn<() => Promise<void>>().mockResolvedValue(undefined));
/** 路由 push mock。 */
const routerPushMock = vi.hoisted(() => vi.fn<(location: unknown) => Promise<void>>().mockResolvedValue(undefined));

vi.mock('@/shared/platform/electron-api', () => ({
  hasElectronAPI: (): boolean => electronAvailable.value,
  getElectronAPI: () => ({
    onOpenFile: onOpenFileMock,
    webview: {
      onOpenInNewTab: onOpenInNewTabMock
    }
  })
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: routerPushMock
  })
}));

vi.mock('@/hooks/useNavigate', () => ({
  useNavigate: () => ({
    openFileByPath: openFileByPathMock
  })
}));

vi.mock('@/stores/ai/memory', () => ({
  useMemoryStore: () => ({
    loadMemory: loadMemoryMock
  })
}));

/** useSystem 测试宿主组件。 */
const UseSystemHost = defineComponent({
  name: 'UseSystemHost',
  setup() {
    useSystem();
    return () => null;
  }
});

describe('useSystem', (): void => {
  beforeEach((): void => {
    electronAvailable.value = true;
    unregisterOpenFileListenerMock.mockClear();
    onOpenFileMock.mockClear();
    unregisterWebviewNewTabListenerMock.mockClear();
    onOpenInNewTabMock.mockClear();
    openFileByPathMock.mockClear();
    loadMemoryMock.mockClear();
    routerPushMock.mockClear();
  });

  it('registers system file listeners without loading memory during app startup', (): void => {
    const wrapper = mount(UseSystemHost);

    expect(onOpenFileMock).toHaveBeenCalledTimes(1);
    expect(loadMemoryMock).not.toHaveBeenCalled();

    wrapper.unmount();
    expect(unregisterOpenFileListenerMock).toHaveBeenCalledTimes(1);
  });

  it('routes WebView new-tab requests to the webview-web route and unregisters on dispose', (): void => {
    const wrapper = mount(UseSystemHost);
    const callback = onOpenInNewTabMock.mock.calls[0]?.[0];
    const targetUrl = 'https://example.com/path?query=value';

    expect(callback).toBeDefined();
    callback?.(targetUrl);
    expect(routerPushMock).toHaveBeenCalledWith({
      name: 'webview-web',
      query: { url: encodeURIComponent(targetUrl) }
    });

    wrapper.unmount();
    expect(unregisterWebviewNewTabListenerMock).toHaveBeenCalledTimes(1);
  });

  it('does not register listeners outside Electron', (): void => {
    electronAvailable.value = false;

    const wrapper = mount(UseSystemHost);

    expect(onOpenFileMock).not.toHaveBeenCalled();
    expect(onOpenInNewTabMock).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
