<!--
  @file ToolActivity.vue
  @description 展示工具持久化活动状态，并提供空闲运行工具的控制按钮。
-->
<template>
  <div :class="bem('activity', { [activity.state]: true })">
    <div :class="bem('activity-header')">
      <span :class="bem('activity-state')">{{ activityLabel }}</span>
      <span v-if="activityCount" :class="bem('activity-count')">{{ activityCount }}</span>
    </div>
    <div v-if="activity.progress?.phase" :class="bem('activity-phase')">{{ activity.progress.phase }}</div>
    <div v-if="activityMessage" :class="bem('activity-message')">{{ activityMessage }}</div>
    <div v-if="activity.state === 'running_idle' && lastProgressText" :class="bem('activity-time')">{{ lastProgressText }}</div>
    <div v-if="showIdleControls" :class="bem('activity-actions')">
      <BButton
        type="text"
        size="mini"
        :disabled="controlPending !== null"
        :loading="controlPending === 'continue_waiting'"
        @click="emit('control', 'continue_waiting')"
      >
        继续等待
      </BButton>
      <BButton type="text" size="mini" danger :disabled="controlPending !== null" :loading="controlPending === 'stop'" @click="emit('control', 'stop')">
        停止
      </BButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ChatMessageToolPart } from 'types/chat';
import type { ChatRuntimeControlToolInput } from 'types/chat-runtime';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'ToolActivity' });

/** 工具活动状态卡片属性。 */
interface Props {
  /** Main 持久化的工具活动状态快照。 */
  activity: NonNullable<ChatMessageToolPart['activity']>;
  /** 当前活动状态文案。 */
  activityLabel: string;
  /** 当前进度数量文案。 */
  activityCount: string;
  /** 当前活动状态的补充说明。 */
  activityMessage: string;
  /** 最后实质进展的相对时间。 */
  lastProgressText: string;
  /** 是否展示继续等待和停止按钮。 */
  showIdleControls: boolean;
  /** 当前正在提交的控制动作。 */
  controlPending: ChatRuntimeControlToolInput['action'] | null;
}

/** 工具活动状态卡片事件。 */
interface Emits {
  /** 请求控制当前工具。 */
  (event: 'control', action: ChatRuntimeControlToolInput['action']): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();
const [, bem] = createNamespace('', 'bubble-part-tool');
</script>

<style scoped lang="less">
.bubble-part-tool__activity {
  padding: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--color-fill-tertiary, rgb(0 0 0 / 3%));
  border-radius: 4px;
}

.bubble-part-tool__activity--running_idle,
.bubble-part-tool__activity--waiting_user,
.bubble-part-tool__activity--waiting_external {
  background: var(--color-warning-bg, rgb(250 173 20 / 8%));
}

.bubble-part-tool__activity--stopping,
.bubble-part-tool__activity--interrupted {
  background: var(--color-error-bg, rgb(255 0 0 / 8%));
}

.bubble-part-tool__activity-header {
  display: flex;
  gap: 8px;
  align-items: center;
}

.bubble-part-tool__activity-state {
  font-weight: 500;
  color: var(--text-primary);
}

.bubble-part-tool__activity-count,
.bubble-part-tool__activity-time {
  color: var(--text-tertiary);
}

.bubble-part-tool__activity-phase {
  margin-top: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
}

.bubble-part-tool__activity-message {
  margin-top: 2px;
  white-space: pre-wrap;
}

.bubble-part-tool__activity-time {
  margin-top: 2px;
  font-size: 11px;
}

.bubble-part-tool__activity-actions {
  display: flex;
  gap: 4px;
  margin-top: 6px;
}
</style>
