<template>
  <div v-if="visible" class="header-right">
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
import type BEditor from '@/components/BEditor/index.vue';

interface Props {
  content: string;
  editorInstance: InstanceType<typeof BEditor> | null;
}

const props = withDefaults(defineProps<Props>(), {
  content: '',
  editorInstance: null
});

interface SearchState {
  currentIndex: number;
  matchCount: number;
  term: string;
}

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
  background: #fff;
  border: 1px solid #dadce0;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgb(0 0 0 / 6%);
}

.find-bar.is-empty {
  border-color: #f59e0b;
  box-shadow: 0 0 0 1px rgb(245 158 11 / 12%);
}

.find-input {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0;
  font-size: 12px;
  line-height: 24px;
  color: rgb(32 33 36 / 92%);
  outline: none;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
}

.find-input::placeholder {
  color: rgb(0 0 0 / 35%);
}

.find-result {
  min-width: 40px;
  font-size: 12px;
  color: rgb(0 0 0 / 45%);
  text-align: right;
}

.find-result--empty {
  color: #d93025;
}

.find-divider {
  width: 1px;
  height: 16px;
  background: rgb(0 0 0 / 8%);
}

.find-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: rgb(0 0 0 / 56%);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 4px;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.find-action:hover:not(:disabled) {
  color: rgb(0 0 0 / 85%);
  background: rgb(0 0 0 / 5%);
}

.find-action:disabled {
  color: rgb(0 0 0 / 22%);
  cursor: not-allowed;
}
</style>
