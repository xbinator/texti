<!--
  @file SettingsSection.vue
  @description 设置模块私有分区布局组件，提供分区标题、扩展操作区和内容插槽。
-->
<template>
  <section class="settings-section">
    <div class="settings-section__header">
      <span class="settings-section__header-text">{{ title }}</span>

      <div class="settings-section__header-extra">
        <slot name="extra"></slot>
      </div>
    </div>

    <div :class="['settings-section__content', contentClass]">
      <slot></slot>
    </div>
  </section>
</template>

<script setup lang="ts">
defineOptions({ name: 'SettingsSection' });

/**
 * 设置分区容器 props。
 */
interface Props {
  /** 分区标题 */
  title: string;
  /** 分区内容类名 */
  contentClass?: string;
}

withDefaults(defineProps<Props>(), {
  contentClass: ''
});
</script>

<style scoped lang="less">
.settings-section {
  max-width: 820px;
  margin: 0 auto;
  overflow: hidden;
  user-select: text;
  background: var(--bg-primary);
  border: var(--surface-border-width) solid var(--border-primary);
  border-radius: var(--surface-radius);
  box-shadow: var(--shadow-sm);

  + .settings-section {
    margin-top: 16px;
  }
}

.settings-section__header {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-primary);
}

.settings-section__header-text {
  flex-shrink: 0;
}

.settings-section__header-extra {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-left: auto;
  font-weight: 400;
}
</style>
