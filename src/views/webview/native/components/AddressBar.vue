<template>
  <div class="address-bar">
    <div class="nav-buttons">
      <BButton type="text" size="small" square :disabled="!canGoBack" tooltip="后退" icon="lucide:arrow-left" @click="emit('goBack')" />
      <BButton type="text" size="small" square :disabled="!canGoForward" tooltip="前进" icon="lucide:arrow-right" @click="emit('goForward')" />
      <BButton
        type="text"
        size="small"
        square
        :tooltip="isLoading ? '停止' : '刷新'"
        :icon="isLoading ? 'lucide:x' : 'lucide:refresh-cw'"
        @click="isLoading ? emit('stop') : emit('reload')"
      />
    </div>

    <div class="address-input">
      <input :value="url" class="address-input__control" type="text" spellcheck="false" @keydown.enter="handleEnter" />

      <BIcon icon="lucide:copy" class="address-input__icon" @click="handleCopy" />
    </div>

    <div class="action-buttons">
      <BButton type="text" size="small" square tooltip="在浏览器打开" placement="bottomRight" icon="lucide:external-link" @click="emit('openInBrowser')" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file AddressBar.vue
 * @description Native WebView 地址栏组件（不支持设备工具栏、元素选择、CSS 查看器）。
 */
import { useClipboard } from '@/hooks/useClipboard';

const { clipboard } = useClipboard();

interface Props {
  /** 当前地址 */
  url: string;
  /** 是否允许后退 */
  canGoBack?: boolean;
  /** 是否允许前进 */
  canGoForward?: boolean;
  /** 是否正在加载 */
  isLoading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  canGoBack: false,
  canGoForward: false,
  isLoading: false
});

const emit = defineEmits<{
  goBack: [];
  goForward: [];
  reload: [];
  stop: [];
  openInBrowser: [];
  submitUrl: [value: string];
}>();

/**
 * 提交地址栏中的 URL。
 * @param event - 键盘事件
 */
function handleEnter(event: KeyboardEvent): void {
  const { target } = event;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  emit('submitUrl', target.value);
}

/**
 * 复制当前 URL 到剪贴板。
 */
function handleCopy(): void {
  clipboard(props.url, { successMessage: '已复制地址' });
}
</script>

<style scoped lang="less">
.address-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-primary);
}

.nav-buttons,
.action-buttons {
  display: flex;
  gap: 4px;
}

.address-input {
  display: flex;
  flex: 1;
  align-items: center;
  min-width: 0;
  height: 28px;
  padding: 0 10px;
  color: var(--text-primary);
  background: var(--input-bg);
  border: var(--input-border-width) solid var(--input-border);
  border-radius: var(--input-radius);
  box-shadow: var(--input-shadow);
  transition: border-color var(--motion-duration-base) var(--motion-easing-standard), box-shadow var(--motion-duration-base) var(--motion-easing-standard);

  &:focus-within {
    border-color: var(--input-focus-border);
    box-shadow: var(--input-active-shadow);
  }
}

.address-input__control {
  width: 100%;
  min-width: 0;
  font-family: var(--input-font-family);
  color: var(--text-primary);
  outline: none;
  background: transparent;
  border: none;

  &::placeholder {
    color: var(--input-placeholder-color);
    opacity: 1;
  }
}

.address-input__icon {
  flex-shrink: 0;
  margin-left: 6px;
  color: var(--input-icon-color);
  cursor: pointer;
  opacity: 0;
  transition: color var(--motion-duration-base) var(--motion-easing-standard), opacity var(--motion-duration-base) var(--motion-easing-standard);

  &:hover {
    color: var(--text-secondary);
  }
}

.address-input:hover .address-input__icon {
  opacity: 1;
}
</style>
