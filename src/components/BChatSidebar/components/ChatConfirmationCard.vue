<template>
  <div :class="bem(['part', 'confirmation', part.confirmationStatus, `permission-${part.riskLevel}`])">
    <div :class="bem('title', { clickable: true })" @click="toggleCollapse">
      <Icon :icon="collapsed ? 'lucide:chevron-down' : 'lucide:chevron-up'" width="14" height="14" />
      <Icon :icon="part.riskLevel === 'dangerous' ? 'lucide:triangle-alert' : 'lucide:shield-check'" width="14" height="14" />
      <span>{{ part.title }}</span>
    </div>
    <div :class="bem('status')">{{ statusText }}</div>
    <template v-if="!collapsed">
      <div :class="bem('description')">{{ part.description }}</div>
      <div v-if="part.beforeText" :class="bem('section')">
        <div :class="bem('label')">原内容</div>
        <pre :class="bem('code')">{{ formatConfirmationPreviewText(part.beforeText, part.toolName) }}</pre>
      </div>
      <div v-if="part.afterText" :class="bem('section')">
        <div :class="bem('label')">{{ part.toolName === 'insert_at_cursor' ? '将插入的内容' : '新内容' }}</div>
        <pre :class="bem('code')">{{ formatConfirmationPreviewText(part.afterText, part.toolName) }}</pre>
      </div>
      <div v-if="part.toolName === 'replace_document'" :class="bem('tip')">完整内容较长，当前仅展示部分预览。</div>
      <div v-if="part.confirmationStatus === 'pending'" :class="bem('actions')">
        <BButton size="small" @click="$emit('confirmation-action', { confirmationId: part.confirmationId, action: 'approve' })">应用</BButton>
        <BButton
          v-if="part.allowRemember && part.rememberScopes?.includes('session')"
          size="small"
          type="secondary"
          @click="$emit('confirmation-action', { confirmationId: part.confirmationId, action: 'approve-session' })"
        >
          本会话允许
        </BButton>
        <BButton
          v-if="part.allowRemember && part.rememberScopes?.includes('always')"
          size="small"
          type="secondary"
          @click="$emit('confirmation-action', { confirmationId: part.confirmationId, action: 'approve-always' })"
        >
          始终允许
        </BButton>
        <BButton size="small" type="text" @click="$emit('confirmation-action', { confirmationId: part.confirmationId, action: 'cancel' })">取消</BButton>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * @file ChatConfirmationCard.vue
 * @description 聊天流中的确认卡片组件，负责展示确认状态、预览和折叠交互。
 */
import type { ChatMessageConfirmationActionPayload, ChatMessageConfirmationPart } from 'types/chat';
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import BButton from '@/components/BButton/index.vue';
import { createNamespace } from '@/utils/namespace';
import { formatConfirmationPreviewText, getConfirmationStatusText, isConfirmationCollapsed } from '@/components/BChatSidebar/utils/confirmationCard';

defineOptions({ name: 'ChatConfirmationCard' });

const props = defineProps<{
  /** 确认卡片片段 */
  part: ChatMessageConfirmationPart;
}>();

defineEmits<{
  (e: 'confirmation-action', payload: ChatMessageConfirmationActionPayload): void;
}>();

const manuallyCollapsed = ref(false);
const manuallyExpanded = ref(false);
const [, bem] = createNamespace('confirmation-card');

/**
 * 当前是否折叠。
 */
const collapsed = computed(() => isConfirmationCollapsed(props.part, manuallyCollapsed.value, manuallyExpanded.value));

/**
 * 当前状态文案。
 */
const statusText = computed(() => getConfirmationStatusText(props.part));

/**
 * 切换折叠状态。
 */
function toggleCollapse(): void {
  if (collapsed.value) {
    manuallyCollapsed.value = false;
    manuallyExpanded.value = true;
    return;
  }

  manuallyExpanded.value = false;
  manuallyCollapsed.value = true;
}
</script>

<style lang="less">
.b-confirmation-card {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
}

.b-confirmation-card--confirmation {
  background: var(--bg-tertiary);
}

.b-confirmation-card--permission-dangerous {
  border-color: var(--color-warning, #faad14);
}

.b-confirmation-card--success {
  border-color: var(--color-success);
}

.b-confirmation-card--cancelled,
.b-confirmation-card--expired {
  opacity: 0.86;
}

.b-confirmation-card__title {
  display: flex;
  gap: 6px;
  align-items: center;
  font-weight: 500;
  color: var(--text-primary);
}

.b-confirmation-card__title--clickable {
  width: fit-content;
  cursor: pointer;
  user-select: none;
}

.b-confirmation-card__description,
.b-confirmation-card__status,
.b-confirmation-card__tip {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.6;
}

.b-confirmation-card__label {
  margin-top: 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
}

.b-confirmation-card__code {
  max-height: 180px;
  padding: 8px;
  margin: 0;
  margin-top: 8px;
  overflow: auto;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  background: var(--bg-primary);
  border-radius: 6px;
}

.b-confirmation-card__actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
</style>
