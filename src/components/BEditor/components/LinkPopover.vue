<template>
  <Teleport v-if="overlayRoot && visible" :to="overlayRoot">
    <div ref="popoverRef" :class="name" :style="popoverStyle">
      <input
        ref="inputRef"
        v-model="href"
        type="url"
        class="b-markdown-link__input"
        placeholder="输入链接地址..."
        @keydown.enter="confirm"
        @keydown.escape="cancel"
      />
      <BButton type="text" size="small" :disabled="!href.trim()" @mousedown.prevent @click="confirm"> 确定 </BButton>
      <BButton v-if="props.initialHref" type="text" size="small" square danger icon="lucide:link-2-off" @mousedown.prevent @click="$emit('remove')" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * @file LinkPopover.vue
 * @description 链接 URL 输入浮层，在选区工具栏旁弹出，用于设置链接地址。
 */
import type { CSSProperties } from 'vue';
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { onClickOutside } from '@vueuse/core';
import { createNamespace } from '@/utils/namespace';

const [name] = createNamespace('', 'b-markdown-link');

interface Props {
  /** 是否显示弹窗 */
  visible?: boolean;
  /** 浮层根容器 */
  overlayRoot?: HTMLElement | null;
  /** 定位锚点 DOM（工具栏元素），用于计算弹窗位置 */
  anchorElement?: HTMLElement | null;
  /** 已有链接地址（编辑态），传入后预填并显示移除按钮 */
  initialHref?: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  overlayRoot: null,
  anchorElement: null,
  initialHref: null
});

const emit = defineEmits<{
  (e: 'confirm', href: string): void;
  (e: 'cancel'): void;
  (e: 'remove'): void;
}>();

const popoverRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const href = ref('');
const popoverStyle = ref<CSSProperties>({ display: 'none' });

/** 弹窗宽度 */
const POPOVER_WIDTH = 280;
/** 弹窗与锚点间距 */
const POPOVER_GAP = 8;

/**
 * 计算弹窗绝对定位样式。
 * 水平居中对齐锚点，垂直位于锚点下方。
 */
function computeStyle(): void {
  const anchor = props.anchorElement;
  if (!anchor) {
    popoverStyle.value = { display: 'none' };
    return;
  }

  const anchorRect = anchor.getBoundingClientRect();
  const overlayEl = props.overlayRoot;
  const overlayRect = overlayEl?.getBoundingClientRect() ?? new DOMRect();

  const left = anchorRect.left - overlayRect.left + (anchorRect.width - POPOVER_WIDTH) / 2;
  const top = anchorRect.top - overlayRect.top + anchorRect.height + POPOVER_GAP;

  popoverStyle.value = {
    position: 'absolute',
    top: `${top}px`,
    left: `${left}px`,
    width: `${POPOVER_WIDTH}px`,
    zIndex: 101
  };
}

/** 确认：发出 href 并关闭 */
function confirm(): void {
  const value = href.value.trim();
  if (!value) return;
  emit('confirm', value);
}

/** 取消：发出 cancel 事件 */
function cancel(): void {
  emit('cancel');
}

/** 点击弹窗外关闭 */
onClickOutside(popoverRef, cancel);

watch(
  () => props.visible,
  async (visible: boolean): Promise<void> => {
    if (visible) {
      href.value = props.initialHref ?? '';
      await nextTick();
      computeStyle();
      inputRef.value?.focus();
    } else {
      popoverStyle.value = { display: 'none' };
    }
  }
);

onBeforeUnmount((): void => {
  popoverStyle.value = { display: 'none' };
});
</script>

<style lang="less" scoped>
.b-markdown-link {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 6px;
  background: var(--bg-primary);
  border: var(--overlay-border-width) solid var(--border-primary);
  border-radius: var(--overlay-radius);
  box-shadow: var(--shadow-lg);
}

.b-markdown-link__input {
  flex: 1;
  height: 28px;
  padding: 0 8px;
  font-size: 13px;
  color: var(--text-primary);
  outline: none;
  background: var(--bg-secondary);
  border: var(--control-border-width) solid var(--border-primary);
  border-radius: var(--control-radius);

  &::placeholder {
    color: var(--text-tertiary);
  }

  &:focus {
    border-color: var(--color-primary);
  }
}
</style>
