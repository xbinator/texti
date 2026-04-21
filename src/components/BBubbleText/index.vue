<template>
  <BBubble :size="size" :avatar="avatar" :loading="loading" :placement="placement" :is-collapse="isCollapse" :collapse-options="collapseOptions">
    <template v-if="$slots.avatar" #avatar>
      <slot name="avatar"></slot>
    </template>

    <template v-if="$slots.header" #header>
      <slot name="header"></slot>
    </template>

    <template v-if="think" #top>
      <div class="b-bubble-text__think">
        <div class="b-bubble-text__think-toggle" @click="handleThinkCollapse">
          <div class="b-bubble-text__think-title">{{ thinkTitle || '深度思考' }}</div>
          <Icon :icon="collapse.think ? 'lucide:chevron-up' : 'lucide:chevron-down'" class="b-bubble-text__think-icon" />
        </div>
        <div v-show="!collapse.think" class="b-bubble-text__think-content">
          <BMessage :content="think" :type="isMarkdown ? 'markdown' : 'text'" />
        </div>
      </div>
    </template>

    <div class="b-bubble-text__content">
      <BMessage :content="content" :type="isMarkdown ? 'markdown' : 'text'" />
    </div>

    <template v-if="$slots.toolbar" #toolbar>
      <slot name="toolbar"></slot>
    </template>
  </BBubble>
</template>

<script setup lang="ts">
import type { BBubbleTextProps } from './types';
import { reactive } from 'vue';
import { Icon } from '@iconify/vue';
import BBubble from '../BBubble/index.vue';
import BMessage from '../BMessage/index.vue';

defineOptions({ name: 'BBubbleText' });

withDefaults(defineProps<BBubbleTextProps>(), {
  typing: false,
  content: '',
  think: '',
  thinkTitle: '',
  isMarkdown: true,
  placement: 'left',
  state: 'complete',
  size: 'fill'
});

const collapse = reactive({ think: false });

function handleThinkCollapse(): void {
  collapse.think = !collapse.think;
}
</script>

<style lang="less">
.b-bubble-text__think {
  line-height: 1.6;
}

.b-bubble-text__think-toggle {
  display: flex;
  align-items: center;
  width: fit-content;
  padding: 4px 10px;
  margin-bottom: 10px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
  background-color: var(--bg-secondary);
  border-radius: 6px;
  transition: background-color 0.2s;
}

.b-bubble-text__think-toggle:hover {
  background-color: var(--bg-tertiary);
}

.b-bubble-text__think-title {
  margin-right: 6px;
  font-weight: 500;
  color: var(--text-secondary);
}

.b-bubble-text__think-icon {
  font-size: 14px;
  color: var(--text-tertiary);
  transition: transform 0.2s;
}

.b-bubble-text__think-content {
  position: relative;
  padding: 0 0 0 8px;
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

.b-bubble-text__think-content::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 2px;
  content: '';
  background: var(--border-primary);
  border-radius: 1px;
}

.b-bubble-text__content {
  min-height: 1em;
}
</style>
