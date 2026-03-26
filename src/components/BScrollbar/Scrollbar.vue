<template>
  <div :class="['scrollbar', { 'scrollbar--visible': barVisible, 'scrollbar--inset': inset }]" @mouseenter="onMouseEnter" @mouseleave="onMouseLeave">
    <!-- container：统一包裹 -->
    <div class="scrollbar__container">
      <!-- wrap -->
      <div ref="wrap" class="scrollbar__wrap" :style="wrapStyle" @scroll="onScroll">
        <div ref="view" class="scrollbar__view">
          <slot></slot>
        </div>
      </div>

      <!-- vertical bar -->
      <div v-if="showVertical" ref="barY" class="scrollbar__bar scrollbar__bar--vertical">
        <div class="scrollbar__thumb" :style="thumbStyleY" @mousedown.prevent.stop="onThumbDownY"></div>
      </div>

      <!-- horizontal bar -->
      <div v-if="showHorizontal" ref="barX" class="scrollbar__bar scrollbar__bar--horizontal">
        <div class="scrollbar__thumb" :style="thumbStyleX" @mousedown.prevent.stop="onThumbDownX"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, CSSProperties } from 'vue';
import { addCssUnit, isDefined } from '../../utils/common';
import { useTimeoutFn, useEventListener, useElementSize } from '@vueuse/core';

interface Props {
  // 是否一直显示滚动条
  always?: boolean;
  // 是否显示水平滚动条
  horizontal?: boolean;
  // 滚动条高度
  height?: string | number;
  // 滚动条最大高度
  maxHeight?: string | number;
  // 是否占据空间
  inset?: boolean;
  // 是否隐藏滚动条
  hide?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  always: false,
  horizontal: false,
  height: undefined,
  maxHeight: undefined,
  inset: false,
  hide: false
});

const emit = defineEmits<{ (e: 'scroll', event: Event): void }>();

/* ================= bar ================= */
const BAR_SIZE = 6;
const BAR_GAP = 2;
const BAR_TOTAL = BAR_SIZE + BAR_GAP;

/* ================= refs ================= */
const wrap = ref<HTMLDivElement>();
const view = ref<HTMLDivElement>();
const barY = ref<HTMLDivElement>();
const barX = ref<HTMLDivElement>();

const thumbY = ref({ size: 0, offset: 0 });
const thumbX = ref({ size: 0, offset: 0 });

/* ================= visible ================= */
const visible = ref(false);
const hovering = ref(false);
let dragging = false;

const { start: startHide, stop: stopHide } = useTimeoutFn(
  () => {
    if (!dragging && !hovering.value) visible.value = false;
  },
  1000,
  { immediate: false }
);

const barVisible = computed(() => !props.hide && (props.always || visible.value));

function showBar() {
  visible.value = true;
  stopHide();
}

function hideBar() {
  if (props.always || dragging || hovering.value) return;
  startHide();
}

function onMouseEnter() {
  hovering.value = true;
  showBar();
}

function onMouseLeave() {
  hovering.value = false;
  hideBar();
}

/* ================= element size ================= */
const wrapSize = useElementSize(wrap);
const viewSize = useElementSize(view);

const showVertical = computed(() => viewSize.height.value > wrapSize.height.value);

const showHorizontal = computed(() => props.horizontal && viewSize.width.value > wrapSize.width.value);

/* ================= wrap style ================= */
const wrapStyle = computed<CSSProperties>(() => {
  const style: CSSProperties = {};

  if (isDefined(props.height)) style.height = addCssUnit(props.height);
  if (props.maxHeight) style.maxHeight = addCssUnit(props.maxHeight);

  if (props.inset) {
    showVertical.value && (style.paddingRight = `${BAR_TOTAL}px`);

    showHorizontal.value && (style.paddingBottom = `${BAR_TOTAL}px`);
  }

  return style;
});

/* ================= thumb update ================= */
function updateY() {
  const el = wrap.value;
  if (!el) return;

  const ratio = el.clientHeight / el.scrollHeight;
  const size = Math.max(ratio * el.clientHeight, 20);
  const offset = (el.scrollTop / (el.scrollHeight - el.clientHeight)) * (el.clientHeight - size);

  thumbY.value.size = size;
  thumbY.value.offset = Number.isNaN(offset) ? 0 : offset;
}

function updateX() {
  const el = wrap.value;
  if (!el) return;

  const ratio = el.clientWidth / el.scrollWidth;
  const size = Math.max(ratio * el.clientWidth, 20);
  const offset = (el.scrollLeft / (el.scrollWidth - el.clientWidth)) * (el.clientWidth - size);

  thumbX.value.size = size;
  thumbX.value.offset = Number.isNaN(offset) ? 0 : offset;
}

function update() {
  updateY();
  if (showHorizontal.value) updateX();
}

/* ================= scroll ================= */
let frame: number | null = null;

function onScroll(e: Event) {
  showBar();
  emit('scroll', e);

  if (frame) cancelAnimationFrame(frame);

  frame = requestAnimationFrame(() => {
    update();
    hideBar();
    frame = null;
  });
}

/* ================= drag ================= */
type Axis = 'x' | 'y';

function createDrag(axis: Axis) {
  return (e: MouseEvent) => {
    dragging = true;
    showBar();

    const startPos = axis === 'y' ? e.clientY : e.clientX;
    const startScroll = axis === 'y' ? wrap.value!.scrollTop : wrap.value!.scrollLeft;

    const stopMove = useEventListener(document, 'mousemove', (ev: MouseEvent) => {
      if (!wrap.value) return;

      const delta = (axis === 'y' ? ev.clientY : ev.clientX) - startPos;

      const bar = axis === 'y' ? barY.value : barX.value;
      const thumb = axis === 'y' ? thumbY.value : thumbX.value;
      if (!bar) return;

      const barSize = axis === 'y' ? bar.clientHeight : bar.clientWidth;

      const scrollSize = axis === 'y' ? wrap.value.scrollHeight - wrap.value.clientHeight : wrap.value.scrollWidth - wrap.value.clientWidth;

      const thumbRange = barSize - thumb.size;
      if (thumbRange <= 0) return;

      let next = startScroll + (delta / thumbRange) * scrollSize;

      next = Math.max(0, Math.min(next, scrollSize));

      axis === 'y' ? (wrap.value.scrollTop = next) : (wrap.value.scrollLeft = next);
    });

    const stopUp = useEventListener(document, 'mouseup', () => {
      dragging = false;
      hideBar();
      stopMove();
      stopUp();
    });
  };
}

const onThumbDownY = createDrag('y');
const onThumbDownX = createDrag('x');

/* ================= thumb style ================= */
const thumbStyleY = computed(() => ({
  width: '100%',
  height: `${thumbY.value.size}px`,
  transform: `translateY(${thumbY.value.offset}px)`
}));

const thumbStyleX = computed(() => ({
  height: '100%',
  width: `${thumbX.value.size}px`,
  transform: `translateX(${thumbX.value.offset}px)`
}));

/* ================= mounted ================= */
let ro: ResizeObserver | null = null;

onMounted(async () => {
  await nextTick();
  update();

  if (view.value) {
    ro = new ResizeObserver(update);
    ro.observe(view.value);
  }
});

onUnmounted(() => {
  if (ro && view.value) ro.unobserve(view.value);
});
</script>

<style lang="less">
.scrollbar {
  position: relative;
  width: 100%;
  height: 100%;

  &--visible {
    .scrollbar__bar {
      opacity: 1;
    }
  }

  &--inset {
    .scrollbar__bar--vertical {
      right: 0;
    }

    .scrollbar__bar--horizontal {
      bottom: 0;
    }
  }
}

.scrollbar__container {
  position: relative;
  width: 100%;
  height: 100%;
}

.scrollbar__wrap {
  width: 100%;
  height: 100%;
  overflow: auto;
}

.scrollbar__view {
  min-width: 100%;
}

.scrollbar__bar {
  position: absolute;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.25s;

  &--vertical {
    top: 0;
    right: 2px;
    width: 6px;
    height: 100%;
    pointer-events: auto;
  }

  &--horizontal {
    bottom: 2px;
    left: 0;
    width: 100%;
    height: 6px;
    pointer-events: auto;
  }
}

.scrollbar__thumb {
  position: absolute;
  cursor: pointer;
  background: rgb(0 0 0 / 10%);
  border-radius: 3px;
  transition: background 0.2s;

  &:hover {
    background: rgb(0 0 0 / 20%);
  }

  &:active {
    background: rgb(0 0 0 / 25%);
  }
}

:global(.dark) .scrollbar__thumb {
  background: rgb(255 255 255 / 15%);

  &:hover {
    background: rgb(255 255 255 / 25%);
  }

  &:active {
    background: rgb(255 255 255 / 30%);
  }
}
</style>