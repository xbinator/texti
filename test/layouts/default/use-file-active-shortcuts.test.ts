/**
 * @file use-file-active-shortcuts.test.ts
 * @description 验证默认布局文件菜单的新建文档快捷键。
 * @vitest-environment jsdom
 */
import { defineComponent, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileActive } from '@/layouts/default/hooks/useFileActive';

/** 新建文档导航 mock。 */
const createNewFileMock = vi.hoisted(() => vi.fn<() => Promise<void>>().mockResolvedValue(undefined));
/** 原生打开文件 mock。 */
const openNativeFileMock = vi.hoisted(() => vi.fn<() => Promise<void>>().mockResolvedValue(undefined));
/** 通过 ID 打开文件 mock。 */
const openFileByIdMock = vi.hoisted(() => vi.fn<(_id: string) => Promise<void>>().mockResolvedValue(undefined));
/** 最近文件面板打开 mock。 */
const openRecentMock = vi.hoisted(() => vi.fn<() => void>());
/** 最近文件查询 mock。 */
const getFileByIdMock = vi.hoisted(() => vi.fn<(_id: string) => Promise<null>>().mockResolvedValue(null));

vi.mock('@/hooks/useNavigate', () => ({
  useNavigate: () => ({
    createNewFile: createNewFileMock,
    openNativeFile: openNativeFileMock,
    openFileById: openFileByIdMock
  })
}));

vi.mock('@/stores/ui/commandPanel', () => ({
  useCommandPanelStore: () => ({
    openRecent: openRecentMock
  })
}));

vi.mock('@/stores/workspace/recent', () => ({
  useRecentStore: () => ({
    getFileById: getFileByIdMock
  })
}));

vi.mock('@/shared/platform/env', () => ({
  isElectron: (): boolean => false,
  isMac: (): boolean => false
}));

/**
 * 派发窗口键盘事件。
 * @param type - 键盘事件类型
 * @param options - 键盘事件参数
 */
function dispatchWindowKeyboardEvent(type: 'keydown' | 'keyup', options: KeyboardEventInit): void {
  window.dispatchEvent(
    new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      ...options
    })
  );
}

/**
 * 挂载文件菜单 hook 测试组件。
 * @returns 组件 wrapper
 */
function mountFileActive(): VueWrapper {
  return mount(
    defineComponent({
      setup() {
        useFileActive();

        return () => null;
      }
    }),
    { attachTo: document.body }
  );
}

describe('useFileActive shortcuts', (): void => {
  beforeEach((): void => {
    createNewFileMock.mockClear();
    openNativeFileMock.mockClear();
    openFileByIdMock.mockClear();
    openRecentMock.mockClear();
    getFileByIdMock.mockClear();
  });

  it('creates a new document from Ctrl N like the welcome action', async (): Promise<void> => {
    const wrapper = mountFileActive();

    dispatchWindowKeyboardEvent('keydown', { key: 'Control', ctrlKey: true });
    dispatchWindowKeyboardEvent('keydown', { key: 'n', ctrlKey: true });
    await nextTick();

    expect(createNewFileMock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
