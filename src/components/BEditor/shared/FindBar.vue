<template>
  <Transition name="b-markdown-findbar-flip">
    <div v-if="visible" :class="name">
      <div :class="bem('container', { 'no-match': isNoMatchFound })">
        <input
          ref="inputRef"
          v-model="keyword"
          :class="bem('input')"
          placeholder="在文档中查找"
          @keydown.enter.prevent="handleEnter"
          @keydown.esc.prevent="closeFind"
        />
        <span :class="bem('result', { empty: isNoMatchFound })">{{ findResultText }}</span>
        <button type="button" :class="bem('btn')" :disabled="!hasMatches" @click="findPrevious">
          <BIcon icon="lucide:chevron-up" />
        </button>
        <button type="button" :class="bem('btn')" :disabled="!hasMatches" @click="findNext">
          <BIcon icon="lucide:chevron-down" />
        </button>
        <span :class="bem('divider')"></span>
        <button type="button" :class="bem('btn')" @click="closeFind">
          <BIcon icon="lucide:x" />
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
/**
 * @file FindBar.vue
 * @description 编辑器查找条组件，负责管理查找关键词、结果状态与快捷查找交互。
 */
import { computed, nextTick, ref, watch } from 'vue';
import type { EditorPublicInstance, EditorSearchState as SearchState } from '@/components/BEditor/types';
import { EditorShortcuts } from '@/constants/shortcuts';
import { useShortcuts } from '@/hooks/useShortcuts';
import { createNamespace } from '@/utils/namespace';

const [name, bem] = createNamespace('', 'b-markdown-findbar');

interface Props {
  editorInstance: EditorPublicInstance | null;
}

const props = withDefaults(defineProps<Props>(), {
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

/**
 * 确保当前编辑器实例已同步查找词，避免模式切换后首次跳转时底层仍为空搜索态。
 * @returns 是否存在可用的匹配结果
 */
function ensureSearchStateReady(): boolean {
  const nextKeyword = trimmedKeyword.value;
  const currentSearchState = getEditorSearchState();

  if (!nextKeyword) {
    searchState.value = currentSearchState;
    return false;
  }

  if (currentSearchState.term !== nextKeyword || currentSearchState.matchCount === 0) {
    applySearchTerm(nextKeyword);
  } else {
    searchState.value = currentSearchState;
  }

  return searchState.value.matchCount > 0;
}

function findNext(): void {
  if (!ensureSearchStateReady()) {
    return;
  }

  props.editorInstance?.findNext();
  syncSearchState();
}

function findPrevious(): void {
  if (!ensureSearchStateReady()) {
    return;
  }

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

/**
 * 在编辑器模式切换后，将当前搜索词重新同步到新的编辑器实例。
 */
watch(
  () => props.editorInstance,
  () => {
    if (!visible.value) {
      syncSearchState();
      return;
    }

    if (hasKeyword.value) {
      applySearchTerm(keyword.value);
      return;
    }

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
    const selection = props.editorInstance?.getSelection();
    if (selection?.text) {
      keyword.value = selection.text;
    }

    visible.value = true;
    focusInput(Boolean(keyword.value.trim()));
  },
  enabled: true,
  preventDefault: true
});
</script>

<style scoped>
.b-markdown-findbar {
  position: absolute;
  top: 14px;
  right: 50px;
  z-index: 100;
  display: flex;
  align-items: center;
  transform-origin: top center;
}

.b-markdown-findbar-flip-enter-active {
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.b-markdown-findbar-flip-leave-active {
  transition: all 0.2s ease-in;
}

.b-markdown-findbar-flip-enter-from {
  opacity: 0;
  transform: perspective(400px) rotateX(-15deg) translateY(-10px);
}

.b-markdown-findbar-flip-leave-to {
  opacity: 0;
  transform: perspective(400px) rotateX(15deg) translateY(-10px);
}

.b-markdown-findbar__container {
  display: flex;
  gap: 4px;
  align-items: center;
  width: 340px;
  max-width: 100%;
  height: 32px;
  padding: 0 6px 0 8px;
  background: var(--bg-primary);
  border: var(--overlay-border-width) solid var(--border-secondary);
  border-radius: var(--overlay-radius);
  box-shadow: var(--shadow-sm);
}

.b-markdown-findbar__container--no-match {
  border-color: var(--color-warning-border);
  box-shadow: 0 0 0 1px var(--color-warning-border);
}

.b-markdown-findbar__input {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0;
  font-family: var(--font-sans);
  font-size: 12px;
  line-height: 24px;
  color: var(--text-primary);
  outline: none;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
}

.b-markdown-findbar__input::placeholder {
  color: var(--input-placeholder-color);
  opacity: 1;
}

.b-markdown-findbar__result {
  min-width: 40px;
  font-size: 12px;
  color: var(--text-tertiary);
  text-align: right;
}

.b-markdown-findbar__result--empty {
  color: var(--input-error-text);
}

.b-markdown-findbar__divider {
  width: 1px;
  height: 16px;
  background: var(--bg-active);
}

.b-markdown-findbar__btn {
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
  border-radius: var(--control-radius);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard), color var(--motion-duration-fast) var(--motion-easing-standard);
}

.b-markdown-findbar__btn:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.b-markdown-findbar__btn:disabled {
  color: var(--text-quaternary);
  cursor: not-allowed;
}
</style>
