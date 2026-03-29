<template>
  <Transition name="toc-fade">
    <div v-if="items.length" class="toc-panel">
      <AnchorContent :title="title" :items="items" :active-id="activeId" @click="handleAnchorClick" />
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { marked, Tokens } from 'marked';
import AnchorContent, { AnchorItem } from './components/AnchorContent.vue';

interface Props {
  title?: string;
  content?: string;
  // 当前选中的锚点id
  activeId?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  content: '',
  activeId: ''
});

const emit = defineEmits(['change']);

const items = computed(() => {
  if (!props.content) return [];

  const tokens = marked.lexer(props.content);

  const headings = tokens.filter((t) => t.type === 'heading' && t.text?.trim()) as Tokens.Heading[];

  const _headings = headings.map((t, i) => ({ id: `heading-${i}`, text: t.text.trim(), level: t.depth }));

  const minLevel = Math.min(..._headings.map((h) => h.level));

  return _headings.map((h) => ({ ...h, level: h.level - minLevel + 1 }));
});

function handleAnchorClick(item: AnchorItem) {
  emit('change', item);
}
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
