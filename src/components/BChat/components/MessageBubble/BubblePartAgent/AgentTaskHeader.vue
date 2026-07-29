<template>
  <div :class="bem('header')">
    <span :class="bem('mode')">{{ MODE_LABELS[resolvedTask.mode] }}</span>
    <span :class="bem('task')">{{ resolvedTask.task }}</span>
    <button
      :class="bem('toggle')"
      type="button"
      data-action="toggle-detail"
      :aria-controls="detailPanelId"
      :aria-expanded="expanded"
      @click="emit('toggle-detail')"
    >
      {{ expanded ? '收起详情' : '展开详情' }}
    </button>
  </div>
  <div :class="bem('meta')">
    <span :class="bem('status')">
      <BIcon :icon="statusView.icon" :size="14" />
      <span>{{ statusLabel }}</span>
    </span>
    <span v-if="elapsedText" :class="bem('elapsed')">{{ elapsedText }}</span>
    <span :class="bem('priority')">{{ PRIORITY_LABELS[resolvedTask.priority] }}</span>
    <button
      v-if="canCancelTask"
      :class="bem('cancel')"
      type="button"
      data-action="cancel-task"
      :disabled="cancelBusy || Boolean(resolvedTask.cancellation)"
      @click="emit('cancel-task')"
    >
      {{ cancelButtonLabel }}
    </button>
  </div>
  <p v-if="cancelError" :class="bem('notice')" role="alert">
    <code>{{ cancelError }}</code>
  </p>
  <p v-if="resolvedTask.status === 'committing'" :class="bem('notice')">提交可能已无法中断</p>
  <p v-if="resolvedTask.summary" :class="bem('summary')">{{ resolvedTask.summary }}</p>
</template>

<script setup lang="ts">
/**
 * @file AgentTaskHeader.vue
 * @description Agent Task 卡片的头部展示：模式、任务名、状态、耗时、优先级与取消操作。
 */
import type { StatusView } from './index.vue';
import type { AgentTaskMode, AgentTaskPriority, ChatAgentTaskSummarySnapshot } from 'types/chat-agent';
import { createNamespace } from '@/utils/namespace';

/** Agent Task Header 属性。 */
interface Props {
  /** 当前活动 Task 投影。 */
  resolvedTask: ChatAgentTaskSummarySnapshot;
  /** 状态视图。 */
  statusView: StatusView;
  /** 状态文案。 */
  statusLabel: string;
  /** 已耗时文本。 */
  elapsedText: string | undefined;
  /** 是否可取消。 */
  canCancelTask: boolean;
  /** 取消请求是否进行中。 */
  cancelBusy: boolean;
  /** 取消按钮文案。 */
  cancelButtonLabel: string;
  /** 取消操作的本地错误。 */
  cancelError: string | null;
  /** 详情区域是否展开。 */
  expanded: boolean;
  /** 详情面板 DOM ID。 */
  detailPanelId: string;
}

/** Header 事件定义。 */
interface Emits {
  /** 切换详情展开状态。 */
  (event: 'toggle-detail'): void;
  /** 请求取消当前 Task。 */
  (event: 'cancel-task'): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();
const [, bem] = createNamespace('agent-task-card');

/** Task 模式展示文案。 */
const MODE_LABELS: Record<AgentTaskMode, string> = {
  read: '只读',
  write: '受控写入'
};

/** Task 优先级展示文案。 */
const PRIORITY_LABELS: Record<AgentTaskPriority, string> = {
  low: '低优先级',
  normal: '普通优先级',
  high: '高优先级'
};
</script>

<style scoped lang="less">
.b-agent-task-card__header,
.b-agent-task-card__meta {
  display: flex;
  gap: 6px;
  align-items: center;
}

.b-agent-task-card__meta {
  flex-wrap: wrap;
  margin-top: 6px;
}

.b-agent-task-card__toggle {
  flex-shrink: 0;
  padding: 0;
  margin-left: auto;
  font: inherit;
  color: var(--color-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
}

.b-agent-task-card__mode {
  flex-shrink: 0;
  font-weight: 600;
  color: var(--color-primary);
}

.b-agent-task-card__task {
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
}

.b-agent-task-card__status {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  color: var(--text-primary);
}

.b-agent-task-card__cancel {
  padding: 0;
  margin-left: auto;
  font: inherit;
  color: var(--color-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
}

.b-agent-task-card__cancel:disabled {
  color: var(--text-tertiary);
  cursor: not-allowed;
}

.b-agent-task-card__elapsed,
.b-agent-task-card__priority {
  color: var(--text-tertiary);
}

.b-agent-task-card__summary {
  margin: 6px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.5;
  color: var(--text-secondary);
  white-space: nowrap;
}

.b-agent-task-card__notice {
  color: var(--text-tertiary);
}
</style>
