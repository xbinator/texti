<template>
  <div class="address-bar">
    <div class="nav-buttons">
      <button class="nav-btn" :disabled="!canGoBack" title="后退" @click="emit('goBack')">←</button>
      <button class="nav-btn" :disabled="!canGoForward" title="前进" @click="emit('goForward')">→</button>
      <button class="nav-btn" title="刷新" @click="emit('reload')">↻</button>
    </div>
  </div>
</template>

<script setup lang="ts">
interface props {
  // 是否可以后退
  canGoBack: boolean;
  // 是否可以前进
  canGoForward: boolean;
  // 是否正在加载
  isLoading: boolean;
}

withDefaults(defineProps<props>(), {
  canGoBack: false,
  canGoForward: false,
  isLoading: false
});

const emit = defineEmits(['goBack', 'goForward', 'reload']);
</script>

<style scoped>
.address-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
}

.nav-buttons {
  display: flex;
  gap: 4px;
}

.nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  font-size: 16px;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 4px;
}

.nav-btn:hover:not(:disabled) {
  background: var(--hover-bg, #e0e0e0);
}

.nav-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
</style>
