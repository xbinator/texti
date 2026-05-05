<template>
  <div class="info-section">
    <div class="section-header">
      <div class="provider-logo">
        <img v-if="provider.logo" :src="provider.logo" :alt="provider.name" class="provider-logo-img" />
        <Icon v-else-if="provider.isCustom" icon="lucide:bot" width="32" height="32" />
        <BModelIcon v-else :provider="provider.id" :size="32" />
      </div>
      <div class="provider-meta">
        <div class="provider-header">
          <div class="provider-title">
            <h3 class="provider-name">{{ provider.name }}</h3>
            <span v-if="provider" class="provider-type-tag">{{ providerTypeLabel }}</span>
          </div>
          <div class="provider-actions">
            <div v-if="provider?.isCustom" class="edit-btn" @click="handleEdit">
              <Icon icon="lucide:settings" width="14" height="14" />
            </div>
            <ASwitch :checked="provider?.isEnabled ?? false" size="small" @change="(checked) => handleToggle(checked as boolean)" />
          </div>
        </div>
        <p class="provider-desc">{{ provider.description }}</p>
        <span class="model-count">{{ provider.models?.length || 0 }} 个模型</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AIProvider } from 'types/ai';
import { Icon } from '@iconify/vue';
import BModelIcon from '@/components/BModelIcon/index.vue';

interface Props {
  provider?: Partial<AIProvider>;
  providerTypeLabel?: string;
}

const emit = defineEmits<{
  edit: [];
  toggle: [enabled: boolean];
}>();

withDefaults(defineProps<Props>(), {
  provider: () => ({}),
  providerTypeLabel: ''
});

function handleEdit(): void {
  emit('edit');
}

function handleToggle(enabled: boolean): void {
  emit('toggle', enabled);
}
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

.provider-logo-img {
  width: 32px;
  height: 32px;
  object-fit: cover;
  border-radius: 8px;
}

.provider-meta {
  flex: 1;
}

.provider-header {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.provider-title {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.provider-name {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
}

.provider-type-tag {
  padding: 2px 8px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  border-radius: 4px;
}

.provider-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.edit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.edit-btn:hover {
  color: var(--text-primary);
  background: var(--bg-secondary);
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
