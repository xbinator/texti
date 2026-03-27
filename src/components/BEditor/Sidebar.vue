<template>
  <Transition name="toc-fade">
    <div v-if="tocItems.length" class="toc-sidebar">
      <div class="toc-content">
        <div
          v-for="item in tocItems"
          :key="item.id"
          class="toc-item truncate"
          :class="[`toc-level-${item.level}`, { 'toc-active': activeId === item.id }]"
          :style="{ paddingLeft: `${(item.level - 1) * 16}px` }"
          @click="scrollToHeading(item.id)"
        >
          {{ item.text }}
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { throttle, forEach, trim } from 'lodash-es';
import { marked } from 'marked';

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface Props {
  content?: string;
}

const props = defineProps<Props>();

const HEADING_SELECTOR = '.tiptap-editor h1, .tiptap-editor h2, .tiptap-editor h3, .tiptap-editor h4, .tiptap-editor h5, .tiptap-editor h6';
const OBSERVER_ROOT_MARGIN = '-20% 0px -70% 0px';
const SCROLL_THROTTLE_DELAY = 100;

const tocItems = ref<TocItem[]>([]);
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
  if (items.length > 0) {
    const minLevel = Math.min(...items.map((item) => item.level));
    items.forEach((item) => {
      item.level = item.level - minLevel + 1;
    });
  }

  return items;
}

function updateToc() {
  if (props.content) {
    tocItems.value = parseToc(props.content);
  } else {
    tocItems.value = [];
  }
}

function scrollToHeading(id: string) {
  const element = document.getElementById(id);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    activeId.value = id;
  }
}

function updateActiveHeading() {
  const headings = Array.from(document.querySelectorAll(HEADING_SELECTOR));
  let currentId = '';

  forEach(headings, (heading) => {
    const rect = heading.getBoundingClientRect();
    if (rect.top >= 0 && rect.top < window.innerHeight / 2) {
      currentId = heading.id;
    }
  });

  if (currentId) {
    activeId.value = currentId;
  }
}

const throttledUpdateActiveHeading = throttle(updateActiveHeading, SCROLL_THROTTLE_DELAY);

let observer: IntersectionObserver | null = null;

function setupObserver() {
  if (observer) {
    observer.disconnect();
  }

  observer = new IntersectionObserver(
    (entries) => {
      forEach(entries, (entry) => {
        if (entry.isIntersecting) {
          activeId.value = entry.target.id;
        }
      });
    },
    {
      rootMargin: OBSERVER_ROOT_MARGIN
    }
  );

  const headings = Array.from(document.querySelectorAll(HEADING_SELECTOR));
  forEach(headings, (heading) => {
    observer?.observe(heading);
  });
}

watch(
  () => props.content,
  () => {
    updateToc();
    setTimeout(() => {
      setupObserver();
    }, 100);
  },
  { immediate: true }
);

onMounted(() => {
  window.addEventListener('scroll', throttledUpdateActiveHeading);
});

onUnmounted(() => {
  window.removeEventListener('scroll', throttledUpdateActiveHeading);
  if (observer) {
    observer.disconnect();
  }
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

.toc-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.toc-content {
  width: 280px;
  padding: 20px 0 12px;
  overflow-y: auto;
}

.toc-item {
  margin: 6px 0 0 28px;
  font-size: 13px;
  cursor: pointer;
  transition: color 0.2s;
}

.toc-level-4,
.toc-level-5,
.toc-level-6 {
  font-size: 12px;
  color: #999;
}
</style>
