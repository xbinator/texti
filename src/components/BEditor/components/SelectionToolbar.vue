<template>
  <BubbleMenu v-if="editor" :editor="editor" :options="bubbleMenuOptions" class="bubble-menu-wrapper">
    <div class="selection-toolbar" :class="{ 'is-hidden': !visible }">
      <div type="button" class="selection-toolbar__ai-btn" @mousedown.prevent="toggleAIInput">
        <Icon icon="lucide:sparkles" />
        <span>AI 助手</span>
      </div>

      <div class="selection-toolbar__divider"></div>

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
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { BubbleMenu } from '@tiptap/vue-3/menus';

interface Props {
  editor?: Editor | null;
}

const props = withDefaults(defineProps<Props>(), {
  editor: null
});

const emit = defineEmits<{
  (e: 'ai-input-toggle', value: boolean): void;
}>();

const visible = ref(false);

const bubbleMenuOptions = computed(() => ({
  placement: 'top-start' as const,
  onShow: () => {
    visible.value = true;
    emit('ai-input-toggle', false);
  }
}));

function toggleAIInput(): void {
  visible.value = false;
  emit('ai-input-toggle', true);
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
