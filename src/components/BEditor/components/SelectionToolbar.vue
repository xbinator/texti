<template>
  <BubbleMenu v-if="editor" :editor="editor" :options="bubbleMenuOptions" class="bubble-menu-wrapper">
    <div class="selection-toolbar" :class="{ 'is-hidden': !visible }">
      <template v-if="isModelAvailable">
        <div class="selection-toolbar__ai-btn" @mousedown.prevent="toggleAIInput">
          <Icon icon="lucide:sparkles" />
          <span>AI 助手</span>
        </div>
        <div class="selection-toolbar__divider"></div>
      </template>

      <button
        v-for="btn in formatButtons"
        :key="btn.command"
        type="button"
        class="selection-toolbar__btn"
        :class="{ 'is-active': editor.isActive(btn.command) }"
        @mousedown.prevent="btn.action"
      >
        <Icon :icon="btn.icon" />
      </button>
    </div>
  </BubbleMenu>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3';
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { BubbleMenu } from '@tiptap/vue-3/menus';
import { useEventListener } from '@vueuse/core';
import type { ServiceModelUpdatedDetail } from '@/shared/storage/service-models/events';
import { SERVICE_MODEL_UPDATED_EVENT } from '@/shared/storage/service-models/events';
import { useServiceModelStore } from '@/stores/service-model';

interface SelectionRange {
  from: number;
  to: number;
  text: string;
}

interface Props {
  editor?: Editor | null;
}

const props = withDefaults(defineProps<Props>(), {
  editor: null
});

const emit = defineEmits<{
  (e: 'ai-input-toggle', value: boolean, selectionRange?: SelectionRange): void;
}>();

const visible = ref(false);
const isModelAvailable = ref(false);
const serviceModelStore = useServiceModelStore();

// ---- Model Availability ----

async function checkModelAvailability(): Promise<void> {
  isModelAvailable.value = await serviceModelStore.isServiceAvailable('polish');
}

function handleServiceModelUpdated(event: Event): void {
  const { detail } = event as CustomEvent<ServiceModelUpdatedDetail>;
  if (detail.serviceType !== 'polish') return;

  checkModelAvailability();
}

useEventListener(window, SERVICE_MODEL_UPDATED_EVENT, handleServiceModelUpdated);

// ---- Bubble Menu ----

const bubbleMenuOptions = computed(() => ({
  placement: 'top-start' as const,
  onShow: () => {
    checkModelAvailability();
    visible.value = true;
    emit('ai-input-toggle', false);
  }
}));

// ---- AI Input ----

function toggleAIInput(): void {
  visible.value = false;

  const selection = props.editor?.state.selection;
  if (!selection || selection.from === selection.to) {
    emit('ai-input-toggle', true);
    return;
  }

  const text = props.editor?.state.doc.textBetween(selection.from, selection.to, '') ?? '';

  emit('ai-input-toggle', true, { from: selection.from, to: selection.to, text });
}

// ---- Format Buttons ----

const formatButtons = computed(() => [
  { command: 'bold', icon: 'lucide:bold', action: () => props.editor?.chain().focus().toggleBold().run() },
  { command: 'italic', icon: 'lucide:italic', action: () => props.editor?.chain().focus().toggleItalic().run() },
  { command: 'underline', icon: 'lucide:underline', action: () => props.editor?.chain().focus().toggleUnderline().run() },
  { command: 'strike', icon: 'lucide:strikethrough', action: () => props.editor?.chain().focus().toggleStrike().run() },
  { command: 'code', icon: 'lucide:code', action: () => props.editor?.chain().focus().toggleCode().run() }
]);

checkModelAvailability();
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
