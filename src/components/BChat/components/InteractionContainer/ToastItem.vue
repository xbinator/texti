<!--
  @file ToastItem.vue
  @description 单个 Toast 提示组件，支持多种类型和自动关闭
-->
<template>
  <div :class="['toast-item', { 'toast-item--shake': shake }]">
    <div :class="['toast-item__icon', `toast-item__icon--${type}`]">
      <BIcon :icon="iconName" :size="16" />
    </div>
    <div class="toast-item__content">
      <component :is="contentVNode" v-if="isVNodeContent" />
      <template v-else>{{ content }}</template>
    </div>
    <div v-if="duration" class="toast-item__countdown">{{ countdownText }}</div>
    <button class="toast-item__close" @click.stop="handleClose">
      <BIcon icon="lucide:x" :size="14" />
    </button>
  </div>
</template>

<script setup lang="ts">
import type { ToastContent, ToastType } from './types';
import { computed, isVNode, onMounted, onUnmounted, ref } from 'vue';

/**
 * ToastItem 属性
 */
interface Props {
  /** Toast 唯一标识 */
  id: string;
  /** Toast 类型 */
  type: ToastType;
  /** Toast 内容（支持字符串或 VNode） */
  content: ToastContent;
  /** 持续时间（毫秒） */
  duration: number;
  /** 是否需要抖动动画 */
  shake?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  duration: 3000,
  shake: false
});

/**
 * 判断内容是否为 VNode
 */
const isVNodeContent = computed<boolean>(() => isVNode(props.content));

/**
 * VNode 内容（如果是 VNode 则返回，否则返回 null）
 */
const contentVNode = computed(() => (isVNodeContent.value ? props.content : null));

const emit = defineEmits<{
  (e: 'close', id: string): void;
}>();

/** 自动关闭定时器 */
let timer: ReturnType<typeof setTimeout> | null = null;
/** 剩余时间（毫秒） */
const remainingTime = ref(props.duration);
/** 动画帧 ID */
let rafId: number | null = null;
/** 开始时间 */
let startTime: number | null = null;

/**
 * 倒计时文本（显示剩余秒数）
 */
const countdownText = computed<string>(() => {
  const seconds = Math.ceil(remainingTime.value / 1000);
  return `${seconds}s`;
});

/**
 * 清除自动关闭定时器
 */
function clearTimer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

/**
 * 处理关闭事件
 */
function handleClose(): void {
  clearTimer();
  emit('close', props.id);
}

/**
 * 更新剩余时间
 */
function updateRemainingTime(): void {
  if (!startTime || props.duration <= 0) return;
  const elapsed = Date.now() - startTime;
  remainingTime.value = Math.max(0, props.duration - elapsed);
  if (remainingTime.value > 0) {
    rafId = requestAnimationFrame(updateRemainingTime);
  }
}

/**
 * 启动自动关闭定时器
 */
function startTimer(): void {
  if (props.duration > 0) {
    startTime = Date.now();
    remainingTime.value = props.duration;
    rafId = requestAnimationFrame(updateRemainingTime);
    timer = setTimeout(() => {
      handleClose();
    }, props.duration);
  }
}

/**
 * 根据类型返回对应的图标名称
 */
const iconName = computed<string>(() => {
  const iconMap: Record<ToastType, string> = {
    error: 'lucide:circle-x',
    warning: 'lucide:alert-triangle',
    info: 'lucide:info',
    success: 'lucide:circle-check'
  };
  return iconMap[props.type];
});

onMounted(() => {
  startTimer();
});

onUnmounted(() => {
  clearTimer();
});
</script>

<style scoped lang="less">
.toast-item {
  position: relative;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 12px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border: var(--surface-border-width) solid var(--border-secondary);
  border-radius: var(--surface-radius);
  transition: background var(--motion-duration-slow) var(--motion-easing-standard), border-color var(--motion-duration-slow) var(--motion-easing-standard);

  &--shake {
    animation: shake 0.3s ease;
  }
}

@keyframes shake {
  0%,
  100% {
    transform: translateX(0);
  }

  25% {
    transform: translateX(-4px);
  }

  50% {
    transform: translateX(4px);
  }

  75% {
    transform: translateX(-4px);
  }
}

.toast-item__icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;

  &--error {
    color: var(--color-error);
  }

  &--warning {
    color: var(--color-warning);
  }

  &--info {
    color: var(--color-info);
  }

  &--success {
    color: var(--color-success);
  }
}

.toast-item__content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toast-item__close {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--control-radius);
  opacity: 0.6;
  transition: opacity var(--motion-duration-base) var(--motion-easing-standard);

  &:hover {
    opacity: 1;
  }
}

.toast-item__countdown {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-tertiary);
}
</style>
