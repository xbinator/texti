<!--
  @file HeaderTab.vue
  @description 单个标签页渲染组件，包含图标、通用状态指示和关闭按钮。
-->
<template>
  <div ref="rootRef" class="header-tab" :class="tabClass" @click="emit('click')" @contextmenu.prevent="emit('contextmenu', $event)">
    <div ref="titleRef" class="header-tab__title">
      <!-- 运行状态与最近记录图标互斥展示 -->
      <span v-if="statusVisual" :class="['header-tab__status', statusVisual.className]">
        <Icon v-if="statusVisual.icon" :icon="statusVisual.icon" width="13" height="13" />
      </span>
      <BRecentIcon v-else class="header-tab__icon" v-bind="tabIconProps" :size="14" />
      <span class="header-tab__title-text" :class="{ 'header-tab__title-text--dirty': isDirty }">{{ tab.title }}</span>
      <span v-if="isDirty" class="header-tab__dirty-mark">*</span>
    </div>

    <button ref="closeRef" class="header-tab__close" @pointerdown.stop @click.stop="handleCloseClick">
      <Icon icon="ic:round-close" width="16" height="16" />
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * @file HeaderTab.vue
 * @description 单标签页渲染逻辑：class 状态、图标绑定与通用状态指示。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, toRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Icon } from '@iconify/vue';
import { useHeaderTabIcon } from '@/layouts/default/hooks/useHeaderTabIcon';
import type { Tab, TabStatus } from '@/stores/workspace/tabs';
import { useTabsStore } from '@/stores/workspace/tabs';

/**
 * 标签页运行状态的图标和样式配置。
 */
interface StatusVisual {
  /** 可选 Iconify 图标。 */
  icon?: string;
  /** 状态附加类名。 */
  className?: string;
}

/** 通用标签状态的声明式视觉映射。 */
const STATUS_VISUALS: Record<TabStatus, StatusVisual> = {
  loading: { icon: 'lucide:loader-circle', className: 'is-spinning' },
  attention: { icon: 'lucide:circle-alert', className: 'header-tab__status--attention' },
  error: { icon: 'lucide:circle-x', className: 'header-tab__status--error' },
  completed: { className: 'header-tab__status--completed' }
};

/** 关闭按钮开始悬浮的紧凑标签宽度阈值。 */
const CLOSE_FLOATING_WIDTH_THRESHOLD = 100;

/** 普通布局下标签根节点左右 padding 总和。 */
const COMPACT_TAB_HORIZONTAL_PADDING = 10;

/** 关闭离场动画兜底超时时长（ms），略大于 CSS 过渡时长，避免 transitionend 丢失卡住关闭流程。 */
const CLOSE_FALLBACK_TIMEOUT_MS = 400;

/** 关闭事件发出后检查关闭是否被拦截的延时（ms），覆盖同步返回的关闭守卫。 */
const CLOSE_CANCEL_CHECK_DELAY_MS = 200;

/**
 * 组件 Props 定义。
 */
interface Props {
  /** 标签页数据 */
  tab: Tab;
  /** 是否处于拖拽中 */
  dragging?: boolean;
  /** 通用标签视觉状态。 */
  status?: TabStatus;
}

const props = withDefaults(defineProps<Props>(), {
  dragging: false,
  status: undefined
});

const emit = defineEmits<{
  (e: 'click'): void;
  (e: 'close'): void;
  (e: 'contextmenu', event: MouseEvent): void;
}>();

const route = useRoute();
const tabsStore = useTabsStore();
const tabIconProps = useHeaderTabIcon(toRef(props, 'tab'));

/** 组件根元素引用。 */
const rootRef = ref<HTMLElement | null>(null);

/** 标签标题容器引用。 */
const titleRef = ref<HTMLElement | null>(null);

/** 标签关闭按钮引用。 */
const closeRef = ref<HTMLButtonElement | null>(null);

/** 关闭按钮是否需要悬浮覆盖标题末尾。 */
const isCloseFloating = ref(false);

/** 是否正在播放关闭离场动画。 */
const isClosing = ref(false);

/** 关闭动画兜底定时器 ID。 */
let closeFallbackTimer: number | undefined;

/** 关闭被拦截后的状态回滚定时器 ID。 */
let closeCancelTimer: number | undefined;

/** 关闭动画 transitionend 监听清理函数。 */
let removeCloseListener: (() => void) | undefined;

/** 监听标签尺寸变化，用于同步关闭按钮布局。 */
let closeLayoutObserver: ResizeObserver | undefined;

/** 当前标签页是否为激活状态。 */
const isActive = computed<boolean>(() => props.tab.path === route.fullPath);

/** 当前标签页是否存在未保存草稿。 */
const isDirty = computed<boolean>(() => tabsStore.isDirty(props.tab.id));

/** 标签页样式状态映射。 */
const tabClass = computed<Record<string, boolean>>(() => ({
  'is-active': isActive.value,
  'is-close-floating': isCloseFloating.value,
  'is-closing': isClosing.value,
  'is-missing': tabsStore.isMissing(props.tab.id),
  'is-dragging': props.dragging ?? false
}));

/**
 * 计算关闭按钮参与普通布局时的标签宽度。
 * @returns 普通布局下的标签宽度
 */
function getCompactTabWidth(): number {
  const title = titleRef.value;
  const close = closeRef.value;
  if (!title || !close) {
    return 0;
  }

  const titleWidth = title.scrollWidth || title.getBoundingClientRect().width;
  const closeWidth = close.offsetWidth || close.getBoundingClientRect().width;
  return titleWidth + closeWidth + COMPACT_TAB_HORIZONTAL_PADDING;
}

/**
 * 根据普通布局宽度是否超过阈值，同步关闭按钮是否悬浮。
 */
function updateCloseLayout(): void {
  // 离场动画期间宽度被人为收缩，不应参与悬浮判定
  if (isClosing.value) {
    return;
  }

  isCloseFloating.value = getCompactTabWidth() > CLOSE_FLOATING_WIDTH_THRESHOLD;
}

/**
 * 在 DOM 更新后同步关闭按钮布局。
 */
function scheduleCloseSync(): void {
  nextTick(updateCloseLayout);
}

/**
 * 监听根元素、标题和关闭按钮尺寸变化，确保标题变化或窗口缩放后布局状态准确。
 */
function observeCloseLayout(): void {
  if (typeof ResizeObserver === 'undefined') {
    return;
  }

  const root = rootRef.value;
  const title = titleRef.value;
  const close = closeRef.value;
  if (!root || !title || !close) {
    return;
  }

  closeLayoutObserver?.disconnect();
  closeLayoutObserver = new ResizeObserver(updateCloseLayout);
  closeLayoutObserver.observe(root);
  closeLayoutObserver.observe(title);
  closeLayoutObserver.observe(close);
}

/**
 * 判断当前环境是否偏好减少动效。
 * @returns 是否减少动效
 */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 关闭被拦截后回滚离场状态，直接恢复标签原状。
 */
function restoreFromClosing(): void {
  isClosing.value = false;

  const root = rootRef.value;
  if (root) {
    root.style.width = '';
  }

  scheduleCloseSync();
}

/**
 * 清理离场动画监听并发出关闭事件，随后延迟检查关闭是否被守卫拦截。
 */
function finishClose(): void {
  window.clearTimeout(closeFallbackTimer);
  closeFallbackTimer = undefined;
  removeCloseListener?.();
  removeCloseListener = undefined;

  emit('close');

  // 关闭守卫（未保存确认、并发保护）可能拒绝关闭，此时标签仍留在 store 中，需要恢复原状
  closeCancelTimer = window.setTimeout((): void => {
    if (!isClosing.value) {
      return;
    }

    if (tabsStore.tabs.some((tab: Tab): boolean => tab.id === props.tab.id)) {
      restoreFromClosing();
    }
  }, CLOSE_CANCEL_CHECK_DELAY_MS);
}

/**
 * 监听宽度过渡结束触发关闭，并保留超时兜底避免 transitionend 丢失。
 * @param root - 标签根元素
 */
function watchCloseTransition(root: HTMLElement): void {
  const handleTransitionEnd = (event: TransitionEvent): void => {
    if (event.target === root && event.propertyName === 'width') {
      finishClose();
    }
  };

  root.addEventListener('transitionend', handleTransitionEnd);
  removeCloseListener = (): void => {
    root.removeEventListener('transitionend', handleTransitionEnd);
  };
  closeFallbackTimer = window.setTimeout(finishClose, CLOSE_FALLBACK_TIMEOUT_MS);
}

/**
 * 处理关闭按钮点击：先播放宽度收缩离场动画，动画结束后再发出关闭事件。
 * 右侧标签随 flex 布局自然从右往左滑动补位。
 */
function handleCloseClick(): void {
  if (isClosing.value) {
    return;
  }

  const root = rootRef.value;
  if (!root || prefersReducedMotion()) {
    emit('close');
    return;
  }

  isClosing.value = true;

  // 锁定当前渲染宽度作为收缩过渡的起点
  root.style.width = `${root.offsetWidth}px`;
  // 强制同步布局提交起始宽度，避免与目标宽度合并导致直接跳变
  root.getBoundingClientRect();
  root.style.width = '0px';

  watchCloseTransition(root);
}

/**
 * 查找最近的横向可滚动祖先容器（标签栏）。
 * @param element - 起始元素
 * @returns 横向可滚动容器，不存在时返回 null
 */
function findHorizontalScrollContainer(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement;
  while (parent) {
    if (parent.scrollWidth > parent.clientWidth) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

/**
 * 判断标签页是否完全处于容器可视范围内。
 * @param element - 标签页根元素
 * @param container - 横向滚动容器
 * @returns 是否完全可见
 */
function isTabFullyVisible(element: HTMLElement, container: HTMLElement): boolean {
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  return elementRect.left >= containerRect.left && elementRect.right <= containerRect.right;
}

/**
 * 激活标签页仅在超出可视范围时最小滚动到可见区域。
 * 切换标签或初始渲染时触发；标签已完全可见时不做任何滚动。
 */
watch(
  isActive,
  async (active: boolean): Promise<void> => {
    if (!active) {
      return;
    }
    // 等待 DOM 更新完成后再检测，确保激活标签已渲染
    await nextTick();
    const element = rootRef.value;
    if (!element) {
      return;
    }

    const container = findHorizontalScrollContainer(element);
    if (!container || isTabFullyVisible(element, container)) {
      return;
    }

    // 计算最小滚动位移，将激活标签完全滚入可视范围
    const elementRect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    let targetLeft = container.scrollLeft;
    if (elementRect.left < containerRect.left) {
      targetLeft -= containerRect.left - elementRect.left;
    } else if (elementRect.right > containerRect.right) {
      targetLeft += elementRect.right - containerRect.right;
    }
    container.scrollTo({ left: targetLeft, behavior: 'smooth' });
  },
  { immediate: true }
);

/** 运行状态对应的视觉配置。 */
const statusVisual = computed<StatusVisual | undefined>(() => (props.status ? STATUS_VISUALS[props.status] : undefined));

/**
 * 标题、脏状态或运行状态变化可能影响紧凑宽度，需要重新判定关闭按钮布局。
 */
watch(
  () => [props.tab.title, props.status, isDirty.value] as const,
  (): void => {
    scheduleCloseSync();
  },
  { immediate: true }
);

/**
 * 挂载后绑定尺寸监听，处理窗口缩放和字体渲染后的宽度变化。
 */
onMounted((): void => {
  scheduleCloseSync();
  nextTick(observeCloseLayout);
});

/**
 * 组件卸载时释放尺寸监听器与关闭动画定时器。
 */
onUnmounted((): void => {
  window.clearTimeout(closeFallbackTimer);
  window.clearTimeout(closeCancelTimer);
  closeFallbackTimer = undefined;
  closeCancelTimer = undefined;
  removeCloseListener?.();
  removeCloseListener = undefined;
  closeLayoutObserver?.disconnect();
  closeLayoutObserver = undefined;
});
</script>

<style lang="less" scoped>
.header-tab {
  position: relative;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  height: 28px;
  padding: 0 0 0 10px;
  color: var(--text-primary);
  cursor: pointer;
  background: var(--bg-secondary);
  border: var(--button-border-width) solid var(--button-border);
  border-radius: var(--control-radius);
  box-shadow: var(--button-shadow);
  transition: color var(--motion-duration-base) var(--motion-easing-standard), background var(--motion-duration-base) var(--motion-easing-standard),
    border-color var(--motion-duration-base) var(--motion-easing-standard), box-shadow var(--motion-duration-base) var(--motion-easing-standard),
    opacity var(--motion-duration-base) var(--motion-easing-standard), width var(--motion-duration-base) var(--motion-easing-standard),
    padding var(--motion-duration-base) var(--motion-easing-standard), border-width var(--motion-duration-base) var(--motion-easing-standard);

  /* Ensure tabs themselves are clickable (not draggable) */
  -webkit-app-region: no-drag;

  &:hover {
    background: var(--bg-hover);
    border-color: var(--input-focus-border);
    box-shadow: var(--button-active-shadow);
  }

  &.is-active {
    font-weight: 500;
    background: var(--bg-active, var(--bg-hover));
    border-color: var(--input-focus-border);
    box-shadow: var(--button-active-shadow);
  }

  &.is-dragging {
    opacity: 0.55;
  }

  /* 缺失态：标题置红并加删除线 */
  &.is-missing {
    .header-tab__title {
      color: var(--error-color, #ff4d4f);
    }

    .header-tab__title-text {
      text-decoration-line: line-through;
      text-decoration-thickness: 1px;
    }
  }

  /* 关闭按钮的显隐与状态联动 */
  &:hover .header-tab__close,
  &:focus-within .header-tab__close {
    pointer-events: auto;
    opacity: 1;
  }

  .header-tab__close:hover {
    color: var(--text-primary);
  }
}

.header-tab.is-close-floating {
  padding: 0 10px;
}

.header-tab.is-close-floating .header-tab__close {
  position: absolute;
  top: 0;
  right: 0;
  background: linear-gradient(var(--bg-hover), var(--bg-hover)), var(--bg-secondary);
  border-radius: 0 var(--control-radius) var(--control-radius) 0;
}

.header-tab.is-close-floating.is-active .header-tab__close {
  background: linear-gradient(var(--bg-active, transparent), var(--bg-active, transparent)), var(--bg-secondary);
}

.header-tab__title {
  display: flex;
  flex-shrink: 1;
  align-items: center;
  min-width: 0;
  max-width: 150px;
  font-size: 13px;
  color: var(--text-primary);
  user-select: none;
}

.header-tab__dirty-mark {
  flex-shrink: 0;
  margin-left: 2px;
  font-weight: 700;
  color: var(--warning-color, var(--color-warning, #faad14));
}

.header-tab__status {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  margin-right: 4px;

  &.is-spinning {
    animation: header-tab-status-spin 1s linear infinite;
  }
}

.header-tab__status--attention {
  color: var(--warning-color);
}

.header-tab__status--error {
  color: var(--error-color);
}

.header-tab__status--completed {
  width: 7px;
  height: 7px;
  background: var(--color-primary);
  border-radius: var(--radius-full);
}

.header-tab__icon {
  margin-right: 6px;
}

.header-tab__title-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-tab__title-text--dirty {
  color: var(--warning-color, var(--color-warning, #faad14));
}

.header-tab__close {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 100%;
  color: var(--text-secondary);
  pointer-events: none;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--control-radius);
  opacity: 0;
  transition: color var(--motion-duration-base) var(--motion-easing-standard), background var(--motion-duration-base) var(--motion-easing-standard),
    opacity var(--motion-duration-base) var(--motion-easing-standard);
}

/* 关闭离场：宽度被 JS 收缩到 0，padding 与边框同步归零，避免残留占位 */
.header-tab.is-closing {
  padding: 0;
  overflow: hidden;
  pointer-events: none;
  border-right-width: 0;
  border-left-width: 0;
  opacity: 0;
}

@keyframes header-tab-status-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
