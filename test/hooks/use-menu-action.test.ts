/**
 * @file use-menu-action.test.ts
 * @description 验证系统菜单 action 分发到应用内部事件。
 * @vitest-environment jsdom
 */
import { defineComponent, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMenuAction } from '@/hooks/useMenuAction';
import { emitter } from '@/utils/emitter';

/** 系统菜单 action 回调。 */
let menuActionCallback: ((_action: string) => void) | undefined;
/** 系统菜单监听 mock。 */
const onMenuActionMock = vi.hoisted(() => vi.fn<(_callback: (_action: string) => void) => () => void>());
/** 设置初始化 mock。 */
const settingInitMock = vi.hoisted(() => vi.fn<() => void>());
/** 原生菜单状态同步 mock。 */
const syncNativeMenuStateMock = vi.hoisted(() => vi.fn<() => void>());

vi.mock('@/shared/platform', () => ({
  native: {
    onMenuAction: onMenuActionMock
  }
}));

vi.mock('@/stores/ui/setting', () => ({
  useSettingStore: () => ({
    init: settingInitMock,
    setTheme: vi.fn<(_theme: 'light' | 'dark' | 'system') => void>()
  })
}));

vi.mock('@/stores/editor/preferences', () => ({
  useEditorPreferencesStore: () => ({
    viewMode: 'rich',
    syncNativeMenuState: syncNativeMenuStateMock,
    setViewMode: vi.fn<(_mode: 'rich' | 'source') => void>(),
    setShowOutline: vi.fn<(_show: boolean) => void>(),
    setPageWidth: vi.fn<(_width: 'default' | 'wide' | 'full') => void>()
  })
}));

/**
 * 挂载系统菜单 action hook 测试组件。
 * @returns 组件 wrapper
 */
function mountMenuAction(): VueWrapper {
  return mount(
    defineComponent({
      setup() {
        useMenuAction();

        return () => null;
      }
    })
  );
}

describe('useMenuAction', (): void => {
  beforeEach((): void => {
    menuActionCallback = undefined;
    settingInitMock.mockClear();
    syncNativeMenuStateMock.mockClear();
    onMenuActionMock.mockReset();
    onMenuActionMock.mockImplementation((callback: (_action: string) => void): (() => void) => {
      menuActionCallback = callback;

      return (): void => undefined;
    });
  });

  it('dispatches tab close menu actions as tab close events', async (): Promise<void> => {
    const tabCloseHandler = vi.fn<() => void>();
    const unregister = emitter.on('tab:close', tabCloseHandler);
    const wrapper = mountMenuAction();
    await nextTick();

    menuActionCallback?.('tab:close');

    expect(tabCloseHandler).toHaveBeenCalledTimes(1);
    unregister();
    wrapper.unmount();
  });
});
