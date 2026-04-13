<template>
  <BPanelSplitter v-model:size="sidebarWidth" position="right" :min-width="180" :max-width="400">
    <div class="b-editor-sidebar">
      <AnchorContent v-if="items.length > 0" :title="title" :items="items" :active-id="activeId" @click="handleAnchorClick" />
      <div v-else class="empty-state">
        <div class="empty-icon">📝</div>
        <div class="empty-text">暂无目录大纲</div>
        <div class="empty-subtext">在正文输入标题以生成目录</div>
      </div>
    </div>
  </BPanelSplitter>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { marked, Tokens } from 'marked';
import AnchorContent, { AnchorItem } from './components/AnchorContent.vue';

interface Props {
  title?: string;
  content?: string;
  anchorIdPrefix?: string;
  // 当前选中的锚点id
  activeId?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  content: '',
  anchorIdPrefix: '',
  activeId: ''
});

const emit = defineEmits(['change']);

const sidebarWidth = ref(260);

const items = computed(() => {
  if (!props.content) return [];

  const tokens = marked.lexer(props.content);

  const headings = tokens.filter((t) => t.type === 'heading' && t.text?.trim()) as Tokens.Heading[];

  const _headings = headings.map((t, i) => ({
    id: props.anchorIdPrefix ? `${props.anchorIdPrefix}-heading-${i}` : `heading-${i}`,
    text: t.text.trim(),
    level: t.depth
  }));

  const minLevel = Math.min(..._headings.map((h) => h.level));

  return _headings.map((h) => ({ ...h, level: h.level - minLevel + 1 }));
});

function handleAnchorClick(item: AnchorItem) {
  emit('change', item);
}
</script>

<style scoped>
.b-editor-sidebar {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg-primary);
  border-radius: 8px;
  backdrop-filter: blur(10px);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 24px;
  color: var(--text-tertiary, #999);
  text-align: center;
}

.empty-icon {
  margin-bottom: 12px;
  font-size: 32px;
  opacity: 0.6;
}

.empty-text {
  margin-bottom: 4px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary, #666);
}

.empty-subtext {
  font-size: 12px;
  opacity: 0.8;
}
</style>
