<template>
  <AConfigProvider :locale="zhCN" :theme="antdTheme">
    <RouterView />
  </AConfigProvider>
</template>

<script lang="ts" setup>
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import { useAntdTheme } from '@/hooks/useAntdTheme';
import { useMenuAction } from '@/hooks/useMenuAction';

const { antdTheme } = useAntdTheme();
useMenuAction();
</script>

<style>
#app {
  height: 100%;
}
</style>
