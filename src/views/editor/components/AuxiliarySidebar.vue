<template>
  <BChat class="editor-sidebar" service-type="chat" />
</template>

<script setup lang="ts">
// 逻辑已抽离到 BChat 组件中
</script>

<style scoped lang="less">
.editor-sidebar {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-primary);
  border-radius: 8px;
}
</style>
