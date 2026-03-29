<template>
  <span ref="textRef" class="b-truncate-text" :title="isTruncated ? text : ''">
    {{ text }}
  </span>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

interface Props {
  text: string;
}
withDefaults(defineProps<Props>(), { text: '' });

const textRef = ref<HTMLElement | null>(null);
const isTruncated = ref(false);

function checkTruncation() {
  if (!textRef.value) {
    return;
  }
  const { scrollWidth, clientWidth } = textRef.value;
  isTruncated.value = scrollWidth > clientWidth;
}

const resizeObserver = new ResizeObserver(() => {
  checkTruncation();
});

onMounted(() => {
  checkTruncation();
  if (textRef.value) {
    resizeObserver.observe(textRef.value);
  }
});

onUnmounted(() => {
  resizeObserver.disconnect();
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
