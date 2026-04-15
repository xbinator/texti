<template>
  <div class="editor-sidebar">
    <BChat v-model:value="messages" service-type="chat" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Message } from '@/components/BChat/types';

const messages = ref<Message[]>([]);
</script>

<style scoped lang="less">
.editor-sidebar {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  height: 100%;
  margin-right: 6px;
  overflow: hidden;
  background: var(--bg-primary);
  border-radius: 8px;

  :deep(.b-bubble--left .b-bubble__container) {
    padding: 12px 0 0;
  }
}
</style>
