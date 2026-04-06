<template>
  <div class="provider-card" @click="handleClick">
    <div class="card-header">
      <div class="provider-logo">
        <img v-if="provider.logo" :src="provider.logo" :alt="provider.name" class="provider-logo-img" />
        <Icon v-else-if="provider.isCustom" icon="lucide:bot" width="28" height="28" />
        <BModelIcon v-else :provider="provider.id" :size="28" />
      </div>
      <ASwitch :checked="provider.isEnabled" size="small" @change="(checked) => handleToggle(checked as boolean)" />
    </div>
    <div class="card-body">
      <div class="provider-name">{{ provider.name }}</div>
      <div class="provider-desc">{{ provider.description }}</div>
    </div>
    <div class="card-footer">
      <span class="model-count">{{ provider.models?.length || 0 }} 个模型</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Provider } from '../types';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import BModelIcon from '@/components/BModelIcon/index.vue';

const router = useRouter();

interface Props {
  provider: Provider;
}

const props = withDefaults(defineProps<Props>(), {});

const emit = defineEmits<{
  (e: 'toggle', id: string, enabled: boolean): void;
}>();

function handleToggle(checked: boolean | string): void {
  emit('toggle', props.provider.id, checked as boolean);
}

function handleClick(): void {
  router.push(`/settings/provider/${props.provider.id}`);
}
</script>

<style scoped lang="less">
.provider-card {
  display: flex;
  flex-direction: column;
  padding: 16px;
  cursor: pointer;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 10px;
  transition: all 0.15s;

  &:hover {
    border-color: var(--color-primary-border, rgb(0 0 0 / 8%));
    box-shadow: 0 2px 8px rgb(0 0 0 / 6%);
  }

  &:active {
    transform: scale(0.98);
    transition: transform 0.1s;
  }
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}

.provider-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: var(--bg-secondary);
  border-radius: 10px;
}

.provider-logo-img {
  width: 28px;
  height: 28px;
  object-fit: cover;
  border-radius: 6px;
}

.card-body {
  flex: 1;
  margin-bottom: 10px;
}

.provider-name {
  margin-bottom: 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.provider-desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.card-footer {
  padding-top: 10px;
  border-top: 1px solid var(--border-primary);
}

.model-count {
  font-size: 11px;
  color: var(--text-tertiary);
}
</style>
