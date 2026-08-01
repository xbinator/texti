<!--
  @file SettingsPage.vue
  @description 设置模块私有页面布局组件，提供标题栏、扩展操作区和内容滚动区域。
-->
<template>
  <div class="settings-page">
    <div class="settings-page__header">
      <div class="settings-page__title">
        <slot name="title">{{ title }}</slot>
      </div>

      <div class="settings-page__extra">
        <slot name="extra"></slot>
      </div>
    </div>
    <div class="settings-page__body">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'SettingsPage' });

/**
 * 设置页面布局 props。
 */
interface Props {
  /** 页面标题 */
  title?: string;
}

withDefaults(defineProps<Props>(), {
  title: ''
});
</script>

<style scoped lang="less">
.settings-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
  border: var(--surface-border-width) solid var(--border-primary);
  border-radius: var(--surface-radius);
}

.settings-page__header {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  align-items: center;
  height: 40px;
  padding: 0 10px 0 20px;
  border-bottom: 1px solid var(--border-primary);
}

.settings-page__title {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.settings-page__extra {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-left: auto;
}

.settings-page__body {
  flex: 1;
  width: 100%;
  padding: 20px;
  overflow: auto;
}
</style>
