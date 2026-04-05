<template>
  <NodeViewWrapper class="b-code-block" :class="{ 'is-collapsed': isCollapsed, 'is-word-wrap': isWordWrap }">
    <div class="b-code-block__header" contenteditable="false">
      <BSelect v-model:value="selectedLanguage" :width="200" :options="languageOptions" @change="handleLanguageChange" />

      <div class="flex-1"></div>

      <button type="button" class="b-code-block__control-btn" :class="{ 'is-active': isCollapsed }" @mousedown.prevent @click="toggleCollapse">
        <Icon :icon="isCollapsed ? 'lucide:chevron-down' : 'lucide:chevron-up'" />
      </button>

      <button type="button" class="b-code-block__copy" :title="copyLabel" :aria-label="copyLabel" @mousedown.prevent @click="handleCopy">
        <Icon class="b-code-block__copy-icon" :icon="copyIconName" />
      </button>
    </div>

    <div v-show="!isCollapsed" class="b-code-block__body-wrapper">
      <pre class="b-code-block__body"><NodeViewContent as="code" :class="codeClassName" /></pre>
    </div>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { useClipboard } from '@vueuse/core';
import { message } from 'ant-design-vue';
import BSelect from '@/components/BSelect/index.vue';

const props = defineProps(nodeViewProps);

const copyLabel = ref('复制');
const { copy } = useClipboard();
let resetTimer: number | null = null;

const isCollapsed = ref(false);
const isWordWrap = ref(false);

const selectedLanguage = ref(props.node.attrs.language || 'plaintext');

const languageOptions = computed(() => {
  const languages = [
    { value: 'plaintext', label: 'Plain Text' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'typescript', label: 'TypeScript' },
    { value: 'python', label: 'Python' },
    { value: 'java', label: 'Java' },
    { value: 'c', label: 'C' },
    { value: 'cpp', label: 'C++' },
    { value: 'csharp', label: 'C#' },
    { value: 'go', label: 'Go' },
    { value: 'rust', label: 'Rust' },
    { value: 'php', label: 'PHP' },
    { value: 'ruby', label: 'Ruby' },
    { value: 'swift', label: 'Swift' },
    { value: 'kotlin', label: 'Kotlin' },
    { value: 'sql', label: 'SQL' },
    { value: 'bash', label: 'Bash' },
    { value: 'json', label: 'JSON' },
    { value: 'yaml', label: 'YAML' },
    { value: 'xml', label: 'XML' },
    { value: 'markdown', label: 'Markdown' },
    { value: 'css', label: 'CSS' },
    { value: 'scss', label: 'SCSS' },
    { value: 'html', label: 'HTML' },
    { value: 'vue', label: 'Vue' },
    { value: 'react', label: 'React JSX' }
  ];

  return languages;
});

const codeClassName = computed(() => {
  const language = selectedLanguage.value;
  return language ? `language-${language}` : '';
});

const copyIconName = computed(() => {
  if (copyLabel.value === '已复制') return 'lucide:check';
  if (copyLabel.value === '复制失败') return 'lucide:x';

  return 'lucide:copy';
});

function scheduleResetCopyLabel() {
  if (resetTimer !== null) {
    window.clearTimeout(resetTimer);
  }

  resetTimer = window.setTimeout(() => {
    copyLabel.value = '复制';
    resetTimer = null;
  }, 1500);
}

async function handleCopy() {
  const text = props.node.textContent;
  if (!text) return;

  try {
    await copy(text);
    copyLabel.value = '已复制';
    message.success('复制成功');
    scheduleResetCopyLabel();
  } catch (error) {
    copyLabel.value = '复制失败';
    message.error('复制失败');
    scheduleResetCopyLabel();
  }
}

function handleLanguageChange(language: unknown) {
  if (typeof language === 'string') {
    selectedLanguage.value = language;
    props.updateAttributes({ language });
  }
}

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value;
}

onUnmounted(() => {
  if (resetTimer !== null) {
    window.clearTimeout(resetTimer);
  }
});
</script>

<style lang="less" scoped>
.b-code-block {
  margin: 0.75em 0;
  overflow: hidden;
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  border-radius: 6px;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s ease;

  &.is-collapsed {
    .b-code-block__body-wrapper {
      display: none;
    }
  }

  &.is-word-wrap {
    .b-code-block__body {
      code {
        overflow-wrap: break-word;
        white-space: pre-wrap;
      }
    }
  }
}

.b-code-block__header {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: space-between;
  height: 42px;
  padding: 0 14px;
  background: var(--code-header-bg);
}

.b-code-block__control-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  color: var(--code-line-number);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 4px;
  transition: all 0.2s ease;

  &:hover {
    color: var(--code-text);
    background: var(--code-line-bg);
  }

  &.is-active {
    color: var(--color-info);
    background: var(--code-line-hover-bg);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .is-spinning {
    animation: spin 1s linear infinite;
  }
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.b-code-block__copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  color: var(--code-text);
  cursor: pointer;
  background: transparent;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.b-code-block__copy-icon {
  font-size: 14px;
}

.b-code-block__copy:hover {
  background: var(--code-line-bg);
}

.b-code-block__body-wrapper {
  overflow: hidden;
}

.b-code-block__body {
  padding: 16px;
  margin: 0;
  overflow-x: auto;
  background: var(--code-bg);
  border-top: 1px solid var(--code-border);

  code {
    display: block;
    font-family: 'Fira Code', 'JetBrains Mono', 'SF Mono', Monaco, 'Cascadia Code', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre;
  }
}
</style>
