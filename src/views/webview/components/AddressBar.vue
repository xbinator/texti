<template>
  <div class="address-bar">
    <div class="nav-buttons">
      <button class="nav-btn" :disabled="!canGoBack" title="后退" @click="emit('goBack')">←</button>
      <button class="nav-btn" :disabled="!canGoForward" title="前进" @click="emit('goForward')">→</button>
      <button class="nav-btn" :disabled="!isLoading" title="停止" @click="emit('stop')">⏹</button>
      <button class="nav-btn" title="刷新" @click="emit('reload')">↻</button>
    </div>

    <div class="url-input-wrapper">
      <input
        ref="inputRef"
        type="text"
        class="url-input"
        :value="url"
        placeholder="输入网址..."
        spellcheck="false"
        autocomplete="off"
        @keydown.enter="handleSubmit"
      />
      <button class="go-btn" title="转到" @click="handleSubmit">⏎</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

interface props {
  // 当前 URL
  url: string;
  // 是否可以后退
  canGoBack: boolean;
  // 是否可以前进
  canGoForward: boolean;
  // 是否正在加载
  isLoading: boolean;
}

withDefaults(defineProps<props>(), {
  url: '',
  canGoBack: false,
  canGoForward: false,
  isLoading: false
});

const emit = defineEmits<{
  (e: 'navigate', url: string): void;
  (e: 'goBack'): void;
  (e: 'goForward'): void;
  (e: 'reload'): void;
  (e: 'stop'): void;
}>();

const inputRef = ref<HTMLInputElement | null>(null);

const handleSubmit = () => {
  const url = inputRef.value?.value.trim() || '';
  if (!url) return;

  // 自动添加 https:// 如果没有协议
  let finalUrl = url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    finalUrl = `https://${url}`;
  }

  emit('navigate', finalUrl);
};
</script>

<style scoped>
.address-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  background: var(--bg-secondary, #f5f5f5);
  border-bottom: 1px solid var(--border-color, #e0e0e0);
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

.url-input-wrapper {
  display: flex;
  flex: 1;
  align-items: center;
  overflow: hidden;
  background: var(--bg-input, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
}

.url-input {
  flex: 1;
  padding: 8px 12px;
  font-size: 14px;
  outline: none;
  background: transparent;
  border: none;
}

.go-btn {
  padding: 8px 12px;
  font-size: 14px;
  cursor: pointer;
  background: transparent;
  border: none;
}

.go-btn:hover {
  background: var(--hover-bg, #e0e0e0);
}
</style>
