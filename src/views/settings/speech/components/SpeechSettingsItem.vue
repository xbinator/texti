<!--
  @file SpeechSettingsItem.vue
  @description 语音设置行，展示图标、标签、提示与右侧插槽值。
-->
<template>
  <div class="speech-settings-item" :class="{ 'speech-settings-item--path': path }">
    <div class="speech-settings-item__main">
      <Icon :icon="icon" class="speech-settings-item__icon" />
      <div>
        <div class="speech-settings-item__label">{{ label }}</div>
        <div class="speech-settings-item__hint">{{ hint }}</div>
      </div>
    </div>
    <div class="speech-settings-item__value" :class="{ 'speech-settings-item__value--path': path }">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';

defineProps<{
  icon: string;
  label: string;
  hint: string;
  path?: boolean;
}>();
</script>

<style scoped lang="less">
.speech-settings-item {
  display: flex;
  gap: 16px;
  align-items: center;
  min-height: 64px;
  padding: 12px 16px;
  transition: background 0.2s ease;

  & + & {
    border-top: 1px solid var(--border-tertiary);
  }

  &:hover {
    background: var(--bg-hover);
  }

  &--path {
    align-items: flex-start;
  }
}

.speech-settings-item__main {
  display: flex;
  flex: 1;
  gap: 10px;
  align-items: center;
  min-width: 0;
}

.speech-settings-item__icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  color: var(--text-tertiary);
}

.speech-settings-item__label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.speech-settings-item__hint {
  margin-top: 3px;
  font-size: 12px;
  color: var(--text-secondary);
}

.speech-settings-item__value {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  align-items: center;
  max-width: 50%;
  font-size: 13px;
  color: var(--text-primary);
  text-align: right;

  &--path {
    flex-shrink: 1;
    line-height: 1.5;
    color: var(--text-secondary);
    word-break: break-all;
  }
}
</style>
