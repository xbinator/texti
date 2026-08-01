<!--
  @file HeaderTabMenu.vue
  @description 顶部标签页单例右键菜单，负责打开状态、定位、菜单项生成和命令执行。
-->
<template>
  <div v-if="menuState.open" ref="menuRef" class="header-tab-menu" role="menu" :style="menuStyle" @contextmenu.prevent @pointerdown.stop>
    <template v-for="item in menuItems" :key="item.key">
      <div v-if="item.type === 'divider'" class="header-tab-menu__divider" role="separator"></div>
      <button v-else type="button" class="header-tab-menu__item" :class="{ 'is-danger': item.danger }" :disabled="item.disabled" @click="handleItemClick(item)">
        <span class="header-tab-menu__label">{{ item.label }}</span>
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * @file HeaderTabMenu.vue
 * @description 顶部标签右键菜单交互逻辑，单实例按浏览器坐标定位并执行标签菜单命令。
 */
import type { CSSProperties } from 'vue';
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useClipboard } from '@/hooks/useClipboard';
import { useTabCloseGuard } from '@/layouts/default/hooks/useTabCloseGuard';
import type { HeaderTabCopyCommand, HeaderTabMenuCommand } from '@/layouts/default/utils/headerTabMenu';
import { getHeaderTabCopyAction } from '@/layouts/default/utils/headerTabMenu';
import { isBlockingNavigationFailure } from '@/router/navigation';
import { useRecentStore } from '@/stores/workspace/recent';
import { useTabsStore } from '@/stores/workspace/tabs';
import type { Tab, TabCloseAction } from '@/stores/workspace/tabs';
import { asyncTo } from '@/utils/asyncTo';

/** 菜单与视口边缘之间保留的最小距离。 */
const HEADER_TAB_MENU_VIEWPORT_PADDING = 8;

/**
 * 顶部标签菜单项。
 */
interface HeaderTabMenuItem {
  /** 菜单项类型。 */
  type?: 'item';
  /** 菜单命令。 */
  key: HeaderTabMenuCommand;
  /** 展示文案。 */
  label: string;
  /** 是否禁用当前项。 */
  disabled?: boolean;
  /** 是否使用危险态样式。 */
  danger?: boolean;
}

/**
 * 顶部标签菜单分割线。
 */
interface HeaderTabMenuDivider {
  /** 菜单项类型。 */
  type: 'divider';
  /** 分割线唯一标识。 */
  key: string;
}

/**
 * 顶部标签菜单条目。
 */
type HeaderTabMenuEntry = HeaderTabMenuItem | HeaderTabMenuDivider;

/**
 * 顶部标签菜单支持的关闭动作。
 */
type HeaderTabCloseCommand = Extract<TabCloseAction, HeaderTabMenuCommand>;

/**
 * 顶部标签菜单浏览器坐标。
 */
interface HeaderTabMenuPosition {
  /** 横向坐标。 */
  x: number;
  /** 纵向坐标。 */
  y: number;
}

/**
 * 顶部标签菜单状态。
 */
interface HeaderTabMenuState {
  /** 是否打开菜单。 */
  open: boolean;
  /** 当前右键命中的标签 ID。 */
  tabId: string | null;
  /** 菜单浏览器坐标。 */
  position: HeaderTabMenuPosition;
}

/**
 * HeaderTabMenu 尺寸。
 */
interface HeaderTabMenuSize {
  /** 菜单宽度。 */
  width: number;
  /** 菜单高度。 */
  height: number;
}

/**
 * 标签关闭菜单配置。
 */
interface CloseMenuConfig {
  /** 关闭动作。 */
  action: HeaderTabCloseCommand;
  /** 展示文案。 */
  label: string;
  /** 是否使用危险态样式。 */
  danger?: boolean;
}

/** 标签关闭菜单的固定顺序。 */
const CLOSE_MENU_CONFIGS: CloseMenuConfig[] = [
  { action: 'close', label: '关闭' },
  { action: 'closeOthers', label: '关闭其他' },
  { action: 'closeRight', label: '关闭右侧' },
  { action: 'closeAll', label: '关闭全部', danger: true }
];

/** 顶部标签菜单支持的关闭动作集合。 */
const HEADER_TAB_CLOSE_COMMANDS: readonly HeaderTabCloseCommand[] = ['close', 'closeOthers', 'closeRight', 'closeAll'];

/** 顶部标签菜单支持的复制动作集合。 */
const HEADER_TAB_COPY_COMMANDS: readonly HeaderTabCopyCommand[] = ['copyPath', 'copyAddress'];

const tabsStore = useTabsStore();
const recentStore = useRecentStore();
const route = useRoute();
const router = useRouter();
const { clipboard } = useClipboard();
const { canClose, cleanupClosedTabs, cancelClose } = useTabCloseGuard();

/** 菜单根节点。 */
const menuRef = ref<HTMLElement | null>(null);
/** 菜单当前渲染尺寸。 */
const menuSize = ref<HeaderTabMenuSize>({ width: 0, height: 0 });
/** 顶部标签右键菜单状态。 */
const menuState = reactive<HeaderTabMenuState>({
  open: false,
  tabId: null,
  position: { x: 0, y: 0 }
});

/** 最近一次打开菜单请求 ID，避免快速连续右键时旧请求覆盖新请求。 */
let menuOpenRequestId = 0;

/** 当前右键菜单绑定的标签。 */
const activeMenuTab = computed<Tab | null>(() => tabsStore.tabs.find((tab: Tab): boolean => tab.id === menuState.tabId) ?? null);

/**
 * 判断命令是否为关闭动作。
 * @param command - 菜单命令
 * @returns 是否为关闭动作
 */
function isCloseCommand(command: HeaderTabMenuCommand): command is HeaderTabCloseCommand {
  return HEADER_TAB_CLOSE_COMMANDS.includes(command as HeaderTabCloseCommand);
}

/**
 * 判断命令是否为复制动作。
 * @param command - 菜单命令
 * @returns 是否为复制动作
 */
function isCopyCommand(command: HeaderTabMenuCommand): command is HeaderTabCopyCommand {
  return HEADER_TAB_COPY_COMMANDS.includes(command as HeaderTabCopyCommand);
}

/**
 * 获取当前激活标签 ID。
 * @returns 当前激活标签 ID，未命中时返回 null
 */
function getActiveTabId(): string | null {
  return tabsStore.tabs.find((tab: Tab): boolean => tab.path === route.fullPath)?.id ?? null;
}

/**
 * 构建单个关闭菜单项。
 * @param tab - 菜单目标标签
 * @param config - 关闭菜单配置
 * @returns 关闭菜单项
 */
function createCloseItem(tab: Tab, config: CloseMenuConfig): HeaderTabMenuItem {
  const plan = tabsStore.getClosePlan(config.action, {
    anchorTabId: tab.id,
    activeTabId: getActiveTabId(),
    allowCloseLastTab: true
  });

  return {
    key: config.action,
    label: config.label,
    disabled: plan.disabled,
    ...(config.danger ? { danger: true } : {})
  };
}

/**
 * 构建资源复制菜单项。
 * @param tab - 菜单目标标签
 * @returns 资源复制菜单项；当前标签没有复制能力时返回 null
 */
function createCopyItem(tab: Tab): HeaderTabMenuItem | null {
  const copyAction = getHeaderTabCopyAction(tab, recentStore.recentRecords ?? []);
  if (!copyAction) return null;

  return {
    key: copyAction.command,
    label: copyAction.command === 'copyPath' ? '复制路径' : '复制地址'
  };
}

/** 当前右键菜单条目。 */
const menuItems = computed<HeaderTabMenuEntry[]>(() => {
  const tab = activeMenuTab.value;
  if (!tab) return [];

  const items: HeaderTabMenuEntry[] = CLOSE_MENU_CONFIGS.map((config: CloseMenuConfig): HeaderTabMenuItem => createCloseItem(tab, config));
  const copyItem = createCopyItem(tab);
  if (copyItem) {
    items.push({ type: 'divider', key: 'resource-divider' }, copyItem);
  }

  return items;
});

/**
 * 读取当前视口尺寸。
 * @returns 视口尺寸
 */
function getViewportSize(): HeaderTabMenuSize {
  if (typeof window === 'undefined') {
    return { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight
  };
}

/**
 * 将菜单单轴坐标限制在视口内部。
 * @param position - 原始坐标
 * @param size - 菜单在该轴上的尺寸
 * @param viewportSize - 视口在该轴上的尺寸
 * @returns 修正后的坐标
 */
function clampAxisPosition(position: number, size: number, viewportSize: number): number {
  const minPosition = HEADER_TAB_MENU_VIEWPORT_PADDING;
  const maxPosition = Math.max(minPosition, viewportSize - size - HEADER_TAB_MENU_VIEWPORT_PADDING);

  return Math.min(Math.max(minPosition, position), maxPosition);
}

/** 菜单定位样式。 */
const menuStyle = computed<CSSProperties>(() => ({
  left: `${clampAxisPosition(menuState.position.x, menuSize.value.width, getViewportSize().width)}px`,
  top: `${clampAxisPosition(menuState.position.y, menuSize.value.height, getViewportSize().height)}px`
}));

/**
 * 关闭顶部标签右键菜单。
 */
function closeMenu(): void {
  menuState.open = false;
  menuState.tabId = null;
}

/**
 * 同步菜单渲染尺寸，用于边界定位。
 */
async function syncMenuSize(): Promise<void> {
  if (!menuState.open) {
    menuSize.value = { width: 0, height: 0 };
    return;
  }

  const [tickError] = await asyncTo(nextTick());
  if (tickError) return;

  const rect = menuRef.value?.getBoundingClientRect();
  if (!rect) return;

  menuSize.value = { width: rect.width, height: rect.height };
}

/**
 * 安全调度菜单尺寸同步。
 */
function scheduleSizeSync(): void {
  asyncTo(syncMenuSize()).then(([error]): void => {
    if (error) {
      console.warn('HeaderTabMenu size sync failed', error);
    }
  });
}

/**
 * 打开指定标签的右键菜单。
 * @param tab - 右键命中的标签
 * @param event - 鼠标右键事件
 */
async function openForTab(tab: Tab, event: MouseEvent): Promise<void> {
  event.preventDefault();
  const requestId = ++menuOpenRequestId;
  const position = { x: event.clientX, y: event.clientY };

  // 已打开时先提交关闭状态，再以新 key 在新位置重新挂载，避免坐标变化产生平移动画。
  if (menuState.open) {
    closeMenu();
    const [tickError] = await asyncTo(nextTick());
    if (tickError || requestId !== menuOpenRequestId) return;
  }

  menuState.tabId = tab.id;
  menuState.position = position;
  menuState.open = true;
}

/**
 * 执行标签关闭动作。
 * @param action - 标签关闭动作
 * @param tab - 关闭动作锚点标签
 */
async function executeCloseAction(action: HeaderTabCloseCommand, tab: Tab): Promise<void> {
  const plan = tabsStore.getClosePlan(action, { anchorTabId: tab.id, activeTabId: getActiveTabId(), allowCloseLastTab: true });

  const [closeError, closeAllowed] = await asyncTo(canClose(plan));
  if (closeError || !closeAllowed) return;

  // 活动标签先完成回退导航，避免导航失败后当前路由指向已被移除的页面。
  if (plan.requiresNavigation) {
    const [navigationError, navigationResult] = await asyncTo(router.push(plan.nextActivePath ?? '/welcome'));
    if (navigationError || isBlockingNavigationFailure(navigationResult)) {
      cancelClose(plan.targetTabIds);
      return;
    }
  }

  tabsStore.applyClosePlan(plan);
  cleanupClosedTabs(plan.targetTabIds);
}

/**
 * 顶部关闭按钮复用菜单关闭动作。
 * @param tab - 待关闭的标签页
 */
async function closeTab(tab: Tab): Promise<void> {
  closeMenu();
  await executeCloseAction('close', tab);
}

/**
 * 执行资源复制动作。
 * @param command - 资源复制命令
 * @param tab - 菜单目标标签
 */
async function executeCopyAction(command: HeaderTabCopyCommand, tab: Tab): Promise<void> {
  const copyAction = getHeaderTabCopyAction(tab, recentStore.recentRecords ?? []);
  if (!copyAction || copyAction.command !== command) return;

  await asyncTo(clipboard(copyAction.content, { successMessage: copyAction.successMessage, trim: false }));
}

/**
 * 处理右键菜单命令选择。
 * @param command - 菜单命令
 */
async function handleMenuSelect(command: HeaderTabMenuCommand): Promise<void> {
  const tab = activeMenuTab.value;
  closeMenu();
  if (!tab) return;

  if (isCloseCommand(command)) {
    await executeCloseAction(command, tab);
    return;
  }

  if (isCopyCommand(command)) {
    await executeCopyAction(command, tab);
  }
}

/**
 * 处理菜单项点击。
 * @param item - 菜单项
 */
async function handleItemClick(item: HeaderTabMenuItem): Promise<void> {
  if (item.disabled) return;

  await handleMenuSelect(item.key);
}

/**
 * 判断事件是否发生在菜单外部。
 * @param event - 指针事件
 * @returns 是否为外部事件
 */
function isOutsidePointer(event: PointerEvent): boolean {
  const { target } = event;

  return target instanceof Node && menuRef.value !== null && !menuRef.value.contains(target);
}

/**
 * 处理外部指针按下。
 * @param event - 指针事件
 */
function handlePointerDown(event: PointerEvent): void {
  if (isOutsidePointer(event)) {
    closeMenu();
  }
}

/**
 * 处理键盘关闭。
 * @param event - 键盘事件
 */
function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    closeMenu();
  }
}

/**
 * 处理窗口尺寸变化。
 */
function handleWindowResize(): void {
  scheduleSizeSync();
}

/**
 * 同步全局关闭监听。
 * @param open - 菜单是否打开
 */
function syncDocumentListeners(open: boolean): void {
  if (open) {
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleDocumentKeydown, true);
    window.addEventListener('resize', handleWindowResize);
    return;
  }

  document.removeEventListener('pointerdown', handlePointerDown, true);
  document.removeEventListener('keydown', handleDocumentKeydown, true);
  window.removeEventListener('resize', handleWindowResize);
}

watch(() => menuState.open, syncDocumentListeners, { immediate: true });
watch(
  () => [menuState.open, menuState.position.x, menuState.position.y, menuItems.value.length],
  (): void => {
    scheduleSizeSync();
  },
  { immediate: true, flush: 'post' }
);

/**
 * 菜单目标标签被移除后自动关闭菜单。
 */
watch(
  () => activeMenuTab.value,
  (tab: Tab | null): void => {
    if (menuState.open && !tab) {
      closeMenu();
    }
  }
);

onBeforeUnmount((): void => {
  syncDocumentListeners(false);
});

defineExpose({
  openForTab,
  closeTab
});
</script>

<style lang="less" scoped>
.header-tab-menu {
  position: fixed;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 168px;
  padding: 4px;
  line-height: 32px;
  background: var(--dropdown-bg);
  border: var(--overlay-border-width) solid var(--dropdown-border);
  border-radius: var(--overlay-radius);
  box-shadow: var(--shadow-lg);
  transform-origin: top left;
  animation: header-tab-menu-enter 120ms ease-out;
  will-change: opacity, transform;
}

.header-tab-menu__item {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 0 8px;
  font: inherit;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: var(--control-radius);

  &:disabled {
    cursor: default;
    background: transparent;
    opacity: 0.3;
  }

  &:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--dropdown-item-hover-bg);
  }

  &.is-danger {
    color: var(--color-danger);

    &:hover:not(:disabled) {
      color: var(--color-danger);
    }
  }
}

.header-tab-menu__divider {
  height: 1px;
  margin: 3px 8px;
  border-top: 1px solid var(--dropdown-divider);
}

.header-tab-menu__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes header-tab-menu-enter {
  from {
    opacity: 0;
    transform: scale(0.98);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .header-tab-menu {
    animation: none;
  }
}
</style>
