<template>
  <div class="settings-layout">
    <div class="settings-sidebar">
      <div class="sidebar-header" @click="handleBack">
        <Icon icon="uis:angle-left" width="24" height="24" />
        <span>设置</span>
      </div>

      <div class="sidebar-content">
        <RouterLink v-for="item in menuItems" :key="item.key" :to="item.path" class="sidebar-item" :class="{ active: isActive(item.key) }">
          <Icon :icon="item.icon" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </div>
    </div>

    <div class="settings-container">
      <RouterView />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router';
import { Icon } from '@iconify/vue';
import { menuItems, type SettingsMenuKey } from './constants';

const router = useRouter();
const route = useRoute();

function isActive(key: SettingsMenuKey): boolean {
  const prefix = `/settings/${key}`;

  return route.path === prefix || route.path.startsWith(`${prefix}/`);
}

function handleBack(): void {
  router.push('/');
}
</script>

<style scoped lang="less">
.settings-layout {
  display: flex;
  height: 100vh;
  background: var(--bg-secondary);
}

.settings-sidebar {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  width: 280px;
  height: 100vh;
}

.sidebar-header {
  display: flex;
  gap: 8px;
  align-items: center;
  height: 52px;
  padding: 0 14px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
  transition: color 0.15s;

  &:hover {
    color: var(--color-primary);
  }
}

.sidebar-content {
  flex: 1;
  padding: 8px;
  overflow-y: auto;
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

.settings-container {
  flex: 1;
  margin: 8px;
  background: var(--bg-primary);
  border-radius: 8px;
}
</style>
