<template>
  <span ref="textRef" class="b-truncate-text" :title="isTruncated ? text : ''">
    {{ text }}
  </span>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';

interface Props {
  text?: string;
}
const props = withDefaults(defineProps<Props>(), { text: '' });

const textRef = ref<HTMLElement | null>(null);
const isTruncated = ref(false);
let observedElement: HTMLElement | null = null;

function checkTruncation(): void {
  if (!textRef.value) {
    return;
  }
  const { scrollWidth, clientWidth } = textRef.value;
  isTruncated.value = scrollWidth > clientWidth;
}

let frame: number | null = null;

function scheduleCheckTruncation(): void {
  if (frame !== null) {
    cancelAnimationFrame(frame);
  }

  frame = requestAnimationFrame(() => {
    checkTruncation();
    frame = null;
  });
}

const resizeObserver = new ResizeObserver((): void => {
  scheduleCheckTruncation();
});

onMounted(() => {
  scheduleCheckTruncation();
  observedElement = textRef.value?.parentElement ?? textRef.value;
  if (observedElement) {
    resizeObserver.observe(observedElement);
  }
});

watch(
  () => props.text,
  () => {
    scheduleCheckTruncation();
  }
);

onUnmounted(() => {
  if (frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }

  resizeObserver.disconnect();
  observedElement = null;
});
</script>

<style scoped>
.b-truncate-text {
  display: inline-block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
