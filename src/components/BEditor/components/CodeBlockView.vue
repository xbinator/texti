<template>
  <NodeViewWrapper class="b-code-block">
    <div class="b-code-block__header" contenteditable="false">
      <span class="b-code-block__language">{{ languageLabel }}</span>

      <button type="button" class="b-code-block__copy" @mousedown.prevent.stop @click.prevent.stop="handleCopy">
        {{ copyLabel }}
      </button>
    </div>

    <pre class="b-code-block__body"><NodeViewContent as="code" :class="codeClassName" /></pre>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { useClipboard } from '@vueuse/core';
import { message } from 'ant-design-vue';

const props = defineProps(nodeViewProps);

const copyLabel = ref('复制');
const { copy } = useClipboard();
let resetTimer: number | null = null;

const languageLabel = computed(() => {
  const language = props.node.attrs.language as string | null;
  if (!language) return 'Plain Text';

  return language.charAt(0).toUpperCase() + language.slice(1);
});

const codeClassName = computed(() => {
  const language = props.node.attrs.language as string | null;
  return language ? `language-${language}` : '';
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

    console.error('Failed to copy code block content:', error);
  }
}

onUnmounted(() => {
  if (resetTimer !== null) {
    window.clearTimeout(resetTimer);
  }
});
</script>

<style scoped>
.b-code-block {
  margin: 0.75em 0;
  overflow: hidden;
  background: #f6f8fa;
  border: 1px solid #d0d7de;
  border-radius: 12px;
  box-shadow: 0 1px 2px rgb(31 35 40 / 6%);
}

.b-code-block__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #f6f8fa;
  border-bottom: 1px solid #d8dee4;
}

.b-code-block__language {
  font-size: 12px;
  font-weight: 600;
  color: #57606a;
  letter-spacing: 0.08em;
}

.b-code-block__copy {
  padding: 4px 10px;
  font-size: 12px;
  color: #24292f;
  cursor: pointer;
  background: #fff;
  border: 1px solid rgb(31 35 40 / 15%);
  border-radius: 999px;
  transition: all 0.2s ease;
}

.b-code-block__copy:hover {
  background: #f3f4f6;
}

.b-code-block__body {
  padding: 16px;
  margin: 0;
  overflow-x: auto;
  background: #f6f8fa;
}
</style>
