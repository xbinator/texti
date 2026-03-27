<template>
  <BToc :items="tocItems" :active-id="activeId" />
</template>

<script setup lang="ts">
import type { TocItem } from './components/Toc.vue';
import { computed, ref } from 'vue';
import { forEach, trim } from 'lodash-es';
import { marked } from 'marked';
import BToc from './components/Toc.vue';

interface Props {
  content?: string;
}

const props = defineProps<Props>();

const activeId = ref<string>('');

function parseToc(markdown: string): TocItem[] {
  const tokens = marked.lexer(markdown);
  const items: TocItem[] = [];
  let index = 0;

  forEach(tokens, (token) => {
    if (token.type === 'heading') {
      const { text } = token;
      const level = token.depth;

      if (trim(text)) {
        const id = `heading-${index}`;
        items.push({ id, text, level });
        index++;
      }
    }
  });

  // 计算相对层级
  if (items.length) {
    const minLevel = Math.min(...items.map((item) => item.level));

    items.forEach((item) => (item.level = item.level - minLevel + 1));
  }

  return items;
}

const tocItems = computed<TocItem[]>(() => {
  if (!props.content) return [];

  return parseToc(props.content);
});
</script>
