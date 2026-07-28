<template>
  <div v-if="identityConflict" :class="[name, bem('protocol-error')]" role="alert">
    <BIcon icon="lucide:shield-alert" :size="14" />
    <span>任务投影身份冲突</span>
    <code>agent_task_identity_conflict</code>
  </div>

  <div v-else-if="lookupError === 'protocol'" :class="[name, bem('protocol-error')]" role="alert">
    <BIcon icon="lucide:shield-alert" :size="14" />
    <span>任务投影无法验证</span>
    <code>agent_task_projection_invalid</code>
  </div>

  <div v-else-if="resolvedTask?.recordState === 'tombstoned'" :class="[name, bem('tombstone')]">
    <div :class="bem('title')">
      <BIcon icon="lucide:archive-x" :size="14" />
      <span>任务记录已移除</span>
    </div>
    <time :class="bem('updated')">{{ formatTimestamp(resolvedTask.updatedAt) }}</time>
  </div>

  <div v-else-if="resolvedTask?.recordState === 'active'" :class="name">
    <div :class="bem('header')">
      <span :class="bem('mode')">{{ MODE_LABELS[resolvedTask.mode] }}</span>
      <span :class="bem('task')">{{ resolvedTask.task }}</span>
    </div>
    <div :class="bem('meta')">
      <span :class="bem('status')">
        <BIcon :icon="statusView.icon" :size="14" />
        <span>{{ statusLabel }}</span>
      </span>
      <span v-if="elapsedText" :class="bem('elapsed')">{{ elapsedText }}</span>
      <span :class="bem('priority')">{{ PRIORITY_LABELS[resolvedTask.priority] }}</span>
    </div>
    <p v-if="resolvedTask.summary" :class="bem('summary')">{{ resolvedTask.summary }}</p>
  </div>

  <BubblePartTool v-else :part="safeFallbackPart" />
</template>

<script setup lang="ts">
/**
 * @file BubblePartAgentTask.vue
 * @description 在原 delegate_task Tool Part 位置展示 Main-owned Child Task 轻量投影。
 */
import type { ChatMessageToolPart } from 'types/chat';
import type { AgentTaskMode, AgentTaskPriority, AgentTaskStatus, ChatAgentTaskEventSnapshot, ChatAgentTaskSnapshot } from 'types/chat-agent';
import { computed, onScopeDispose, ref, watch } from 'vue';
import { readTaskResultId, readTaskResultStatus } from '@/components/BChat/utils/agentTaskPart';
import { createTaskIndexKey, isTaskProjectionError, useChatAgentTaskStore } from '@/stores/chat/agentTask';
import { asyncTo } from '@/utils/asyncTo';
import { createNamespace } from '@/utils/namespace';
import BubblePartTool from './BubblePartTool/index.vue';

defineOptions({ name: 'BubblePartAgentTask' });

/** 任务卡片属性。 */
interface Props {
  /** 权威 Session 身份。 */
  sessionId: string | null;
  /** 原 Assistant 消息身份。 */
  assistantMessageId: string;
  /** 原 delegate_task Tool Part。 */
  part: ChatMessageToolPart;
}

/** 状态的文字、图标和终态属性。 */
interface StatusView {
  /** 用户可读状态。 */
  label: string;
  /** 同时表达状态语义的图标。 */
  icon: string;
  /** 状态是否停止本地计时。 */
  terminal: boolean;
}

/** 定向恢复后的本地错误状态。 */
type LookupError = 'unavailable' | 'protocol' | null;

const props = defineProps<Props>();
const [name, bem] = createNamespace('agent-task-card');
const agentTaskStore = useChatAgentTaskStore();

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

/** 全部 Task 状态的穷举文字、图标和终态映射。 */
const STATUS_VIEWS: Record<AgentTaskStatus, StatusView> = {
  created: { label: '已创建', icon: 'lucide:file-plus-2', terminal: false },
  planning: { label: '规划中', icon: 'lucide:list-tree', terminal: false },
  authorized: { label: '已授权', icon: 'lucide:shield-check', terminal: false },
  queued: { label: '排队中', icon: 'lucide:clock-3', terminal: false },
  starting: { label: '启动中', icon: 'lucide:loader-circle', terminal: false },
  running: { label: '运行中', icon: 'lucide:play-circle', terminal: false },
  waiting_confirmation: { label: '等待确认', icon: 'lucide:circle-help', terminal: false },
  committing: { label: '提交中', icon: 'lucide:git-commit-horizontal', terminal: false },
  cancelling: { label: '取消中', icon: 'lucide:loader-circle', terminal: false },
  completed: { label: '已完成', icon: 'lucide:circle-check', terminal: true },
  failed: { label: '失败', icon: 'lucide:circle-alert', terminal: true },
  cancelled: { label: '已取消', icon: 'lucide:circle-x', terminal: true },
  deadline_exceeded: { label: '已超时', icon: 'lucide:timer-off', terminal: true },
  commit_failed: { label: '提交失败', icon: 'lucide:git-commit-horizontal', terminal: true }
};

/** Renderer 当前时钟，仅供已解析的活动 Task 近似计时。 */
const nowMs = ref(Date.now());
/** 当前定向恢复错误。 */
const lookupError = ref<LookupError>(null);
/** 当前已发起的恢复 key，避免同一身份递归查询。 */
let requestedLookupKey: string | undefined;
/** 定向请求 epoch，阻止迟到响应改写当前卡片状态。 */
let requestEpoch = 0;
/** 活动计时器。 */
let elapsedTimer: ReturnType<typeof setInterval> | undefined;

/** Result 中仅用于交叉验证的 Task 身份。 */
const resultTaskId = computed<string | undefined>(() => readTaskResultId(props.part));
/** 当前原位置的复合索引 key。 */
const taskIndexKey = computed<string | undefined>(() => {
  if (!props.sessionId) return undefined;
  return createTaskIndexKey(props.sessionId, props.assistantMessageId, props.part.toolCallId);
});
/** 复合索引中的 Task 身份。 */
const indexedTaskId = computed<string | undefined>(() => {
  const indexKey = taskIndexKey.value;
  return indexKey ? agentTaskStore.taskIdsByMessageToolCall[indexKey] : undefined;
});
/** 复合索引和外层 Result 是否发生身份冲突。 */
const identityConflict = computed<boolean>(() => Boolean(indexedTaskId.value && resultTaskId.value && indexedTaskId.value !== resultTaskId.value));
/** 只从复合索引读取的可信 Task 投影。 */
const indexedTask = computed<ChatAgentTaskEventSnapshot | undefined>(() => {
  if (!props.sessionId) return undefined;
  return agentTaskStore.findTask(props.sessionId, props.assistantMessageId, props.part.toolCallId);
});
/** 卡片可展示的 Task；Result 只做一致性交叉验证，不能直接取 tasksById。 */
const resolvedTask = computed<ChatAgentTaskEventSnapshot | undefined>(() => {
  if (identityConflict.value) return undefined;
  const snapshot = indexedTask.value;
  if (!snapshot) return undefined;
  if (resultTaskId.value && resultTaskId.value !== snapshot.taskId) return undefined;
  return snapshot;
});
/** 找不到投影时允许发起一次定向查询的 Task 身份。 */
const lookupTaskId = computed<string | undefined>(() => {
  if (!props.sessionId || identityConflict.value || resolvedTask.value) return undefined;
  return indexedTaskId.value ?? resultTaskId.value;
});
/** 活跃 Summary 的状态展示。 */
const statusView = computed<StatusView>(() => {
  const snapshot = resolvedTask.value;
  return snapshot?.recordState === 'active' ? STATUS_VIEWS[snapshot.status] : STATUS_VIEWS.created;
});
/** queued 阶段的精确状态文案。 */
const statusLabel = computed<string>(() => {
  const snapshot = resolvedTask.value;
  if (snapshot?.recordState !== 'active' || snapshot.status !== 'queued') return statusView.value.label;
  if (snapshot.queuePhase === 'start') return '等待启动';
  if (snapshot.queuePhase === 'commit') return '等待提交';
  return statusView.value.label;
});
/** 当前是否只为已解析的活动 Task 计时。 */
const shouldTick = computed<boolean>(() => resolvedTask.value?.recordState === 'active' && !statusView.value.terminal);

/**
 * 停止活动 Task 近似计时器。
 */
function stopElapsedTimer(): void {
  if (elapsedTimer === undefined) return;
  clearInterval(elapsedTimer);
  elapsedTimer = undefined;
}

/**
 * 解析 ISO 时间戳。
 * @param value - ISO 时间文本
 * @returns 有效毫秒时间戳；无效时返回 undefined
 */
function parseTimestamp(value: string): number | undefined {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

/**
 * 格式化非负耗时。
 * @param durationMs - 毫秒耗时
 * @returns 简短耗时；无效时返回 undefined
 */
function formatDuration(durationMs: number): string | undefined {
  if (!Number.isFinite(durationMs) || durationMs < 0) return undefined;
  const totalSeconds = Math.floor(durationMs / 1_000);
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
}

/**
 * 格式化 tombstone 的最小更新时间。
 * @param value - ISO 时间文本
 * @returns 固定日期时间；无效时返回更新时间未知
 */
function formatTimestamp(value: string): string {
  const timestamp = parseTimestamp(value);
  if (timestamp === undefined) return '更新时间未知';
  const date = new Date(timestamp);
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 当前投影的近似或冻结耗时。 */
const elapsedText = computed<string | undefined>(() => {
  const snapshot = resolvedTask.value;
  if (snapshot?.recordState !== 'active') return undefined;
  const createdAt = parseTimestamp(snapshot.createdAt);
  if (createdAt === undefined) return undefined;
  const endAt = statusView.value.terminal ? parseTimestamp(snapshot.updatedAt) : nowMs.value;
  if (endAt === undefined) return undefined;
  const duration = formatDuration(endAt - createdAt);
  if (!duration) return undefined;
  return statusView.value.terminal ? duration : `约 ${duration}`;
});

/**
 * 校验定向返回值仍属于当前原始消息位置。
 * @param snapshot - Store 收敛后的定向响应
 * @param taskId - 请求 Task 身份
 * @returns 身份与复合位置是否完全一致
 */
function matchesPosition(snapshot: ChatAgentTaskSnapshot, taskId: string): boolean {
  return (
    snapshot.taskId === taskId &&
    snapshot.sessionId === props.sessionId &&
    snapshot.assistantMessageId === props.assistantMessageId &&
    snapshot.toolCallId === props.part.toolCallId
  );
}

/**
 * 为通用工具气泡构造 metadata-only 安全副本。
 * @param part - 原始 delegate_task Part
 * @returns 不包含原输入、输出、usage、artifact 或错误消息的副本
 */
function createSafePart(part: ChatMessageToolPart): ChatMessageToolPart {
  const safePart: ChatMessageToolPart = {
    ...(part.id ? { id: part.id } : {}),
    type: 'tool',
    toolCallId: part.toolCallId,
    toolName: 'delegate_task',
    status: part.status,
    input: {}
  };
  if (part.status !== 'done') return safePart;

  const resultStatus = readTaskResultStatus(part);
  if (resultStatus === 'success') {
    const taskId = readTaskResultId(part);
    safePart.result = {
      toolName: 'delegate_task',
      status: 'success',
      data: {
        ...(taskId ? { taskId } : {}),
        projection: 'unavailable'
      }
    };
    return safePart;
  }
  if (resultStatus === 'cancelled') {
    safePart.result = {
      toolName: 'delegate_task',
      status: 'cancelled',
      error: {
        code: 'USER_CANCELLED',
        message: 'Child Task 已取消'
      }
    };
    return safePart;
  }
  safePart.result = {
    toolName: 'delegate_task',
    status: 'failure',
    error: {
      code: 'EXECUTION_FAILED',
      message: 'Child Task 投影不可用'
    }
  };
  return safePart;
}

/** 通用 Tool fallback 使用的安全副本。 */
const safeFallbackPart = computed<ChatMessageToolPart>(() => createSafePart(props.part));

watch(
  shouldTick,
  (active: boolean): void => {
    stopElapsedTimer();
    if (!active) return;
    nowMs.value = Date.now();
    elapsedTimer = setInterval((): void => {
      nowMs.value = Date.now();
    }, 1_000);
  },
  { immediate: true }
);

watch(
  [lookupTaskId, taskIndexKey],
  async ([taskId, indexKey], _previous, onCleanup): Promise<void> => {
    const epoch = ++requestEpoch;
    let cancelled = false;
    onCleanup((): void => {
      cancelled = true;
    });

    // lookup 上下文变化后先清除旧错误，避免 Session/Tool 切换继续展示上一位置的协议状态。
    lookupError.value = null;
    if (!taskId || !indexKey || !props.sessionId) return;
    const lookupKey = `${indexKey}${taskId.length}:${taskId}`;
    if (requestedLookupKey === lookupKey) return;
    requestedLookupKey = lookupKey;
    const [requestError, snapshot] = await asyncTo(
      agentTaskStore.ensureTask(props.sessionId, taskId, {
        assistantMessageId: props.assistantMessageId,
        toolCallId: props.part.toolCallId
      })
    );
    if (cancelled || epoch !== requestEpoch) return;
    if (requestError) {
      lookupError.value = isTaskProjectionError(requestError) ? 'protocol' : 'unavailable';
      return;
    }
    if (!snapshot) {
      lookupError.value = 'unavailable';
      return;
    }
    const indexedSnapshot = agentTaskStore.findTask(props.sessionId, props.assistantMessageId, props.part.toolCallId);
    if (!matchesPosition(snapshot, taskId) || indexedSnapshot?.taskId !== taskId) {
      lookupError.value = 'protocol';
      return;
    }
    lookupError.value = null;
  },
  { immediate: true }
);

onScopeDispose((): void => {
  requestEpoch += 1;
  stopElapsedTimer();
});
</script>

<style scoped lang="less">
.b-agent-task-card,
.b-agent-task-card__protocol-error {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px dashed var(--border-primary);
  border-radius: 8px;
}

.b-agent-task-card__header,
.b-agent-task-card__meta,
.b-agent-task-card__title,
.b-agent-task-card__protocol-error {
  display: flex;
  gap: 6px;
  align-items: center;
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

.b-agent-task-card__meta {
  flex-wrap: wrap;
  margin-top: 6px;
}

.b-agent-task-card__status {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  color: var(--text-primary);
}

.b-agent-task-card__elapsed,
.b-agent-task-card__priority,
.b-agent-task-card__updated {
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

.b-agent-task-card__tombstone {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.b-agent-task-card__title {
  color: var(--text-primary);
}

.b-agent-task-card__protocol-error {
  flex-wrap: wrap;
  color: var(--color-error);
}

.b-agent-task-card__protocol-error code {
  font-family: Monaco, 'SF Mono', Consolas, monospace;
  color: var(--text-tertiary);
}
</style>
