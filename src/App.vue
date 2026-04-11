<template>
  <AConfigProvider :locale="zhCN" :theme="antdTheme">
    <RouterView />
  </AConfigProvider>
</template>

<script lang="ts" setup>
import { computed, onMounted } from 'vue';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import theme from 'ant-design-vue/es/theme';
import { useSettingStore } from '@/stores/setting';

const { darkAlgorithm, defaultAlgorithm } = theme;
const settingStore = useSettingStore();

onMounted(() => {
  settingStore.init();
});

const antdTheme = computed(() => ({
  algorithm: settingStore.resolvedTheme === 'dark' ? darkAlgorithm : defaultAlgorithm,
  token: {
    colorPrimary: '#1677ff'
  }
}));
</script>

<style>
#app {
  height: 100%;
}
</style>
