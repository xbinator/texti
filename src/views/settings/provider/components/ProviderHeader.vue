<template>
  <div class="provider-header">
    <div class="header-left">
      <h2 class="content-title">AI 服务商</h2>
      <span class="enabled-count">已启用 {{ enabledCount }} 个服务商</span>
    </div>
    <div class="header-right">
      <AInput :value="searchText" placeholder="搜索服务商" allow-clear class="search-input" @update:value="$emit('update:searchText', $event)">
        <template #prefix>
          <Icon icon="lucide:search" />
        </template>
      </AInput>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';

defineProps<{
  enabledCount: number;
  searchText: string;
}>();

defineEmits<{
  (e: 'update:searchText', value: string): void;
}>();
</script>

<style scoped lang="less">
.provider-header {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.header-left {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.content-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.enabled-count {
  padding: 3px 10px;
  font-size: 12px;
  color: var(--color-primary);
  background: var(--color-primary-bg);
  border-radius: 10px;
}

.search-input {
  width: 200px;
}

:deep(.ant-input-affix-wrapper) {
  background: var(--bg-secondary);
  border-color: var(--border-primary);
}

:deep(.ant-input) {
  background: transparent;
}
</style>
