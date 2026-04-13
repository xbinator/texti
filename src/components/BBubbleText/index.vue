<template>
  <BBubble
    :size="size"
    :avatar="avatar"
    :state="_state"
    :loading="loading"
    :placement="placement"
    :is-collapse="isCollapse"
    :collapse-options="collapseOptions"
  >
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
          <BMessage :content="typedThink" :type="isMarkdown ? 'markdown' : 'text'" :loading="effect.think" />
        </div>
      </div>
    </template>

    <div class="b-bubble-text__content">
      <BMessage :content="typedContent" :type="isMarkdown ? 'markdown' : 'text'" :loading="effect.content" />
    </div>

    <template v-if="$slots.toolbar" #toolbar>
      <slot name="toolbar"></slot>
    </template>
  </BBubble>
</template>

<script setup lang="ts">
import type { BBubbleTextProps } from './types';
import { computed, reactive, watch } from 'vue';
import { Icon } from '@iconify/vue';
import BBubble from '../BBubble/index.vue';
import BMessage from '../BMessage/index.vue';
import useTyping from './hooks/useTyping';

defineOptions({ name: 'BBubbleText' });

const props = withDefaults(defineProps<BBubbleTextProps>(), {
  typing: false,
  content: '',
  think: '',
  thinkTitle: '',
  isMarkdown: true,
  placement: 'left',
  state: 'complete',
  size: 'fill'
});

const emit = defineEmits<{
  (e: 'typing-complete'): void;
}>();

const _content = computed(() => props.content);
const _think = computed(() => props.think);

const [typedContent, isContentTyping] = useTyping(() => props.typing, _content);
const [typedThink, isThinkTyping] = useTyping(() => props.typing, _think);

const isTyping = computed(() => isContentTyping.value || isThinkTyping.value);

const _state = computed(() => {
  if (props.state !== 'complete') return props.state;
  return isTyping.value ? 'output' : 'complete';
});

const collapse = reactive({ think: false });

const effect = computed(() => {
  if (props.placement !== 'left') return {};

  const state = _state.value === 'output';

  if (props.content) return { content: state };

  return { think: state };
});

function handleThinkCollapse(): void {
  collapse.think = !collapse.think;
}

watch(
  () => [isTyping.value, props.loading],
  () => {
    if (!isTyping.value && !props.loading) {
      emit('typing-complete');
    }
  },
  { immediate: true }
);
</script>

<style scoped lang="less">
.b-bubble-text {
  &__think {
    margin: 10px 0 0;
    line-height: 1.6;
  }

  &__think-toggle {
    display: flex;
    align-items: center;
    width: fit-content;
    padding: 4px 10px;
    font-size: 13px;
    cursor: pointer;
    background-color: var(--bg-secondary);
    border-radius: 6px;
    transition: background-color 0.2s;

    &:hover {
      background-color: var(--bg-tertiary);
    }
  }

  &__think-title {
    margin-right: 6px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  &__think-icon {
    font-size: 14px;
    color: var(--text-tertiary);
    transition: transform 0.2s;
  }

  &__think-content {
    position: relative;
    padding: 12px 0 0 14px;
    margin-top: 10px;
    font-size: 14px;
    color: var(--text-secondary);

    &::before {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      width: 2px;
      content: '';
      background: var(--border-primary);
      border-radius: 1px;
    }
  }

  &__content {
    min-height: 1em;
  }
}
</style>
