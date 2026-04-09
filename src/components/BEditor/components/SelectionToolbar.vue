<template>
  <BubbleMenu v-if="editor" :editor="editor" :options="bubbleMenuOptions" class="bubble-menu-wrapper">
    <div class="selection-toolbar" :class="{ 'is-hidden': !visible }">
      <div v-if="isModelAvailable" type="button" class="selection-toolbar__ai-btn" @mousedown.prevent="toggleAIInput">
        <Icon icon="lucide:sparkles" />
        <span>AI 助手</span>
      </div>

      <div v-if="isModelAvailable" class="selection-toolbar__divider"></div>

      <button type="button" class="selection-toolbar__btn" :class="{ 'is-active': editor.isActive('bold') }" @mousedown.prevent="toggleBold">
        <Icon icon="lucide:bold" />
      </button>
      <button type="button" class="selection-toolbar__btn" :class="{ 'is-active': editor.isActive('italic') }" @mousedown.prevent="toggleItalic">
        <Icon icon="lucide:italic" />
      </button>
      <button type="button" class="selection-toolbar__btn" :class="{ 'is-active': editor.isActive('underline') }" @mousedown.prevent="toggleUnderline">
        <Icon icon="lucide:underline" />
      </button>
      <button type="button" class="selection-toolbar__btn" :class="{ 'is-active': editor.isActive('strike') }" @mousedown.prevent="toggleStrike">
        <Icon icon="lucide:strikethrough" />
      </button>
      <button type="button" class="selection-toolbar__btn" :class="{ 'is-active': editor.isActive('code') }" @mousedown.prevent="toggleCode">
        <Icon icon="lucide:code" />
      </button>
    </div>
  </BubbleMenu>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { BubbleMenu } from '@tiptap/vue-3/menus';
import { providerStorage, serviceModelsStorage } from '@/utils/storage';
import type { ServiceModelUpdatedDetail } from '@/utils/storage/service-models/events';
import { SERVICE_MODEL_UPDATED_EVENT } from '@/utils/storage/service-models/events';

interface Props {
  editor?: Editor | null;
}

interface SelectionRange {
  from: number;
  to: number;
  text: string;
}

const props = withDefaults(defineProps<Props>(), {
  editor: null
});

const emit = defineEmits<{
  (e: 'ai-input-toggle', value: boolean, selectionRange?: SelectionRange): void;
}>();

const visible = ref(false);
const isModelAvailable = ref(false);

async function checkModelAvailability(): Promise<void> {
  const config = await serviceModelsStorage.getConfig('polish');
  if (!config?.providerId || !config?.modelId) {
    isModelAvailable.value = false;
    return;
  }

  const provider = await providerStorage.getProvider(config.providerId);
  if (!provider || !provider.isEnabled || !provider.apiKey) {
    isModelAvailable.value = false;
    return;
  }

  isModelAvailable.value = true;
}

function refreshModelAvailability(): void {
  checkModelAvailability().catch((error: unknown) => {
    console.error('检查模型可用性失败:', error);
  });
}

const bubbleMenuOptions = computed(() => ({
  placement: 'top-start' as const,
  onShow: async () => {
    await checkModelAvailability();
    visible.value = true;
    emit('ai-input-toggle', false);
  }
}));

function toggleAIInput(): void {
  const selection = props.editor?.state.selection;
  const selectionRange =
    selection && selection.from !== selection.to
      ? {
          from: selection.from,
          to: selection.to,
          text: props.editor?.state.doc.textBetween(selection.from, selection.to, '') || ''
        }
      : undefined;
  visible.value = false;
  emit('ai-input-toggle', true, selectionRange);
}

function toggleBold(): void {
  props.editor?.chain().focus().toggleBold().run();
}

function toggleItalic(): void {
  props.editor?.chain().focus().toggleItalic().run();
}

function toggleUnderline(): void {
  props.editor?.chain().focus().toggleUnderline().run();
}

function toggleStrike(): void {
  props.editor?.chain().focus().toggleStrike().run();
}

function toggleCode(): void {
  props.editor?.chain().focus().toggleCode().run();
}

function handleServiceModelUpdated(event: Event): void {
  const customEvent = event as CustomEvent<ServiceModelUpdatedDetail>;
  if (customEvent.detail.serviceType !== 'polish') return;

  refreshModelAvailability();
}

onMounted(() => {
  refreshModelAvailability();
  window.addEventListener(SERVICE_MODEL_UPDATED_EVENT, handleServiceModelUpdated);
});

onUnmounted(() => {
  window.removeEventListener(SERVICE_MODEL_UPDATED_EVENT, handleServiceModelUpdated);
});
</script>

<style lang="less" scoped>
.selection-toolbar {
  display: flex;
  gap: 2px;
  align-items: center;
  padding: 4px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);

  &.is-hidden {
    visibility: hidden;
    opacity: 0;
  }
}

.selection-toolbar__ai-btn {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  height: 28px;
  padding: 0 8px;
  font-size: 13px;
  color: var(--color-primary);
  cursor: pointer;
  border: none;
  border-radius: 6px;
  transition: background-color 0.15s ease;

  &:hover {
    background: var(--color-primary-bg-hover);
  }
}

.selection-toolbar__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 6px;
  transition: background-color 0.15s ease, color 0.15s ease;

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  &.is-active {
    color: var(--color-primary);
    background: var(--bg-hover);
  }
}

.selection-toolbar__divider {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--border-primary);
}
</style>
