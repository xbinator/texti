<template>
  <div class="settings-container">
    <div class="settings-sidebar">
      <RouterLink v-for="item in menuItems" :key="item.key" :to="item.path" class="sidebar-item" :class="{ active: isActive(item.key) }">
        <Icon :icon="item.icon" class="sidebar-item__icon" />
        <span class="sidebar-item__label">{{ item.label }}</span>
      </RouterLink>
    </div>

    <div class="settings-content">
      <RouterView />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router';
import { Icon } from '@iconify/vue';
import { menuItems, type SettingsMenuKey } from './constants';

const route = useRoute();

function isActive(key: SettingsMenuKey): boolean {
  const prefix = `/settings/${key}`;

  return route.path === prefix || route.path.startsWith(`${prefix}/`);
}
</script>

<style scoped lang="less">
.settings-container {
  --sidebar-width-large: 280px;
  --sidebar-width-small: 60px;
  --container-width-threshold: 800px;

  display: flex;
  height: 100%;
  container-type: inline-size;
}

.settings-sidebar {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  width: var(--sidebar-width-small);
  height: 100%;
  padding: 16px 14px 12px 8px;
  overflow-y: auto;
  transition: width 0.3s ease;
}

.settings-header-back {
  display: flex;
  gap: 8px;
  align-items: center;
  height: 40px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
  transition: color 0.15s;

  &:hover {
    color: var(--color-primary);
  }
}

.sidebar-item {
  display: flex;
  gap: 0;
  align-items: center;
  justify-content: center;
  height: 38px;
  padding: 0;
  margin-bottom: 8px;
  font-size: 14px;
  color: var(--text-secondary);
  text-decoration: none;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s;

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  &.active {
    font-weight: 500;
    color: var(--text-primary);
    background: var(--color-primary-bg);
  }
}

.sidebar-item__icon {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
}

.sidebar-item__label {
  width: 0;
  overflow: hidden;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.3s ease, width 0.3s ease;
}

.settings-content {
  flex: 1;
  background: var(--bg-primary);
  border-radius: 8px;
}

@container (min-width: 900px) {
  .settings-sidebar {
    width: var(--sidebar-width-large);
  }

  .sidebar-item {
    gap: 12px;
    justify-content: flex-start;
    padding: 0 14px;
  }

  .sidebar-item__label {
    width: auto;
    opacity: 1;
  }
}
</style>
