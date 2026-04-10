<template>
  <AConfigProvider :locale="zhCN" :theme="antdTheme">
    <BTitleBar v-if="showTitleBar" />

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
import { isElectron } from '@/shared/platform/env';
import { useSettingStore } from '@/stores/setting';

const { darkAlgorithm, defaultAlgorithm } = theme;
const settingStore = useSettingStore();

onMounted(() => {
  // 统一初始化所有设置
  settingStore.init();
});

const antdTheme = computed(() => ({
  algorithm: settingStore.resolvedTheme === 'dark' ? darkAlgorithm : defaultAlgorithm,
  token: {
    colorPrimary: '#1677ff'
  }
}));

const showTitleBar = computed(() => isElectron());
</script>

<style>
#app {
  height: 100%;
}

.app-container {
  height: 100%;
}

.app-container--with-titlebar {
  padding-top: 32px;
}
</style>
