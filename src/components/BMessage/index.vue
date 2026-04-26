<template>
  <div ref="rootRef" class="b-message" :class="`b-message--${loading ? 'streaming' : 'done'}`" :style="rootStyle">
    <div class="b-message__placeholder" aria-hidden="true"></div>

    <div class="b-message__container">
      <!-- Markdown 渲染 -->
      <div v-if="type === 'markdown'" class="b-message__markdown" @click="handleMarkdownClick" v-html="renderedMarkdown"></div>

      <!-- 纯文本渲染 -->
      <div v-else class="b-message__text">{{ content }}<span v-if="loading" class="b-message__cursor" aria-hidden="true"></span></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { BMessageProps as Props } from './types';
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { marked } from 'marked';
import { addCssUnit } from '@/utils/css';

defineOptions({ name: 'BMessage' });

const router = useRouter();

const props = withDefaults(defineProps<Props>(), {
  type: 'markdown',
  loading: false,
  content: '',
  height: undefined,
  maxHeight: undefined
});

const rootStyle = computed(() => {
  return {
    height: addCssUnit(props.height),
    maxHeight: addCssUnit(props.maxHeight)
  };
});

const renderedMarkdown = computed<string>(() => {
  if (!props.content && !props.loading) return '';
  // 如果没有内容但正在加载，直接显示光标
  if (!props.content && props.loading) return '<span class="b-message__cursor" aria-hidden="true"></span>';

  // 使用一个不可能出现在正常内容中的标记符
  const CURSOR_MARKER = '___B_MESSAGE_CURSOR_MARKER___';

  // 在内容末尾追加标记符，如果是流式加载状态
  const textToParse = props.loading ? props.content + CURSOR_MARKER : props.content;

  // 解析 Markdown
  let html = marked.parse(textToParse, { async: false }) as string;

  // 将解析后的标记符替换为光标的 HTML 标签
  // 这样光标就会完美跟随在最后一个渲染节点（如 p, pre, table 等）的内部末尾
  if (props.loading) {
    html = html.replace(CURSOR_MARKER, '<span class="b-message__cursor" aria-hidden="true"></span>');
  }

  return html;
});

// 处理 Markdown 内容中的链接点击
const handleMarkdownClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement;
  // 查找被点击的 a 标签
  const anchor = target.closest('a');
  if (anchor) {
    event.preventDefault();
    const url = anchor.getAttribute('href');

    url && router.push({ name: 'webview', query: { url: encodeURIComponent(url) } });
  }
};
</script>

<style lang="less">
@import url('@/assets/styles/markdown.less');

.b-message {
  position: relative;
  display: flex;
  flex-direction: column-reverse;
  overflow-y: auto;
  line-height: 1.7;
  overflow-wrap: break-word;
  .scrollbar-base();
}

.b-message__placeholder {
  flex: 1 0 auto;
  pointer-events: none;
}

.b-message__container {
  width: 100%;
}

.b-message__text {
  white-space: pre-wrap;
}

.b-message__markdown {
  .markdown-base();
}

.b-message__cursor {
  display: inline-block;
  width: 1px;
  height: 1em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: var(--color-primary);
  border-radius: 1px;
  animation: b-stream-cursor-blink 0.8s steps(1) infinite;
}

@keyframes b-stream-cursor-blink {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0;
  }
}
</style>
