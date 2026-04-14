import { onMounted, onUnmounted, watch } from 'vue';
import type { Ref } from 'vue';
import { flattenDeep } from 'lodash-es';
import type { DropdownOption, DropdownOptionDivider, DropdownOptionItem } from '@/components/BDropdown/type';
import type { ToolbarOption, ToolbarOptions } from '@/components/BToolbar/types';
import { isMac } from '@/shared/platform/env';

interface UseNativeMenuOptions {
  toolbarFileOptions: Ref<ToolbarOptions>;
  toolbarEditOptions: Ref<ToolbarOptions>;
  toolbarViewOptions: Ref<ToolbarOptions>;
  toolbarHelpOptions: Ref<ToolbarOptions>;
  visible: { recentSearch: boolean };
}

type MenuOptionItem = ToolbarOption | DropdownOptionItem;
type MenuOptions = Array<MenuOptionItem | DropdownOptionDivider>;
type ClickHandler = () => void | Promise<void>;

// ========== 辅助方法 ==========

const isItem = (opt: DropdownOption): opt is DropdownOptionItem => opt.type !== 'divider';

/**
 * 将多层嵌套的菜单项展开为一维数组
 */
function flattenMenuOptions(options: MenuOptions): DropdownOptionItem[] {
  return flattenDeep(
    options.map((opt) => {
      if (!isItem(opt)) return [];
      return [opt, opt.children ? flattenMenuOptions(opt.children) : []];
    })
  ) as DropdownOptionItem[];
}

/**
 * 扁平化提取带前缀的点击事件
 * 例如把 value: 'new' 提取为 { 'file:new': handler }
 */
function extractHandlers(prefix: string, options: MenuOptions = []): Record<string, ClickHandler> {
  const result: Record<string, ClickHandler> = {};

  flattenMenuOptions(options).forEach((opt) => {
    if (opt.onClick) {
      result[`${prefix}${opt.value}`] = opt.onClick;
    }
  });

  return result;
}

/**
 * 提取所有的菜单点击事件
 */
function buildAllHandlers(options: UseNativeMenuOptions): Record<string, ClickHandler> {
  const themeItem = options.toolbarViewOptions.value.find((v): v is ToolbarOption => isItem(v) && v.value === 'theme');

  return {
    ...extractHandlers('file:', options.toolbarFileOptions.value),
    ...extractHandlers('edit:', options.toolbarEditOptions.value),
    ...extractHandlers('view:', options.toolbarViewOptions.value),
    ...extractHandlers('theme:', themeItem?.children),
    ...extractHandlers('help:', options.toolbarHelpOptions.value),

    // 特殊拦截事件
    'file:recent': () => {
      options.visible.recentSearch = true;
    }
  };
}

/**
 * 同步视图和主题的选中状态到原生菜单
 */
function syncMenuCheckState(viewOptions: ToolbarOptions) {
  const { electronAPI } = window;
  if (!electronAPI?.updateMenuItem) return;

  // 使用 flatten 处理嵌套结构
  const allItems = flattenMenuOptions(viewOptions);

  allItems.forEach((opt) => {
    // 兼容可能存在的不同选中属性字段 (如 selected)
    const { selected } = opt as any;
    if (typeof selected === 'boolean') {
      // 区分 theme 的前缀
      const isThemeItem = typeof opt.value === 'string' && ['light', 'dark', 'system'].includes(opt.value);
      const prefix = isThemeItem ? 'theme:' : 'view:';

      electronAPI.updateMenuItem(`${prefix}${opt.value}`, { checked: selected });
    }
  });
}

// ========== 主 Hook ==========

export function useNativeMenu(options: UseNativeMenuOptions) {
  if (!isMac()) return;

  let cleanupMenuListener: (() => void) | undefined;

  onMounted(() => {
    const { electronAPI } = window;
    if (!electronAPI) return;

    // 1. 注册菜单点击监听
    if (electronAPI.onMenuAction) {
      cleanupMenuListener = electronAPI.onMenuAction((action: string) => {
        const handlers = buildAllHandlers(options);
        const handler = handlers[action];
        if (handler) handler();
      });
    }

    // 2. 监听状态变化并同步 checkbox 选中状态
    watch(
      () => options.toolbarViewOptions.value,
      (viewOptions) => syncMenuCheckState(viewOptions),
      { immediate: true, deep: true }
    );
  });

  onUnmounted(() => {
    cleanupMenuListener?.();
  });
}
