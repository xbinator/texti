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
      <div v-if="canShowCustomInput" :class="bem('custom')">
        <div v-if="!showCustomInput" :class="bem('custom-trigger')">
          <BButton size="small" type="text" @click="handleShowCustomInput">{{ props.part.customInput?.triggerLabel ?? '自己输入' }}</BButton>
        </div>
        <template v-else>
          <input
            v-model="customInput"
            :class="bem('custom-input')"
            type="text"
            :placeholder="props.part.customInput?.placeholder ?? '输入你自己的答案...'"
            @keydown.enter.prevent="handleSubmitCustomInput"
          />
          <div :class="bem('custom-actions')">
            <div :class="bem('custom-submit')">
              <BButton size="small" :disabled="!canSubmitCustomInput" @click="handleSubmitCustomInput">发送</BButton>
            </div>
            <BButton size="small" type="text" @click="handleCancelCustomInput">取消</BButton>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * @file ConfirmationCard.vue
 * @description 聊天流中的确认卡片组件，负责展示确认状态、预览和折叠交互。
 */
import type { ChatMessageConfirmationActionPayload, ChatMessageConfirmationCustomInputPayload, ChatMessageConfirmationPart } from 'types/chat';
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { formatConfirmationPreviewText, getConfirmationStatusText, isConfirmationCollapsed } from '@/components/BChatSidebar/utils/confirmationCard';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'ConfirmationCard' });

const props = defineProps<{
  /** 确认卡片片段 */
  part: ChatMessageConfirmationPart;
}>();

const manuallyCollapsed = ref(false);
const manuallyExpanded = ref(false);
const showCustomInput = ref(false);
const customInput = ref('');
const [, bem] = createNamespace('', 'confirm-card');
const emit = defineEmits<{
  (e: 'confirmation-action', payload: ChatMessageConfirmationActionPayload): void;
  (e: 'custom-input-submit', payload: ChatMessageConfirmationCustomInputPayload): void;
}>();

/**
 * 当前是否折叠。
 */
const collapsed = computed(() => isConfirmationCollapsed(props.part, manuallyCollapsed.value, manuallyExpanded.value));

/**
 * 当前状态文案。
 */
const statusText = computed(() => getConfirmationStatusText(props.part));

/**
 * 当前卡片是否允许展示自定义输入。
 */
const canShowCustomInput = computed(() => {
  return props.part.confirmationStatus === 'pending' && props.part.customInput?.enabled === true;
});

/**
 * 当前是否允许提交自定义输入。
 */
const canSubmitCustomInput = computed(() => {
  return canShowCustomInput.value && customInput.value.trim().length > 0;
});

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

/**
 * 展示自定义输入区域。
 */
function handleShowCustomInput(): void {
  if (!canShowCustomInput.value) {
    return;
  }

  showCustomInput.value = true;
}

/**
 * 取消自定义输入并清空草稿。
 */
function handleCancelCustomInput(): void {
  customInput.value = '';
  showCustomInput.value = false;
}

/**
 * 提交用户自定义输入答案。
 */
function handleSubmitCustomInput(): void {
  if (!canSubmitCustomInput.value) {
    return;
  }

  emit('custom-input-submit', {
    confirmationId: props.part.confirmationId,
    text: customInput.value.trim()
  });
  handleCancelCustomInput();
}
</script>

<style scoped lang="less">
.confirm-card {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
}

.confirm-card--confirmation {
  background: var(--bg-tertiary);
}

.confirm-card--permission-dangerous {
  border-color: var(--color-warning, #faad14);
}

.confirm-card--success {
  border-color: var(--color-success);
}

.confirm-card--cancelled,
.confirm-card--expired {
  opacity: 0.86;
}

.confirm-card__title {
  display: flex;
  gap: 6px;
  align-items: center;
  font-weight: 500;
  color: var(--text-primary);
}

.confirm-card__title--clickable {
  width: fit-content;
  cursor: pointer;
  user-select: none;
}

.confirm-card__description,
.confirm-card__status,
.confirm-card__tip {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.6;
}

.confirm-card__label {
  margin-top: 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
}

.confirm-card__code {
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

.confirm-card__actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.confirm-card__custom {
  margin-top: 10px;
}

.confirm-card__custom-input {
  width: 100%;
  padding: 7px 9px;
  color: var(--text-primary);
  outline: none;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
}

.confirm-card__custom-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
</style>
