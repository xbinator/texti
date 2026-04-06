<template>
  <div class="info-section">
    <div class="section-header">
      <div class="provider-logo">
        <BModelIcon :provider="provider.id" :size="32" />
      </div>
      <div class="provider-meta">
        <h3 class="provider-name">{{ provider.name }}</h3>
        <p class="provider-desc">{{ provider.description }}</p>
        <span class="model-count">{{ 0 }} 个模型</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Provider } from '../types';
import BModelIcon from '@/components/BModelIcon/index.vue';

interface Props {
  // 服务商信息
  provider?: Partial<Provider>;
}

withDefaults(defineProps<Props>(), { provider: () => ({}) });
</script>

<style scoped lang="less">
.info-section {
  padding: 20px;
  background: var(--bg-secondary);
  border-radius: 10px;
}

.section-header {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.provider-logo {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 50px;
  height: 50px;
  background: var(--bg-primary);
  border-radius: 12px;
}

.provider-meta {
  flex: 1;
}

.provider-name {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
}

.provider-desc {
  margin: 0 0 8px;
  font-size: 14px;
  line-height: 1.4;
  color: var(--text-secondary);
}

.model-count {
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>
