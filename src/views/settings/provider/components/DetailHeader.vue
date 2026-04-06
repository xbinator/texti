<template>
  <div class="detail-header">
    <div class="header-left" @click="$emit('back')">
      <Icon icon="lucide:arrow-left" class="back-icon" />
      <h2 class="page-title">{{ title }}</h2>
    </div>
    <ASwitch :checked="isEnabled" size="small" @change="(checked) => $emit('toggle', checked as boolean)" />
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';

interface Props {
  title: string;
  isEnabled: boolean;
}

defineProps<Props>();

defineEmits<{
  (e: 'back'): void;
  (e: 'toggle', value: boolean): void;
}>();
</script>

<style scoped lang="less">
.detail-header {
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
  cursor: pointer;
}

.back-icon {
  width: 20px;
  height: 20px;
  color: var(--text-primary);
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}
</style>
