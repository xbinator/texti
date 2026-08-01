<!--
  @file BubblePartStatus.vue
  @description 聊天气泡状态片段，统一展示中断与上下文压缩状态节点。
-->
<template>
  <div :class="[name, bem({ [state.status]: true })]" role="status" aria-live="polite">
    <div :class="bem('rail')">
      <span :class="bem('line')"></span>
      <span :class="bem('pill')">{{ state.label }}</span>
      <span :class="bem('line')"></span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file BubblePartStatus.vue
 * @description 聊天气泡状态片段，统一展示中断与上下文压缩状态节点。
 */
import type { ChatMessageCompactionPart } from 'types/chat';
import { computed } from 'vue';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'BubblePartStatus' });

/** 状态节点组件属性。 */
interface Props {
  /** 上下文压缩片段；省略时展示消息中断状态。 */
  part?: ChatMessageCompactionPart;
}

/** 状态节点公开展示配置。 */
interface StatusView {
  /** 状态样式标识。 */
  status: ChatMessageCompactionPart['status'] | 'interrupt';
  /** 唯一可见文案。 */
  label: string;
}

const props = defineProps<Props>();
const [name, bem] = createNamespace('bubble-part-status');

/** 压缩生命周期状态对应的公开展示，不读取摘要和诊断字段。 */
const COMPACTION_VIEW_MAP: Record<ChatMessageCompactionPart['status'], StatusView> = {
  pending: { status: 'pending', label: '上下文压缩中…' },
  success: { status: 'success', label: '上下文已压缩' },
  failed: { status: 'failed', label: '上下文压缩失败' },
  cancelled: { status: 'cancelled', label: '上下文压缩已取消' },
  skipped: { status: 'skipped', label: '当前上下文无需压缩' }
};

/** 当前消息状态的用户可见配置。 */
const state = computed<StatusView>((): StatusView => {
  if (!props.part) return { status: 'interrupt', label: '已中断' };
  return COMPACTION_VIEW_MAP[props.part.status];
});
</script>

<style scoped lang="less">
.b-bubble-part-status {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 6px 0;
}

.b-bubble-part-status__rail {
  display: flex;
  gap: 10px;
  align-items: center;
  width: 100%;
}

.b-bubble-part-status__line {
  flex: 1;
  height: 1px;
  background: var(--border-primary);
  opacity: 0.75;
}

.b-bubble-part-status__pill {
  padding: 4px 10px;
  font-size: 11px;
  line-height: 1;
  color: var(--text-tertiary);
  background: var(--bg-hover);
  border: var(--control-border-width) solid var(--border-primary);
  border-radius: var(--radius-full);
}
</style>
