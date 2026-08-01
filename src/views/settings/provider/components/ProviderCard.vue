<template>
  <div ref="cardRef" class="provider-card" :data-provider-id="provider.id" @click="handleClick">
    <div class="card-header">
      <div class="provider-logo">
        <img v-if="provider.logo" :src="provider.logo" :alt="provider.name" class="provider-logo-img" />
        <Icon v-else-if="provider.isCustom" icon="lucide:bot" width="28" height="28" />
        <BModelIcon v-else :provider="provider.id" :size="28" />
      </div>
      <div @click.stop>
        <ASwitch :checked="provider.isEnabled" size="small" @change="(checked) => handleToggle(checked as boolean)" />
      </div>
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
import type { AIProvider } from 'types/ai';
import { ref } from 'vue';
import { Icon } from '@iconify/vue';
import BModelIcon from '@/components/BModel/Icon.vue';
import { useProviderTransition } from '../hooks/useProviderTransition';

interface Props {
  provider: AIProvider;
}

const props = withDefaults(defineProps<Props>(), {});

const emit = defineEmits<{ (e: 'toggle', id: string, enabled: boolean): void }>();

const { navigateToDetail } = useProviderTransition();

/** 卡片根元素引用，用于视图过渡捕获共享元素位置。 */
const cardRef = ref<HTMLElement>();

function handleToggle(checked: boolean | string): void {
  emit('toggle', props.provider.id, checked as boolean);
}

/**
 * 点击卡片时触发共享元素缩放转场进入详情页。
 */
async function handleClick(): Promise<void> {
  if (cardRef.value) {
    await navigateToDetail(cardRef.value, props.provider.id);
  }
}
</script>

<style scoped lang="less">
.provider-card {
  display: flex;
  flex-direction: column;
  padding: 16px;
  cursor: pointer;
  background: var(--bg-primary);
  border: var(--surface-border-width) solid var(--border-primary);
  border-radius: var(--surface-radius);
  transition: border-color var(--motion-duration-fast) var(--motion-easing-standard), box-shadow var(--motion-duration-fast) var(--motion-easing-standard),
    transform var(--motion-duration-fast) var(--motion-easing-press);

  &:hover {
    border-color: var(--color-primary-border, rgb(0 0 0 / 8%));
    box-shadow: var(--shadow-sm);
  }

  &:active {
    transform: scale(0.98);
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
  border-radius: var(--surface-radius);
}

.provider-logo-img {
  width: 28px;
  height: 28px;
  object-fit: cover;
  border-radius: var(--control-radius);
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
