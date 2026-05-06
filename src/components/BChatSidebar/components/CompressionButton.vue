<!--
  @file CompressionButton.vue
  @description 压缩按钮组件，提供手动压缩和查看摘要功能。
-->
<template>
  <BDropdown v-model:open="open" :align="{ offset: [-45, 0] }">
    <BButton square size="small" type="text" :disabled="disabled || compressing">
      <Icon v-if="compressing" icon="lucide:loader-2" width="16" height="16" class="is-spinning" />
      <Icon v-else icon="lucide:layers" width="16" height="16" />
    </BButton>

    <template #overlay>
      <div class="compression-menu" @click.stop>
        <div class="compression-menu__item" @click="handleCompress">
          <Icon icon="lucide:compress" width="14" height="14" />
          <span>{{ compressing ? '压缩中...' : '压缩上下文' }}</span>
        </div>

        <div v-if="currentSummary" class="compression-menu__item" @click="handleViewSummary">
          <Icon icon="lucide:file-text" width="14" height="14" />
          <span>查看摘要</span>
        </div>

        <div v-if="error" class="compression-menu__error">
          <Icon icon="lucide:alert-circle" width="14" height="14" />
          <span>{{ error }}</span>
        </div>

        <div v-if="currentSummary" class="compression-menu__info">
          <div class="compression-menu__info-label">已压缩</div>
          <div class="compression-menu__info-value">{{ currentSummary.messageCountSnapshot }} 轮对话</div>
        </div>
      </div>
    </template>
  </BDropdown>
</template>

<script setup lang="ts">
import type { ConversationSummaryRecord } from '../utils/compression/types';
import { ref } from 'vue';
import { Icon } from '@iconify/vue';
import BButton from '@/components/BButton/index.vue';
import BDropdown from '@/components/BDropdown/index.vue';

/**
 * 组件 Props 定义
 */
interface Props {
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否正在压缩 */
  compressing?: boolean;
  /** 当前摘要 */
  currentSummary?: ConversationSummaryRecord;
  /** 错误信息 */
  error?: string;
}

withDefaults(defineProps<Props>(), {
  disabled: false,
  compressing: false,
  currentSummary: undefined,
  error: undefined
});

const emit = defineEmits<{
  (e: 'compress'): void;
  (e: 'view-summary'): void;
}>();

const open = ref(false);

/**
 * 处理压缩操作
 */
function handleCompress(): void {
  open.value = false;
  emit('compress');
}

/**
 * 处理查看摘要操作
 */
function handleViewSummary(): void {
  open.value = false;
  emit('view-summary');
}
</script>

<style scoped lang="less">
.compression-menu {
  min-width: 180px;
  padding: 4px 0;
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgb(0 0 0 / 15%);

  &__item {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 8px 12px;
    cursor: pointer;
    transition: background-color 0.2s;

    &:hover {
      background: var(--hover-bg-color);
    }

    span {
      font-size: 13px;
    }
  }

  &__error {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 8px 12px;
    font-size: 12px;
    color: var(--error-color);

    span {
      flex: 1;
    }
  }

  &__info {
    padding: 8px 12px;
    margin-top: 4px;
    border-top: 1px solid var(--border-color);

    &-label {
      margin-bottom: 2px;
      font-size: 11px;
      color: var(--text-color-secondary);
    }

    &-value {
      font-size: 12px;
      color: var(--text-color);
    }
  }
}

.is-spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
