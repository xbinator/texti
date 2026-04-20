<template>
  <div class="settings-container">
    <div class="settings-sidebar" :class="{ 'settings-sidebar--collapsed': sidebarCollapsed }">
      <RouterLink v-for="item in menuItems" :key="item.key" :to="item.path" class="sidebar-item" :class="{ active: isActive(item.key) }">
        <Icon :icon="item.icon" class="sidebar-item__icon" />
        <span class="sidebar-item__label">{{ item.label }}</span>
      </RouterLink>

      <button type="button" class="sidebar-collapse-btn" @click="toggleSidebarCollapsed">
        <Icon :icon="sidebarCollapsed ? 'lucide:panel-right-open' : 'lucide:panel-right-close'" width="14" height="14" />
      </button>
    </div>

    <div class="settings-content">
      <RouterView />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router';
import { storeToRefs } from 'pinia';
import { Icon } from '@iconify/vue';
import { useSettingStore } from '@/stores/setting';
import { menuItems, type SettingsMenuKey } from './constants';

const route = useRoute();
const settingStore = useSettingStore();
const { settingsSidebarCollapsed: sidebarCollapsed } = storeToRefs(settingStore);

function toggleSidebarCollapsed(): void {
  settingStore.setSettingsSidebarCollapsed(!sidebarCollapsed.value);
}

function isActive(key: SettingsMenuKey): boolean {
  const prefix = `/settings/${key}`;

  return route.path === prefix || route.path.startsWith(`${prefix}/`);
}
</script>

<style scoped lang="less">
.settings-container {
  --sidebar-width-large: 280px;
  --sidebar-width-small: 60px;

  display: flex;
  height: 100%;
}

.settings-sidebar {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  width: var(--sidebar-width-large);
  height: 100%;
  padding: 16px 14px 12px 8px;
  overflow-y: auto;
  transition: width 0.3s ease;

  &--collapsed {
    width: var(--sidebar-width-small);

    .sidebar-item {
      gap: 0;
      justify-content: center;
      padding: 0;
    }

    .sidebar-item__label {
      width: 0;
      opacity: 0;
    }
  }
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
  justify-content: flex-start;
  height: 38px;
  padding: 0 14px;
  margin-bottom: 8px;
  font-size: 14px;
  color: var(--text-secondary);
  text-decoration: none;
  cursor: pointer;
  user-select: none;
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
  overflow: hidden;
  white-space: nowrap;
  transition: opacity 0.3s ease, width 0.3s ease;
}

.sidebar-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 38px;
  margin-top: auto;
  color: var(--text-secondary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 6px;
  transition: all 0.15s;

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
}

.settings-content {
  flex: 1;
  background: var(--bg-primary);
  border-radius: 8px;
}
</style>
