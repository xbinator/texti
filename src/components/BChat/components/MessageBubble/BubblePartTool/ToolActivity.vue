<!--
  @file ToolActivity.vue
  @description 展示工具持久化活动状态，并提供空闲运行工具的控制按钮。
-->
<template>
  <div :class="bem('activity', { [activityState]: true })">
    <span :class="bem('activity-state')">{{ activityLabel }}</span>
    <div v-if="showIdleControls" :class="bem('activity-actions')">
      <BButton
        type="secondary"
        size="mini"
        :disabled="controlPending !== null"
        :loading="controlPending === 'continue_waiting'"
        @click="emit('control', 'continue_waiting')"
      >
        继续等待
      </BButton>
      <BButton type="secondary" size="mini" danger :disabled="controlPending !== null" :loading="controlPending === 'stop'" @click="emit('control', 'stop')">
        停止
      </BButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ChatMessageToolPart } from 'types/chat';
import type { ChatRuntimeControlToolInput } from 'types/chat-runtime';
import { computed } from 'vue';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'ToolActivity' });

/** 工具活动状态卡片属性。 */
interface Props {
  /** Main 持久化的工具活动状态快照。 */
  activity: NonNullable<ChatMessageToolPart['activity']>;
  /** 当前活动状态文案。 */
  activityLabel: string;
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

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const [, bem] = createNamespace('', 'bubble-part-tool');

/** 当前工具活动状态，用于样式修饰与空闲判断。 */
const activityState = computed(() => props.activity.state);
</script>

<style scoped lang="less">
.bubble-part-tool__activity {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 32px;
  padding: 0 8px;
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

.bubble-part-tool__activity-state {
  font-weight: 500;
  color: var(--text-primary);
}

.bubble-part-tool__activity-actions {
  display: flex;
  gap: 4px;
}
</style>
