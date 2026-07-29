<template>
  <AConfigProvider :locale="zhCN" :theme="antdTheme">
    <RouterView />
  </AConfigProvider>
</template>

<script lang="ts" setup>
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import 'dayjs/locale/zh-cn';
import { useAntdTheme } from '@/hooks/useAntdTheme';
import { useProvideActorSystem } from '@/hooks/useChat/useActorSystem';
import { useMenuAction } from '@/hooks/useMenuAction';
import { useSystem } from '@/hooks/useSystem';
import { useWebviewNewTab } from '@/hooks/useWebviewNewTab';

const { antdTheme } = useAntdTheme();
/** 应用级 Chat Actor system 和 Runtime 事件监听。 */
useProvideActorSystem();
useMenuAction();
/** 将 WebView 新窗口请求转为应用内标签页。 */
useWebviewNewTab();

// 引导系统级事件监听（macOS "打开方式"、记忆加载等）
useSystem();
</script>

<style>
#app {
  height: 100%;
}
</style>
