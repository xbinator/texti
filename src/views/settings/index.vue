<template>
  <div class="settings-layout">
    <div class="settings-header">
      <div class="header-back" @click="handleBack">
        <Icon icon="lucide:arrow-left" />
        <span>设置</span>
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
  align-items: center;
  height: 60px;
  padding: 0 24px;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-primary);
}

.header-back {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-primary);
  }
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
  width: 220px;
  padding: 20px 16px;
  background: var(--bg-primary);
  border-right: 1px solid var(--border-primary);
}

.sidebar-item {
  display: flex;
  gap: 12px;
  align-items: center;
  height: 44px;
  padding: 0 16px;
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.15s ease;

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
  padding: 24px;
  margin: 20px;
  overflow-y: auto;
  background: var(--bg-primary);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 8%);
}
</style>
