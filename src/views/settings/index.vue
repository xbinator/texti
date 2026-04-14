<template>
  <div class="settings-container">
    <div class="settings-sidebar">
      <RouterLink v-for="item in menuItems" :key="item.key" :to="item.path" class="sidebar-item" :class="{ active: isActive(item.key) }">
        <Icon :icon="item.icon" />
        <span>{{ item.label }}</span>
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
  display: flex;
  height: 100%;
}

.settings-sidebar {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  width: 280px;
  height: 100%;
  padding: 6px 8px 8px;
  overflow-y: auto;
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
  gap: 12px;
  align-items: center;
  height: 38px;
  padding: 0 14px;
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

.settings-content {
  flex: 1;
  margin: 0 8px 8px 0;
  background: var(--bg-primary);
  border-radius: 8px;
}
</style>
