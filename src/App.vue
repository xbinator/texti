<template>
  <AConfigProvider :locale="zhCN" :theme="antdTheme">
    <BTitleBar />
    <div class="app-container" :class="{ 'app-container--with-titlebar': showTitleBar }">
      <RouterView />
    </div>
  </AConfigProvider>
</template>

<script lang="ts" setup>
import { computed, onMounted } from 'vue';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import theme from 'ant-design-vue/es/theme';
import BTitleBar from '@/components/BTitleBar/index.vue';
import { isElectron, isMac } from '@/shared/platform/env';
import { useSettingStore } from '@/stores/setting';

const { darkAlgorithm, defaultAlgorithm } = theme;
const settingStore = useSettingStore();

onMounted(async () => {
  settingStore.initTheme();
});

const antdTheme = computed(() => ({
  algorithm: settingStore.resolvedTheme === 'dark' ? darkAlgorithm : defaultAlgorithm,
  token: {
    colorPrimary: '#1677ff'
  }
}));

const showTitleBar = computed(() => isElectron() && !isMac());
</script>

<style>
.app-container {
  min-height: 100vh;
}

.app-container--with-titlebar {
  padding-top: 32px;
}
</style>
