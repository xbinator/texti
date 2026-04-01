<template>
  <NodeViewWrapper class="b-code-block" :class="{ 'is-collapsed': isCollapsed, 'is-word-wrap': isWordWrap }">
    <div class="b-code-block__header" contenteditable="false" @mousedown.stop.prevent>
      <div class="b-code-block__header-left">
        <BSelect v-model:value="selectedLanguage" class="b-code-block__language-select" :options="languageOptions" @change="handleLanguageChange" />
      </div>

      <div class="b-code-block__controls">
        <button
          type="button"
          class="b-code-block__control-btn"
          :class="{ 'is-active': isFormatting }"
          :disabled="isFormatting"
          :title="isFormatting ? '格式化中...' : '格式化代码'"
          @mousedown.prevent
          @click="handleFormat"
        >
          <Icon :icon="isFormatting ? 'lucide:loader-2' : 'lucide:code-2'" :class="{ 'is-spinning': isFormatting }" />
        </button>

        <button
          type="button"
          class="b-code-block__control-btn"
          :class="{ 'is-active': isWordWrap }"
          title="自动换行"
          @mousedown.prevent
          @click="toggleWordWrap"
        >
          <Icon icon="lucide:wrap-text" />
        </button>

        <button
          type="button"
          class="b-code-block__control-btn"
          :class="{ 'is-active': isCollapsed }"
          :title="isCollapsed ? '展开代码' : '折叠代码'"
          @mousedown.prevent
          @click="toggleCollapse"
        >
          <Icon :icon="isCollapsed ? 'lucide:chevron-down' : 'lucide:chevron-up'" />
        </button>

        <button type="button" class="b-code-block__copy" :title="copyLabel" :aria-label="copyLabel" @mousedown.prevent @click="handleCopy">
          <Icon class="b-code-block__copy-icon" :icon="copyIconName" />
        </button>
      </div>
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
import { js as jsBeautify, html as htmlBeautify, css as cssBeautify } from 'js-beautify';
import BSelect from '@/components/BSelect/index.vue';

const props = defineProps(nodeViewProps);

const copyLabel = ref('复制');
const { copy } = useClipboard();
let resetTimer: number | null = null;

const isCollapsed = ref(false);
const isWordWrap = ref(false);
const isFormatting = ref(false);

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

function scheduleResetCopyLabel(): void {
  if (resetTimer !== null) {
    window.clearTimeout(resetTimer);
  }

  resetTimer = window.setTimeout(() => {
    copyLabel.value = '复制';
    resetTimer = null;
  }, 1500);
}

async function handleCopy(): Promise<void> {
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

function handleLanguageChange(language: unknown): void {
  if (typeof language === 'string') {
    selectedLanguage.value = language;
    props.updateAttributes({ language });
  }
}

function toggleCollapse(): void {
  isCollapsed.value = !isCollapsed.value;
}

function toggleWordWrap(): void {
  isWordWrap.value = !isWordWrap.value;
}

async function handleFormat(): Promise<void> {
  if (isFormatting.value) return;

  const currentCode = props.node.textContent;

  if (!currentCode.trim()) {
    message.info('代码为空，无需格式化');
    return;
  }

  try {
    isFormatting.value = true;

    let formattedCode = currentCode;
    const language = selectedLanguage.value;

    const beautifyOptions = {
      indent_size: 2,
      indent_char: ' ',
      max_preserve_newlines: 2,
      preserve_newlines: true,
      keep_array_indentation: false,
      break_chained_methods: false,
      indent_scripts: 'normal' as const,
      brace_style: 'collapse' as const,
      space_before_conditional: true,
      unescape_strings: false,
      jslint_happy: false,
      end_with_newline: false,
      wrap_line_length: 0,
      indent_inner_html: false,
      comma_first: false,
      e4x: false,
      indent_empty_lines: false
    };

    switch (language) {
      case 'javascript':
      case 'js':
      case 'typescript':
      case 'ts':
      case 'jsx':
      case 'tsx':
        formattedCode = jsBeautify(currentCode, beautifyOptions);
        break;
      case 'json':
        try {
          const parsed = JSON.parse(currentCode);
          formattedCode = JSON.stringify(parsed, null, 2);
        } catch {
          formattedCode = jsBeautify(currentCode, beautifyOptions);
        }
        break;
      case 'css':
      case 'scss':
      case 'sass':
      case 'less':
        formattedCode = cssBeautify(currentCode, {
          indent_size: 2,
          indent_char: ' ',
          max_preserve_newlines: 2,
          preserve_newlines: true,
          newline_between_rules: true,
          end_with_newline: false,
          indent_empty_lines: false,
          space_around_combinator: true
        });
        break;
      case 'html':
      case 'xml':
      case 'vue':
      case 'svelte':
        formattedCode = htmlBeautify(currentCode, {
          indent_size: 2,
          indent_char: ' ',
          max_preserve_newlines: 2,
          preserve_newlines: true,
          indent_inner_html: true,
          indent_scripts: 'keep' as const,
          end_with_newline: false,
          extra_liners: ['head', 'body', '/html'],
          wrap_attributes: 'auto' as const,
          wrap_attributes_indent_size: 2,
          unformatted: ['code', 'pre', 'em', 'strong', 'span'],
          content_unformatted: ['pre', 'textarea'],
          indent_empty_lines: false
        });
        break;
      default:
        try {
          formattedCode = jsBeautify(currentCode, beautifyOptions);
        } catch {
          formattedCode = currentCode;
        }
    }

    if (formattedCode !== currentCode) {
      const { editor, getPos } = props;
      const pos = getPos();

      if (pos !== undefined) {
        const codeBlockPos = pos;
        const codeBlockSize = props.node.nodeSize;
        const contentStart = codeBlockPos + 1;
        const contentEnd = codeBlockPos + codeBlockSize - 1;

        editor
          .chain()
          .command(({ tr, state }) => {
            tr.replaceWith(contentStart, contentEnd, state.schema.text(formattedCode));
            return true;
          })
          .run();

        message.success('代码格式化成功');
      }
    } else {
      message.info('代码已经格式化');
    }
  } catch (error) {
    console.error('格式化失败:', error);
    message.error('代码格式化失败');
  } finally {
    setTimeout(() => {
      isFormatting.value = false;
    }, 100);
  }
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
  background: #f6f8fa;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgb(31 35 40 / 6%);
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
  align-items: center;
  justify-content: space-between;
  height: 42px;
  padding: 0 14px;
  background: #f6f8fa;
  border-bottom: 1px solid #d8dee4;
}

.b-code-block__header-left {
  display: flex;
  gap: 8px;
  align-items: center;
}

.b-code-block__language-select {
  min-width: 120px;
  font-size: 12px;
}

.b-code-block__controls {
  display: flex;
  gap: 4px;
  align-items: center;
}

.b-code-block__control-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  color: #57606a;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 4px;
  transition: all 0.2s ease;

  &:hover {
    color: #24292f;
    background: fade(#000, 6);
  }

  &.is-active {
    color: #0969da;
    background: fade(#0969da, 10);
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
  color: #24292f;
  cursor: pointer;
  background: transparent;
  border-radius: 2px;
  transition: all 0.2s ease;
}

.b-code-block__copy-icon {
  font-size: 14px;
}

.b-code-block__copy:hover {
  background: fade(#000, 6);
}

.b-code-block__body-wrapper {
  overflow: hidden;
}

.b-code-block__body {
  padding: 16px;
  margin: 0;
  overflow-x: auto;
  background: #f6f8fa;

  code {
    display: block;
    font-family: 'Fira Code', 'JetBrains Mono', 'SF Mono', Monaco, 'Cascadia Code', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre;
  }
}
</style>
