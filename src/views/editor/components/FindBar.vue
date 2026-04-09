<template>
  <div v-show="visible" class="header-right">
    <div class="find-bar" :class="{ 'is-empty': isNoMatchFound }">
      <input
        ref="inputRef"
        v-model="keyword"
        class="find-input"
        placeholder="在文档中查找"
        @keydown.enter.prevent="handleEnter"
        @keydown.esc.prevent="closeFind"
      />
      <span class="find-result" :class="{ 'find-result--empty': isNoMatchFound }">{{ findResultText }}</span>
      <button type="button" class="find-action" :disabled="!hasMatches" @click="findPrevious">
        <Icon icon="lucide:chevron-up" />
      </button>
      <button type="button" class="find-action" :disabled="!hasMatches" @click="findNext">
        <Icon icon="lucide:chevron-down" />
      </button>
      <span class="find-divider"></span>
      <button type="button" class="find-action" @click="closeFind">
        <Icon icon="lucide:x" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import type { BEditorPublicInstance, EditorSearchState as SearchState } from '@/components/BEditor/types';
import { useShortcuts } from '@/hooks/useShortcuts';
import { EditorShortcuts } from '../constants/shortcuts';

interface Props {
  content: string;
  editorInstance: BEditorPublicInstance | null;
}

const props = withDefaults(defineProps<Props>(), {
  content: '',
  editorInstance: null
});

const visible = defineModel<boolean>('visible', { default: false });
const inputRef = ref<HTMLInputElement | null>(null);
const keyword = ref('');
const searchState = ref<SearchState>({
  currentIndex: 0,
  matchCount: 0,
  term: ''
});

const trimmedKeyword = computed(() => keyword.value.trim());
const hasKeyword = computed(() => Boolean(trimmedKeyword.value));
const hasMatches = computed(() => searchState.value.matchCount > 0);
const isNoMatchFound = computed(() => hasKeyword.value && !hasMatches.value);

const findResultText = computed(() => {
  if (!hasKeyword.value) {
    return '';
  }

  if (!hasMatches.value) {
    return '0/0';
  }

  return `${searchState.value.currentIndex + 1}/${searchState.value.matchCount}`;
});

function getEditorSearchState(): SearchState {
  return (
    props.editorInstance?.getSearchState() ?? {
      currentIndex: 0,
      matchCount: 0,
      term: ''
    }
  );
}

function syncSearchState(): void {
  searchState.value = getEditorSearchState();
}

function applySearchTerm(value: string): void {
  const nextKeyword = value.trim();

  if (!nextKeyword) {
    props.editorInstance?.clearSearch();
    syncSearchState();
    return;
  }

  props.editorInstance?.setSearchTerm(nextKeyword);
  syncSearchState();
}

function findNext(): void {
  props.editorInstance?.findNext();
  syncSearchState();
}

function findPrevious(): void {
  props.editorInstance?.findPrevious();
  syncSearchState();
}

function closeFind(): void {
  visible.value = false;
  keyword.value = '';
  props.editorInstance?.clearSearch();
  syncSearchState();
  props.editorInstance?.focusEditor();
}

function focusInput(selectText = false): void {
  nextTick(() => {
    inputRef.value?.focus();

    if (selectText) {
      inputRef.value?.select();
    }
  });
}

function handleEnter(event: KeyboardEvent): void {
  if (event.shiftKey) {
    findPrevious();
    return;
  }

  findNext();
}

watch(keyword, (value) => {
  applySearchTerm(value);
});

watch(
  () => props.content,
  () => {
    syncSearchState();
  }
);

watch(visible, (value) => {
  if (!value) {
    return;
  }

  syncSearchState();
  focusInput(Boolean(keyword.value.trim()));
});

// 快捷键支持
const { registerShortcut } = useShortcuts();

registerShortcut({
  key: EditorShortcuts.EDIT_FIND,
  handler: () => {
    visible.value = true;
    focusInput(Boolean(keyword.value.trim()));
  },
  enabled: true,
  preventDefault: true
});
</script>

<style scoped>
.header-right {
  display: flex;
  align-items: center;
}

.find-bar {
  display: flex;
  gap: 4px;
  align-items: center;
  width: 340px;
  max-width: 100%;
  height: 32px;
  padding: 0 6px 0 8px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-secondary);
  border-radius: 8px;
  box-shadow: var(--shadow-sm);
}

.find-bar.is-empty {
  border-color: var(--color-warning-border);
  box-shadow: 0 0 0 1px var(--color-warning-border);
}

.find-input {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0;
  font-size: 12px;
  line-height: 24px;
  color: var(--text-primary);
  outline: none;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
}

.find-input::placeholder {
  color: var(--text-placeholder);
}

.find-result {
  min-width: 40px;
  font-size: 12px;
  color: var(--text-tertiary);
  text-align: right;
}

.find-result--empty {
  color: var(--input-error-text);
}

.find-divider {
  width: 1px;
  height: 16px;
  background: var(--bg-active);
}

.find-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--text-secondary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 4px;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.find-action:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.find-action:disabled {
  color: var(--text-quaternary);
  cursor: not-allowed;
}
</style>
