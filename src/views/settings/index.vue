<template>
  <div class="settings-layout">
    <div class="settings-header">
      <div class="header-back" @click="handleBack">
        <Icon icon="lucide:arrow-left" />
        <span>返回</span>
      </div>
    </div>

    <div class="settings-body">
      <div class="settings-sidebar">
        <div v-for="item in menuItems" :key="item.key" class="sidebar-item" :class="{ active: activeMenu === item.key }" @click="activeMenu = item.key">
          <Icon :icon="item.icon" />
          <span>{{ item.label }}</span>
        </div>
      </div>

      <div class="settings-content">
        <ApiKeyManager v-if="activeMenu === 'apiKeys'" />
        <ModelManager v-else-if="activeMenu === 'models'" />
        <AssistantManager v-else-if="activeMenu === 'assistants'" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import ApiKeyManager from './components/ApiKeyManager.vue';
import AssistantManager from './components/AssistantManager.vue';
import ModelManager from './components/ModelManager.vue';
import { menuItems, type SettingsMenuKey } from './constants';

const router = useRouter();
const activeMenu = ref<SettingsMenuKey>('apiKeys');

function handleBack(): void {
  router.push('/');
}
</script>

<style scoped lang="less">
.settings-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg-secondary);
}

.settings-header {
  display: flex;
  flex-shrink: 0;
  gap: 16px;
  align-items: center;
  height: 48px;
  padding: 0 20px;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-primary);
}

.header-back {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.2s;

  &:hover {
    color: var(--text-primary);
  }
}

.header-title {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
}

.settings-body {
  display: flex;
  flex: 1;
  height: 0;
}

.settings-sidebar {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  gap: 4px;
  width: 200px;
  padding: 16px 12px;
  background: var(--bg-primary);
  border-right: 1px solid var(--border-primary);
}

.sidebar-item {
  display: flex;
  gap: 10px;
  align-items: center;
  height: 40px;
  padding: 0 12px;
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.2s;

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  &.active {
    color: var(--color-primary);
    background: var(--color-primary-bg);
  }
}

.settings-content {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}
</style>
