<template>
  <div :class="bem({ [type]: true })">
    <div
      :class="bem('title', { clickable: hasContent })"
      @mouseover="setTitleHover(true)"
      @mouseleave="setTitleHover(false)"
      @click="hasContent && toggleCollapse()"
    >
      <BIcon v-if="displayIcon" :icon="displayIcon" :class="bem('icon', { spin: displayIconSpin })" :size="14" />

      <div :class="bem('title-text')">
        <slot name="title"></slot>
      </div>
    </div>

    <BCollapseTransition>
      <div v-show="hasContent && !collapsed" :class="bem('content-wrap')">
        <div :class="bem('content')">
          <slot></slot>
        </div>
      </div>
    </BCollapseTransition>
  </div>
</template>

<script setup lang="ts">
/**
 * @file BubblePart.vue
 * @description 聊天气泡片段共享组件，处理折叠逻辑和通用结构。
 */
import { computed, ref } from 'vue';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'BubblePart' });

/** 气泡片段类型。 */
type BubblePartType = 'thinking' | 'tool-input' | 'tool-call' | 'tool-result' | 'tool';

interface Props {
  /** 片段类型 */
  type: BubblePartType;
  /** 是否有可展示内容（无内容时不可折叠） */
  hasContent?: boolean;
  /** 默认折叠状态，默认为 true（折叠） */
  defaultCollapsed?: boolean;
  /** 标题图标，不传时使用片段类型默认图标 */
  icon?: string;
  /** 标题图标是否旋转 */
  iconSpin?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  defaultCollapsed: true,
  hasContent: true,
  icon: undefined,
  iconSpin: false
});

const [, bem] = createNamespace('', 'message-bubble-part');
const collapsed = ref(props.defaultCollapsed);
const titleHovered = ref(false);

/** 片段类型默认标题图标。 */
const DEFAULT_ICON_MAP: Record<BubblePartType, string> = {
  thinking: 'lucide:sparkles',
  tool: 'lucide:hammer',
  'tool-call': 'lucide:hammer',
  'tool-input': 'lucide:terminal',
  'tool-result': 'lucide:check-circle-2'
};

const hasContent = computed(() => props.hasContent !== false);
const titleIcon = computed<string>(() => props.icon ?? DEFAULT_ICON_MAP[props.type]);
const collapseIcon = computed<string>(() => (collapsed.value ? 'lucide:chevron-down' : 'lucide:chevron-up'));
const showsCollapseIcon = computed<boolean>(() => hasContent.value && titleHovered.value);
const displayIcon = computed<string>(() => (showsCollapseIcon.value ? collapseIcon.value : titleIcon.value));
const displayIconSpin = computed<boolean>(() => !showsCollapseIcon.value && props.iconSpin);

/**
 * 更新标题 hover 状态，用于将标题图标临时切换为折叠按钮。
 * @param hovered - 标题是否处于 hover 状态
 */
function setTitleHover(hovered: boolean): void {
  titleHovered.value = hovered;
}

/**
 * 切换折叠状态。
 */
function toggleCollapse(): void {
  collapsed.value = !collapsed.value;
}
</script>

<style scoped lang="less">
.message-bubble-part {
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: var(--surface-border-width) solid var(--border-primary);
  border-radius: var(--surface-radius);
}

.message-bubble-part--thinking {
  background: var(--bg-tertiary);
}

.message-bubble-part--tool-input,
.message-bubble-part--tool-call,
.message-bubble-part--tool-result,
.message-bubble-part--tool {
  border-style: dashed;
}

.message-bubble-part__title {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 10px 12px;
  font-weight: 500;
  color: var(--text-primary);
}

.message-bubble-part__title-text {
  display: flex;
  flex: 1;
  gap: 6px;
  align-items: center;
  width: 0;
}

.message-bubble-part__title--clickable {
  cursor: pointer;
}

.message-bubble-part__icon {
  flex-shrink: 0;
}

.message-bubble-part__icon--spin {
  animation: message-bubble-part-spin 1.2s linear infinite;
}

@keyframes message-bubble-part-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.message-bubble-part__content {
  padding: 0 12px 10px;
}
</style>
