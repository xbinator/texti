<!--
  @file HeaderTab.vue
  @description 单个标签页渲染组件，包含图标、通用状态指示和关闭按钮。
-->
<template>
  <div class="header-tab" :class="tabClass" @click="emit('click')" @contextmenu.prevent="emit('contextmenu', $event)">
    <div class="header-tab__title">
      <span v-if="tabsStore.isDirty(tab.id)" class="header-tab__dirty-mark">*</span>
      <!-- 运行状态与最近记录图标互斥展示 -->
      <span v-if="statusVisual" :class="['header-tab__status', statusVisual.className]">
        <Icon v-if="statusVisual.icon" :icon="statusVisual.icon" width="13" height="13" />
      </span>
      <BRecentIcon v-else class="header-tab__icon" v-bind="tabIconProps" :size="14" />
      <span class="header-tab__title-text">{{ tab.title }}</span>
    </div>

    <button class="header-tab__close" @pointerdown.stop @click.stop="emit('close')">
      <Icon icon="ic:round-close" width="12" height="12" />
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * @file HeaderTab.vue
 * @description 单标签页渲染逻辑：class 状态、图标绑定与通用状态指示。
 */
import { computed, toRef } from 'vue';
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

/** 标签页样式状态映射。 */
const tabClass = computed<Record<string, boolean>>(() => ({
  'is-active': props.tab.path === route.fullPath,
  'is-missing': tabsStore.isMissing(props.tab.id),
  'is-dragging': props.dragging ?? false
}));

/** 运行状态对应的视觉配置。 */
const statusVisual = computed<StatusVisual | undefined>(() => (props.status ? STATUS_VISUALS[props.status] : undefined));
</script>

<style lang="less" scoped>
.header-tab {
  position: relative;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  height: 28px;
  padding: 0 4px 0 10px;
  color: var(--text-primary);
  cursor: pointer;
  background: var(--bg-secondary);
  border: var(--button-border-width) solid var(--button-border);
  border-radius: var(--control-radius);
  box-shadow: var(--button-shadow);
  transition: color var(--motion-duration-base) var(--motion-easing-standard), background var(--motion-duration-base) var(--motion-easing-standard),
    border-color var(--motion-duration-base) var(--motion-easing-standard), box-shadow var(--motion-duration-base) var(--motion-easing-standard),
    opacity var(--motion-duration-base) var(--motion-easing-standard);

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

  &.is-missing .header-tab__title {
    color: var(--error-color, #ff4d4f);
  }

  &.is-missing .header-tab__title-text {
    text-decoration-line: line-through;
    text-decoration-thickness: 1px;
  }
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
  margin-right: 2px;
  font-weight: 700;
}

.header-tab__status {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  margin-right: 4px;
}

.header-tab__status.is-spinning {
  animation: header-tab-status-spin 1s linear infinite;
}

.header-tab__status--attention {
  color: var(--warning-color, #fa8c16);
}

.header-tab__status--error {
  color: var(--error-color, #ff4d4f);
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

.header-tab__close {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--control-radius);
  opacity: 0;
  transition: color var(--motion-duration-base) var(--motion-easing-standard), background var(--motion-duration-base) var(--motion-easing-standard),
    opacity var(--motion-duration-base) var(--motion-easing-standard);

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover-secondary, rgb(0 0 0 / 10%));
  }
}

.header-tab:hover .header-tab__close,
.header-tab.is-active .header-tab__close {
  opacity: 1;
}

:deep(.dark) .header-tab__close:hover {
  background: rgb(255 255 255 / 10%);
}

@keyframes header-tab-status-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
