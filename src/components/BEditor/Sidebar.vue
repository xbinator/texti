<template>
  <Transition name="toc-fade">
    <div v-if="tocItems.length" class="toc-panel">
      <!-- <div class="toc-panel__header">
        <span class="toc-panel__title">目录</span>
      </div> -->
      <TocContent :items="tocItems" :active-id="activeId" />
    </div>
  </Transition>
</template>

<script setup lang="ts">
import type { TocItem } from './components/TocContent.vue';
import { computed, ref } from 'vue';
import { forEach, trim } from 'lodash-es';
import { marked } from 'marked';
import TocContent from './components/TocContent.vue';

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

<style scoped>
.toc-fade-enter-active,
.toc-fade-leave-active {
  transition: all 0.3s ease;
}

.toc-fade-enter-from,
.toc-fade-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

.toc-panel {
  display: flex;
  flex-direction: column;
  width: 280px;
  height: 100%;
  background: rgb(255 255 255 / 72%);
  border-right: 1px solid rgb(208 215 222 / 85%);
  backdrop-filter: blur(10px);
}

.toc-panel__header {
  display: flex;
  align-items: center;
  height: 52px;
  padding: 0 14px;
  border-bottom: 1px solid #eaeef2;
}

.toc-panel__title {
  font-size: 13px;
  font-weight: 600;
  color: #57606a;
  letter-spacing: 0.08em;
}
</style>
