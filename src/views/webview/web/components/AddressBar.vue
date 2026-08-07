<template>
  <div class="address-bar">
    <div class="nav-buttons">
      <BButton type="ghost" size="small" square :disabled="!canGoBack" icon="lucide:arrow-left" @click="emit('goBack')" />
      <BButton type="ghost" size="small" square :disabled="!canGoForward" icon="lucide:arrow-right" @click="emit('goForward')" />
      <BButton type="ghost" size="small" square :icon="isLoading ? 'lucide:x' : 'lucide:refresh-cw'" @click="isLoading ? emit('stop') : emit('reload')" />
    </div>

    <div class="address-input">
      <input :value="url" class="address-input__control" type="text" spellcheck="false" @keydown.enter="handleEnter" />

      <BIcon icon="lucide:copy" class="address-input__icon" @click="handleCopy" />
    </div>

    <div class="action-buttons">
      <BButton
        type="ghost"
        size="small"
        square
        :icon="isDeviceToolbarVisible ? 'lucide:monitor-off' : 'lucide:monitor-smartphone'"
        @click="emit('toggleDeviceToolbar')"
      />
      <BButton
        :type="isElementSelecting ? 'secondary' : 'ghost'"
        size="small"
        square
        :icon="isElementSelecting ? 'lucide:scan-line' : 'lucide:mouse-pointer-click'"
        @click="emit('selectElement')"
      />
      <BButton :type="isInspectorOpen ? 'secondary' : 'ghost'" size="small" square :icon="'lucide:hash'" @click="emit('toggleInspector')" />
      <BButton type="ghost" size="small" square placement="bottomRight" icon="lucide:external-link" @click="emit('openInBrowser')" />

      <BDropdown placement="bottomRight">
        <BButton type="ghost" size="small" square icon="lucide:more-vertical" />

        <template #overlay>
          <BDropdownMenu :options="moreActionOptions" :width="180" />
        </template>
      </BDropdown>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file AddressBar.vue
 * @description Web WebView 地址栏组件（支持设备工具栏、元素选择、CSS 查看器）。
 */
import { computed } from 'vue';
import type { DropdownOption } from '@/components/BDropdown/type';
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
  /** 是否正在选择页面 DOM 元素 */
  isElementSelecting?: boolean;
  /** 设备工具栏是否可见 */
  isDeviceToolbarVisible?: boolean;
  /** CSS 查看器是否打开 */
  isInspectorOpen?: boolean | null;
  /** 是否存在已选中的页面元素 */
  hasSelectedElement?: boolean;
  /** 是否正在执行截图任务 */
  isScreenshotCapturing?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  isElementSelecting: false,
  isDeviceToolbarVisible: false,
  isInspectorOpen: false,
  hasSelectedElement: false,
  isScreenshotCapturing: false
});

const emit = defineEmits<{
  goBack: [];
  goForward: [];
  reload: [];
  stop: [];
  openInBrowser: [];
  openDevTools: [];
  selectElement: [];
  toggleDeviceToolbar: [];
  toggleInspector: [];
  captureViewportScreenshot: [];
  captureFullPageScreenshot: [];
  captureSelectedElementScreenshot: [];
  clearCache: [];
  submitUrl: [value: string];
}>();

/**
 * 截图子菜单项。
 */
const screenshotActionOptions = computed<DropdownOption[]>(() => {
  const options: DropdownOption[] = [
    {
      type: 'item',
      value: 'capture-viewport',
      label: '当前视图',
      icon: 'lucide:image',
      disabled: props.isScreenshotCapturing,
      onClick: () => emit('captureViewportScreenshot')
    },
    {
      type: 'item',
      value: 'capture-full-page',
      label: '完整视图尺寸',
      icon: 'lucide:scroll-text',
      disabled: props.isScreenshotCapturing,
      onClick: () => emit('captureFullPageScreenshot')
    }
  ];

  if (props.hasSelectedElement) {
    options.push({
      type: 'item',
      value: 'capture-selected-element',
      label: '选中元素',
      icon: 'lucide:scan',
      disabled: props.isScreenshotCapturing,
      onClick: () => emit('captureSelectedElementScreenshot')
    });
  }

  return options;
});

/**
 * 更多操作菜单项。
 */
const moreActionOptions = computed<DropdownOption[]>(() => [
  {
    type: 'item',
    value: 'screenshot',
    label: '截图',
    icon: 'lucide:camera',
    disabled: props.isScreenshotCapturing,
    children: screenshotActionOptions.value
  },
  {
    type: 'item',
    value: 'open-dev-tools',
    label: '打开开发者工具',
    icon: 'lucide:bug',
    onClick: () => emit('openDevTools')
  },
  {
    type: 'divider'
  },
  {
    type: 'item',
    value: 'clear-cache',
    label: '删除缓存数据',
    icon: 'lucide:eraser',
    onClick: () => emit('clearCache')
  }
]);

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
  flex-shrink: 0;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 12px;
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
  font-family: var(--font-sans);
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
