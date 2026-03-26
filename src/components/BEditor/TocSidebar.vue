<template>
  <div class="toc-sidebar">
    <div class="toc-header">目录</div>
    <div class="toc-content">
      <div
        v-for="item in tocItems"
        :key="item.id"
        class="toc-item"
        :class="[`toc-level-${item.level}`, { 'toc-active': activeId === item.id }]"
        :style="{ paddingLeft: `${(item.level - 1) * 16}px` }"
        @click="scrollToHeading(item.id)"
      >
        {{ item.text }}
      </div>
      <div v-if="tocItems.length === 0" class="toc-empty">暂无标题</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface Props {
  content?: string;
}

const props = defineProps<Props>();

const tocItems = ref<TocItem[]>([]);
const activeId = ref<string>('');

function parseToc(html: string): TocItem[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
  const items: TocItem[] = [];

  headings.forEach((heading, index) => {
    const level = parseInt(heading.tagName.charAt(1), 10);
    const text = heading.textContent || '';
    const id = `heading-${index}`;

    heading.id = id;
    items.push({
      id,
      text,
      level
    });
  });

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
  const headings = Array.from(
    document.querySelectorAll('.tiptap-editor h1, .tiptap-editor h2, .tiptap-editor h3, .tiptap-editor h4, .tiptap-editor h5, .tiptap-editor h6')
  );
  let currentId = '';

  headings.forEach((heading) => {
    const rect = heading.getBoundingClientRect();
    if (rect.top >= 0 && rect.top < window.innerHeight / 2) {
      currentId = heading.id;
    }
  });

  if (currentId) {
    activeId.value = currentId;
  }
}

let observer: IntersectionObserver | null = null;

function setupObserver() {
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          activeId.value = entry.target.id;
        }
      });
    },
    {
      rootMargin: '-20% 0px -70% 0px'
    }
  );

  const headings = Array.from(
    document.querySelectorAll('.tiptap-editor h1, .tiptap-editor h2, .tiptap-editor h3, .tiptap-editor h4, .tiptap-editor h5, .tiptap-editor h6')
  );
  headings.forEach((heading) => {
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
  window.addEventListener('scroll', updateActiveHeading);
});

onUnmounted(() => {
  window.removeEventListener('scroll', updateActiveHeading);
  if (observer) {
    observer.disconnect();
  }
});
</script>

<style scoped>
.toc-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
}

.toc-header {
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 600;
  color: #333;
  border-bottom: 1px solid #e0e0e0;
}

.toc-content {
  flex: 1;
  padding: 8px;
  overflow-y: auto;
}

.toc-item {
  padding: 6px 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  color: #666;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.2s;
}

.toc-item:hover {
  color: #333;
}

.toc-item.toc-active {
  font-weight: 500;
  color: #1761d2;
}

.toc-level-1 {
  font-size: 14px;
  font-weight: 500;
}

.toc-level-2 {
  font-weight: 400;
}

.toc-level-3 {
  font-weight: 400;
  color: #888;
}

.toc-level-4,
.toc-level-5,
.toc-level-6 {
  font-size: 12px;
  font-weight: 400;
  color: #999;
}

.toc-empty {
  padding: 40px 16px;
  font-size: 13px;
  color: #999;
  text-align: center;
}
</style>
