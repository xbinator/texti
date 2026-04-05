<template>
  <AConfigProvider :locale="zhCN" :theme="antdTheme">
    <RouterView />
  </AConfigProvider>
</template>

<script lang="ts" setup>
import { computed, onMounted } from 'vue';
import { isTauri } from '@tauri-apps/api/core';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import theme from 'ant-design-vue/es/theme';
import { useSettingStore } from '@/stores/setting';
import { initDatabase } from '@/utils/database';
import { initStronghold } from '@/utils/stronghold';

const { darkAlgorithm, defaultAlgorithm } = theme;
const settingStore = useSettingStore();

onMounted(async () => {
  settingStore.initTheme();

  // 只在 Tauri 环境中初始化数据库和 stronghold
  if (isTauri()) {
    await initDatabase();
    await initStronghold();
  }
});

const antdTheme = computed(() => ({
  algorithm: settingStore.resolvedTheme === 'dark' ? darkAlgorithm : defaultAlgorithm,
  token: {
    colorPrimary: '#1677ff'
  }
}));
</script>

<style></style>
