<template>
  <div class="address-bar">
    <div class="nav-buttons">
      <BButton type="text" size="small" square :disabled="!canGoBack" title="后退" icon="lucide:arrow-left" @click="emit('goBack')" />
      <BButton type="text" size="small" square :disabled="!canGoForward" title="前进" icon="lucide:arrow-right" @click="emit('goForward')" />
      <BButton type="text" size="small" square title="刷新" icon="lucide:refresh-cw" @click="emit('reload')" />
    </div>

    <div class="action-buttons">
      <BButton type="text" size="small" square title="在浏览器打开" icon="lucide:external-link" @click="emit('openInBrowser')" />
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  canGoBack?: boolean;
  canGoForward?: boolean;
  isLoading?: boolean;
  url?: string;
}

withDefaults(defineProps<Props>(), {
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  url: ''
});

const emit = defineEmits<{
  goBack: [];
  goForward: [];
  reload: [];
  openInBrowser: [];
}>();
</script>

<style scoped>
.address-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-color);
}

.nav-buttons,
.action-buttons {
  display: flex;
  gap: 4px;
}
</style>
