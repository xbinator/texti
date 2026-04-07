<template>
  <div class="provider-layout">
    <ProviderSidebar />
    <RouterView />
  </div>
</template>

<script setup lang="ts">
import ProviderSidebar from './components/ProviderSidebar.vue';
</script>

<style scoped lang="less">
.provider-layout {
  display: flex;
  gap: 16px;
  height: 100%;
  padding: 20px;
}
</style>
