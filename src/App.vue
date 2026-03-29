<template>
  <AConfigProvider :locale="zhCN">
    <RouterView />
  </AConfigProvider>
</template>

<script lang="ts" setup>
import zhCN from 'ant-design-vue/es/locale/zh_CN';
</script>

<style></style>
