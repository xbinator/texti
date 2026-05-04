<template>
  <div :class="name">
    <div>{{ content }}</div>
    <!-- <div :class="bem('text')">
      <template v-for="(segment, index) in segments" :key="`${segment.type}-${index}`">
        <span v-if="segment.type === 'text'">{{ segment.text }}</span>
        <span v-else :class="bem('tag')" data-value="file-reference">
          {{ segment.label }}
        </span>
      </template>
    </div> -->
  </div>
</template>

<script setup lang="ts">
/**
 * @file BubblePartUserInput.vue
 * @description 渲染用户输入消息，处理文件引用标签解析和显示。
 */
import type { ChatMessageTextPart } from 'types/chat';
import { computed } from 'vue';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'BubblePartUserInput' });

interface Props {
  /** 要渲染的消息片段 */
  part: ChatMessageTextPart;
}

const props = withDefaults(defineProps<Props>(), {});

const FILE_REFERENCE_TOKEN_PATTERN =
  /<USER_QUOTED_FRAGMENT\b[^>]*\bpath="([^"]+)"[^>]*\brenderStartLine="(\d+)"[^>]*\brenderEndLine="(\d+)"[^>]*>[\s\S]*?<\/USER_QUOTED_FRAGMENT>\s*(.*)$/g;

const [name, bem] = createNamespace('', 'message-bubble-user-input');

/**
 * 将原始文本拆分为纯文本和文件引用标签片段。
 */
const content = computed(() => {
  const text = props.part.text || '';

  return text;
});
</script>

<style scoped lang="less">
.message-bubble-user-input {
  word-break: normal;
  white-space: pre-wrap;
}

.message-bubble-user-input__tag {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  font-size: 12px;
  line-height: 20px;
  color: var(--text-primary);
  border: 1px solid var(--border-secondary);
  border-radius: 4px;
}
</style>
