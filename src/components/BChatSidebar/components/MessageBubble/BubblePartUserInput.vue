<template>
  <div :class="name">
    <div :class="bem('text')">
      <template v-for="(segment, index) in segments" :key="index">
        <span v-if="segment.type === 'text'">{{ segment.text }}</span>
        <span v-else :class="bem('chip')" :title="segment.fullPath">
          <span :class="bem('chip-filename')">{{ segment.fileName }}</span>
          <span :class="bem('chip-lines')">{{ segment.lineText }}</span>
        </span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file BubblePartUserInput.vue
 * @description 渲染用户输入消息，将文件引用标签解析为内联 chip 展示。
 */
import type { ChatMessageTextPart } from 'types/chat';
import { computed } from 'vue';
import { createNamespace } from '@/utils/namespace';
import { MESSAGE_REF_PATTERN } from '../../utils/fileReferenceContext';

defineOptions({ name: 'BubblePartUserInput' });

interface Props {
  part: ChatMessageTextPart;
}

const props = defineProps<Props>();

const [name, bem] = createNamespace('', 'message-bubble-user-input');

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface TextSegment {
  type: 'text';
  text: string;
}

interface FileRefSegment {
  type: 'fileRef';
  fullPath: string;
  fileName: string;
  lineText: string;
}

type Segment = TextSegment | FileRefSegment;

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/**
 * 从路径字符串中提取文件名。
 */
function extractFileName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}

/**
 * 将原始文本解析为纯文本与文件引用片段的交替序列。
 * 匹配格式：{{#filePath startLine-endLine|renderStartLine-renderEndLine}}
 */
function parseSegments(text: string): Segment[] {
  const result: Segment[] = [];
  const pattern = new RegExp(MESSAGE_REF_PATTERN.source, 'g');
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const [, filePath, startLine, endLine, renderStartLine, renderEndLine] = match;
    const matchStart = match.index!;

    if (matchStart > lastIndex) {
      result.push({ type: 'text', text: text.slice(lastIndex, matchStart) });
    }

    result.push({
      type: 'fileRef',
      fullPath: filePath,
      fileName: extractFileName(filePath),
      lineText: renderStartLine && renderEndLine ? `${renderStartLine}-${renderEndLine}` : `${startLine}-${endLine}`
    });

    lastIndex = matchStart + match[0].length;
  }

  if (lastIndex < text.length) {
    result.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return result;
}

// ─── 计算属性 ────────────────────────────────────────────────────────────────

const segments = computed<Segment[]>(() => parseSegments(props.part.text ?? ''));
</script>

<style scoped lang="less">
.message-bubble-user-input {
  word-break: normal;
  white-space: pre-wrap;

  &__text {
    word-break: normal;
    white-space: pre-wrap;
  }

  &__chip {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    max-width: 240px;
    height: 20px;
    padding: 0 6px;
    font-family: inherit;
    font-size: 12px;
    vertical-align: middle;
    color: var(--text-primary);
    cursor: default;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    border-radius: 4px;
    transition: background-color 0.15s ease, border-color 0.15s ease;
  }

  &__chip-filename {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__chip-lines {
    flex-shrink: 0;
    color: var(--text-secondary, var(--text-primary));
    opacity: 0.7;
  }
}
</style>
