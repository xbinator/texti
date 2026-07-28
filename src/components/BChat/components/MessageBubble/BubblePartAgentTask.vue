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
      <button :class="bem('toggle')" type="button" data-action="toggle-detail" :aria-controls="detailPanelId" :aria-expanded="expanded" @click="toggleDetail">
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
        @click="cancelTask"
      >
        {{ cancelButtonLabel }}
      </button>
    </div>
    <p v-if="cancelError" :class="bem('notice')" role="alert">
      <code>{{ cancelError }}</code>
    </p>
    <p v-if="resolvedTask.summary" :class="bem('summary')">{{ resolvedTask.summary }}</p>

    <div v-if="expanded" :id="detailPanelId" :class="bem('detail')">
      <div v-if="detailLoading" :class="bem('detail-state')" role="status">正在加载任务详情…</div>
      <div v-else-if="detailError" :class="bem('detail-state')" role="alert">
        <code>{{ detailError }}</code>
        <button type="button" data-action="retry-detail" @click="retryDetail">重试</button>
      </div>

      <template v-else-if="trustedDetail">
        <section :class="bem('section')" data-section="contract">
          <h4>任务契约</h4>
          <dl>
            <dt>模式</dt>
            <dd>{{ MODE_LABELS[trustedDetail.mode] }}</dd>
            <dt>优先级</dt>
            <dd>{{ PRIORITY_LABELS[trustedDetail.priority] }}</dd>
            <dt>必要性</dt>
            <dd>{{ trustedDetail.required ? '必需任务' : '可选任务' }}</dd>
            <dt>截止时间</dt>
            <dd>{{ trustedDetail.deadlineAt ?? '未设置' }}</dd>
          </dl>
          <ol>
            <li v-for="(criterion, index) in trustedDetail.acceptanceCriteria" :key="`${index}:${criterion}`">{{ criterion }}</li>
          </ol>
          <ul>
            <li v-for="resource in trustedDetail.resources" :key="`${resource.kind}:${resource.displayReference}`">
              <code>{{ resource.kind }}</code>
              <span>{{ resource.displayReference }}</span>
              <small v-if="resource.revision">revision {{ resource.revision }}</small>
            </li>
          </ul>
        </section>

        <section :class="bem('section')" data-section="execution">
          <h4>执行</h4>
          <template v-if="trustedDetail.currentAttempt">
            <dl>
              <dt>Attempt</dt>
              <dd>{{ trustedDetail.currentAttempt.attemptNumber }}</dd>
              <dt>状态</dt>
              <dd>{{ trustedDetail.currentAttempt.attemptState }}</dd>
              <dt>Agent</dt>
              <dd>{{ trustedDetail.currentAttempt.agentId }}</dd>
              <dt>Runtime</dt>
              <dd>{{ trustedDetail.currentAttempt.runtimeId }}</dd>
              <dt>创建</dt>
              <dd>{{ trustedDetail.currentAttempt.createdAt }}</dd>
              <dt>开始</dt>
              <dd>{{ trustedDetail.currentAttempt.startedAt ?? '尚未开始' }}</dd>
              <dt>结束</dt>
              <dd>{{ trustedDetail.currentAttempt.endedAt ?? '尚未结束' }}</dd>
            </dl>
          </template>
          <p v-else>尚无执行 Attempt</p>
        </section>

        <section :class="bem('section')" data-section="timeline">
          <h4>时间线</h4>
          <p v-if="trustedDetail.timeline.truncated" :class="bem('notice')">更早事件已截断</p>
          <ol>
            <li v-for="entry in trustedDetail.timeline.entries" :key="entry.sequence">
              <time>{{ entry.occurredAt }}</time>
              <code>{{ entry.type }}</code>
              <code>{{ entry.code }}</code>
              <span v-if="entry.summary">{{ entry.summary }}</span>
            </li>
          </ol>
        </section>

        <section :class="bem('section')" data-section="completion">
          <h4>完成与诊断</h4>
          <template v-if="trustedDetail.completion">
            <p>
              <code>{{ trustedDetail.completion.level }}</code>
              {{ trustedDetail.completion.summary }}
            </p>
            <ol>
              <li
                v-for="criterion in trustedDetail.completion.criteria"
                :key="criterion.criterionIndex"
                :class="criterion.verificationStatus === 'contradicted' ? bem('criterion', { contradicted: true }) : bem('criterion')"
              >
                <span>#{{ criterion.criterionIndex + 1 }}</span>
                <code>{{ criterion.claimStatus }}</code>
                <code>{{ criterion.verificationStatus }}</code>
                <span>{{ criterion.claimSummary }}</span>
              </li>
            </ol>
          </template>
          <p v-else>暂无完成信息</p>
          <ul v-if="trustedDetail.warnings.length > 0">
            <li v-for="warning in trustedDetail.warnings" :key="warning.code">
              <code>{{ warning.code }}</code>
              <span>{{ warning.message }}</span>
            </li>
          </ul>
          <div v-if="trustedDetail.error" :class="bem('error')" role="alert">
            <dl>
              <dt>code</dt>
              <dd>
                <code>{{ trustedDetail.error.code }}</code>
              </dd>
              <dt>phase</dt>
              <dd>
                <code>{{ trustedDetail.error.phase }}</code>
              </dd>
              <dt>category</dt>
              <dd>
                <code>{{ trustedDetail.error.category }}</code>
              </dd>
              <dt>retryable</dt>
              <dd>{{ trustedDetail.error.retryable ? '可重试' : '不可重试' }}</dd>
            </dl>
            <p v-if="trustedDetail.error.message">{{ trustedDetail.error.message }}</p>
            <dl v-if="trustedDetail.error.details">
              <template v-for="key in ERROR_DETAIL_KEYS" :key="key">
                <template v-if="trustedDetail.error.details[key] !== undefined">
                  <dt>{{ key }}</dt>
                  <dd>{{ trustedDetail.error.details[key] }}</dd>
                </template>
              </template>
            </dl>
          </div>
        </section>

        <section :class="bem('section')" data-section="usage">
          <h4>用量</h4>
          <template v-if="trustedDetail.usage">
            <dl>
              <dt>输入 token</dt>
              <dd>{{ trustedDetail.usage.inputTokens }}</dd>
              <dt>输出 token</dt>
              <dd>{{ trustedDetail.usage.outputTokens }}</dd>
              <dt>总 token</dt>
              <dd>{{ trustedDetail.usage.totalTokens }}</dd>
              <dt>模型调用</dt>
              <dd>{{ trustedDetail.usage.modelCalls }}</dd>
              <dt>工具轮次</dt>
              <dd>{{ trustedDetail.usage.toolRounds }}</dd>
              <dt>外部请求</dt>
              <dd>{{ trustedDetail.usage.externalRequests }}</dd>
              <dt>排队耗时</dt>
              <dd>{{ trustedDetail.usage.queueDurationMs }} ms</dd>
              <dt>执行耗时</dt>
              <dd>{{ trustedDetail.usage.executionDurationMs }} ms</dd>
              <dt>定价版本</dt>
              <dd>{{ trustedDetail.usage.monetaryCost.pricingVersion }}</dd>
              <dt>估算成本</dt>
              <dd>{{ formatCost(trustedDetail.usage.monetaryCost.estimated, trustedDetail.usage.monetaryCost.currency) }}</dd>
              <dt>实际成本</dt>
              <dd>{{ formatCost(trustedDetail.usage.monetaryCost.actual, trustedDetail.usage.monetaryCost.currency) }}</dd>
            </dl>
          </template>
          <p v-else>用量未知</p>
        </section>

        <section :class="bem('section')" data-section="changeset">
          <h4>变更集</h4>
          <template v-if="trustedDetail.changeset">
            <dl>
              <dt>阶段</dt>
              <dd>{{ trustedDetail.changeset.phase }}</dd>
              <dt>基础修订</dt>
              <dd>
                <code>{{ trustedDetail.changeset.baseRevision }}</code>
              </dd>
              <dt>diff</dt>
              <dd>
                <code>{{ trustedDetail.changeset.diffHash }}</code>
              </dd>
              <dt>operations</dt>
              <dd>
                <code>{{ trustedDetail.changeset.operationSetHash }}</code>
              </dd>
            </dl>
            <ul>
              <li v-for="displayPath in trustedDetail.changeset.displayPaths" :key="displayPath">{{ displayPath }}</li>
            </ul>
            <button v-if="canLocateConfirmation" type="button" data-action="open-confirmation" :disabled="confirmationBusy" @click="locateConfirmation">
              查看确认
            </button>
            <p v-if="confirmationError" :class="bem('notice')" role="alert">
              <code>{{ confirmationError }}</code>
            </p>
          </template>
          <p v-else>无变更集</p>
          <p v-if="confirmationContextError" :class="bem('notice')" role="alert">
            <code>{{ confirmationContextError }}</code>
          </p>
        </section>

        <section :class="bem('section')" data-section="artifacts">
          <h4>产物</h4>
          <ul>
            <li v-for="artifact in visibleArtifacts" :key="artifact.artifactId">
              <code>{{ artifact.kind }}</code>
              <span>{{ artifact.reference }}</span>
              <button v-if="canOpenTaskArtifact(artifact)" type="button" data-action="open-artifact" @click="openArtifact(artifact)">打开</button>
            </li>
          </ul>
          <p v-if="visibleArtifacts.length === 0">无公开产物</p>
          <p v-if="artifactError" :class="bem('notice')" role="alert">
            <code>{{ artifactError }}</code>
          </p>
        </section>
      </template>
    </div>
  </div>

  <BubblePartTool v-else :part="safeFallbackPart" />
</template>

<script setup lang="ts">
/**
 * @file BubblePartAgentTask.vue
 * @description 在原 delegate_task Tool Part 位置展示 Main-owned Child Task 轻量投影。
 */
import type { ChatMessageToolPart } from 'types/chat';
import type {
  AgentTaskMode,
  AgentTaskPriority,
  AgentTaskStatus,
  ChatAgentCancelTaskResult,
  ChatAgentTaskArtifactSnapshot,
  ChatAgentTaskDetailSnapshot,
  ChatAgentTaskErrorDetailKey,
  ChatAgentTaskEventSnapshot,
  ChatAgentTaskSnapshot,
  ChatAgentTaskSummarySnapshot
} from 'types/chat-agent';
import { computed, onScopeDispose, ref, watch } from 'vue';
import { canOpenArtifact, openAgentArtifact } from '@/components/BChat/utils/agentArtifact';
import { readTaskResultId, readTaskResultStatus } from '@/components/BChat/utils/agentTaskPart';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { createTaskIndexKey, isTaskProjectionError, useChatAgentTaskStore } from '@/stores/chat/agentTask';
import { useChatConfirmationQueueStore, type ChatAgentConfirmationItem } from '@/stores/chat/confirmationQueue';
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
const confirmationQueue = useChatConfirmationQueueStore();

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

/** 错误 details 的固定展示顺序与闭集。 */
const ERROR_DETAIL_KEYS: readonly ChatAgentTaskErrorDetailKey[] = [
  'reason',
  'toolName',
  'expectedHash',
  'actualHash',
  'expectedVersion',
  'actualVersion',
  'status',
  'limit',
  'observed',
  'deadlineAt'
];

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
/** 详情区域是否展开。 */
const expanded = ref(false);
/** 详情请求是否进行中。 */
const detailLoading = ref(false);
/** 详情加载的稳定本地错误。 */
const detailError = ref<string | null>(null);
/** 确认定位是否进行中。 */
const confirmationBusy = ref(false);
/** 确认定位的稳定本地错误。 */
const confirmationError = ref<string | null>(null);
/** artifact 打开的稳定本地错误。 */
const artifactError = ref<string | null>(null);
/** 单 Task 取消请求是否进行中。 */
const cancelBusy = ref(false);
/** 单 Task 取消的稳定本地错误。 */
const cancelError = ref<string | null>(null);
/** 详情请求 epoch，阻止收起或身份切换后的迟到响应改写局部状态。 */
let detailEpoch = 0;
/** 确认定位 epoch，阻止身份或 Detail 更新后的迟到恢复定位。 */
let confirmationEpoch = 0;
/** artifact 导航 epoch，阻止收起或身份更新后的迟到失败污染当前卡片。 */
let artifactEpoch = 0;
/** 取消身份 epoch，阻止旧 Task 响应污染当前卡片。 */
let cancelEpoch = 0;

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

/**
 * 校验 Detail 与当前轻量 Summary 的全部展示身份及 sequence。
 * @param detail - Store 中的候选 Detail
 * @param summary - 当前原位置 Summary
 * @returns Detail 是否仍可信
 */
function matchesDetail(detail: ChatAgentTaskDetailSnapshot, summary: ChatAgentTaskSummarySnapshot): boolean {
  return (
    detail.taskId === summary.taskId &&
    detail.sessionId === summary.sessionId &&
    detail.turnId === summary.turnId &&
    detail.checkpointId === summary.checkpointId &&
    detail.assistantMessageId === summary.assistantMessageId &&
    detail.toolCallId === summary.toolCallId &&
    detail.agentId === summary.agentId &&
    detail.taskSequence === summary.taskSequence
  );
}

/**
 * 判断完整性或定位字段是否为非空白字符串。
 * @param value - 待校验公开字段
 * @returns 是否可以参与精确身份比较
 */
function isNonBlank(value: string): boolean {
  return value.trim().length > 0;
}

/** 卡片可展示的 Task；Result 只做一致性交叉验证，不能直接取 tasksById。 */
const resolvedTask = computed<ChatAgentTaskEventSnapshot | undefined>(() => {
  if (identityConflict.value) return undefined;
  const snapshot = indexedTask.value;
  if (!snapshot) return undefined;
  if (resultTaskId.value && resultTaskId.value !== snapshot.taskId) return undefined;
  return snapshot;
});
/** 当前 Summary 和 Store Detail 同 sequence、同原位置时的可信 Detail。 */
const trustedDetail = computed<ChatAgentTaskDetailSnapshot | undefined>(() => {
  const summary = resolvedTask.value;
  if (summary?.recordState !== 'active') return undefined;
  const detail = agentTaskStore.detailsById[summary.taskId];
  return detail && matchesDetail(detail, summary) ? detail : undefined;
});
/** 当前卡片详情 DOM 身份。 */
const detailPanelId = computed<string>(() => `agent-task-detail-${props.assistantMessageId}-${props.part.toolCallId}`);
/** 当前 Task 不含 sequence 的渲染身份。 */
const detailIdentityKey = computed<string>(() => {
  const summary = resolvedTask.value;
  if (summary?.recordState !== 'active') return '';
  return createTaskIndexKey(summary.sessionId, summary.assistantMessageId, summary.toolCallId) + summary.taskId;
});
/** 当前 Task sequence。 */
const detailSequence = computed<number | undefined>(() => {
  const summary = resolvedTask.value;
  return summary?.recordState === 'active' ? summary.taskSequence : undefined;
});
/** 当前可信 artifact；ownership 必须完整绑定当前 Task、Actor 和 Attempt。 */
const visibleArtifacts = computed<ChatAgentTaskArtifactSnapshot[]>(() => {
  const detail = trustedDetail.value;
  const attempt = detail?.currentAttempt;
  if (!detail || !attempt) return [];
  return detail.artifacts.filter(
    (artifact): boolean =>
      artifact.visibility === 'user' &&
      attempt.agentId === detail.agentId &&
      artifact.owner.taskId === detail.taskId &&
      artifact.owner.agentId === detail.agentId &&
      artifact.owner.attemptId === attempt.attemptId
  );
});
/** waiting_confirmation 缺失 Attempt、changeset 或定位身份时的稳定协议错误。 */
const confirmationContextError = computed<string | null>(() => {
  const detail = trustedDetail.value;
  if (detail?.status !== 'waiting_confirmation') return null;
  const attempt = detail.currentAttempt;
  if (!attempt || !detail.changeset) return 'agent_confirmation_context_invalid';
  const locatorIdentities = [detail.sessionId, detail.taskId, detail.agentId, detail.toolCallId, attempt.attemptId, attempt.agentId, attempt.runtimeId];
  return locatorIdentities.every(isNonBlank) && attempt.agentId === detail.agentId ? null : 'agent_confirmation_context_invalid';
});
/** waiting_confirmation 只有携带当前 Attempt 与 changeset 时才允许定位。 */
const canLocateConfirmation = computed<boolean>(() => {
  const detail = trustedDetail.value;
  return Boolean(detail?.status === 'waiting_confirmation' && !confirmationContextError.value);
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
/** 当前非终态 Task 是否显示取消操作。 */
const canCancelTask = computed<boolean>(() => resolvedTask.value?.recordState === 'active' && !statusView.value.terminal);
/** committing 仅记录意图，文案不得暗示已中止提交。 */
const cancelButtonLabel = computed<string>(() => {
  const snapshot = resolvedTask.value;
  if (snapshot?.recordState === 'active' && snapshot.status === 'committing') return '请求取消';
  return cancelBusy.value ? '正在取消…' : '取消任务';
});

/**
 * 校验取消响应仍属于点击时的原消息位置与 Task 身份。
 * @param baseline - 点击时 Summary
 * @param result - Main 返回的权威结果
 * @returns 身份和 sequence 是否可信
 */
function matchesCancelResult(baseline: ChatAgentTaskSummarySnapshot, result: ChatAgentCancelTaskResult): boolean {
  const updated = result.task;
  return (
    updated.recordState === 'active' &&
    updated.taskId === baseline.taskId &&
    updated.sessionId === baseline.sessionId &&
    updated.turnId === baseline.turnId &&
    updated.checkpointId === baseline.checkpointId &&
    updated.assistantMessageId === baseline.assistantMessageId &&
    updated.toolCallId === baseline.toolCallId &&
    updated.agentId === baseline.agentId &&
    updated.taskSequence >= baseline.taskSequence
  );
}

/**
 * 请求 Main 取消当前 Task，仅应用响应中的权威 Summary。
 */
async function cancelTask(): Promise<void> {
  const baseline = resolvedTask.value;
  if (cancelBusy.value || baseline?.recordState !== 'active' || statusView.value.terminal || baseline.cancellation) return;
  const epoch = ++cancelEpoch;
  cancelBusy.value = true;
  cancelError.value = null;
  const [requestError, response] = await asyncTo(
    Promise.resolve().then(() => getElectronAPI().chatAgentCancelTask({ sessionId: baseline.sessionId, taskId: baseline.taskId }))
  );
  const current = resolvedTask.value;
  if (
    epoch !== cancelEpoch ||
    current?.recordState !== 'active' ||
    current.taskId !== baseline.taskId ||
    current.sessionId !== baseline.sessionId ||
    current.turnId !== baseline.turnId ||
    current.checkpointId !== baseline.checkpointId ||
    current.assistantMessageId !== baseline.assistantMessageId ||
    current.toolCallId !== baseline.toolCallId ||
    current.agentId !== baseline.agentId
  ) {
    return;
  }
  cancelBusy.value = false;
  if (requestError || !response?.ok) {
    cancelError.value = 'agent_task_cancel_failed';
    return;
  }
  if (!matchesCancelResult(baseline, response.data)) {
    cancelError.value = 'agent_task_cancel_projection_invalid';
    return;
  }
  const outcome = agentTaskStore.applySummary(response.data.task);
  if (outcome !== 'applied' && outcome !== 'stale') cancelError.value = 'agent_task_cancel_projection_invalid';
}

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
 * 按需加载当前 Task Detail。
 * sequence 在 flight 期间更新时只允许一次有界 follow-up。
 * @param allowFollowup - 是否允许 sequence 变化后再查询一次
 */
async function loadTaskDetail(allowFollowup = true): Promise<void> {
  const summary = resolvedTask.value;
  if (!expanded.value || summary?.recordState !== 'active' || !props.sessionId || trustedDetail.value) return;
  const epoch = detailEpoch;
  const requestedSequence = summary.taskSequence;
  detailLoading.value = true;
  detailError.value = null;
  const [requestError] = await asyncTo(
    agentTaskStore.ensureTask(props.sessionId, summary.taskId, {
      assistantMessageId: props.assistantMessageId,
      toolCallId: props.part.toolCallId
    })
  );
  if (epoch !== detailEpoch || !expanded.value) return;
  detailLoading.value = false;
  if (requestError) {
    detailError.value = isTaskProjectionError(requestError) ? 'agent_task_projection_invalid' : 'agent_task_detail_unavailable';
    return;
  }
  if (trustedDetail.value) return;
  const current = resolvedTask.value;
  if (allowFollowup && current?.recordState === 'active' && current.taskId === summary.taskId && current.taskSequence !== requestedSequence) {
    await loadTaskDetail(false);
    return;
  }
  detailError.value = 'agent_task_detail_unavailable';
}

/**
 * 切换 Detail 展开状态。
 */
function toggleDetail(): void {
  expanded.value = !expanded.value;
  artifactEpoch += 1;
  detailError.value = null;
  confirmationError.value = null;
  artifactError.value = null;
  if (!expanded.value) {
    detailEpoch += 1;
    confirmationEpoch += 1;
    detailLoading.value = false;
    confirmationBusy.value = false;
    return;
  }
  loadTaskDetail();
}

/**
 * 重试当前 Detail 请求。
 */
function retryDetail(): void {
  detailEpoch += 1;
  loadTaskDetail();
}

/**
 * 格式化 monetary cost，不把 unknown 伪装为零。
 * @param amount - 成本数值或 unknown
 * @param currency - 货币代码或 unknown
 * @returns 用户可读成本
 */
function formatCost(amount: number | 'unknown', currency: string | 'unknown'): string {
  if (amount === 'unknown' || currency === 'unknown') return '未知';
  return `${currency} ${amount}`;
}

/**
 * 判断 artifact 是否允许在当前终态 Task 上打开。
 * @param artifact - 当前可信公开 artifact
 * @returns Task 状态与闭集 opener 是否同时允许
 */
function canOpenTaskArtifact(artifact: ChatAgentTaskArtifactSnapshot): boolean {
  return trustedDetail.value?.status === 'completed' && canOpenArtifact(artifact);
}

/**
 * 校验 confirmation 与当前 Detail changeset 的身份和完整性绑定。
 * @param confirmation - 精确 Task/Attempt 匹配的 confirmation
 * @param detail - 当前可信 Detail
 * @returns 是否可安全定位
 */
function hasChangeIntegrity(confirmation: ChatAgentConfirmationItem, detail: ChatAgentTaskDetailSnapshot): boolean {
  const attempt = detail.currentAttempt;
  const { changeset } = detail;
  if (!attempt || !changeset) return false;
  const requiredValues = [
    detail.sessionId,
    detail.taskId,
    detail.agentId,
    detail.toolCallId,
    attempt.attemptId,
    attempt.agentId,
    attempt.runtimeId,
    changeset.changesetId,
    changeset.baseRevision,
    changeset.diffHash,
    changeset.operationSetHash,
    confirmation.confirmationId,
    confirmation.snapshot.confirmationId,
    confirmation.snapshot.sessionId,
    confirmation.snapshot.taskId,
    confirmation.snapshot.attemptId,
    confirmation.snapshot.agentId,
    confirmation.snapshot.runtimeId,
    confirmation.snapshot.toolCallId,
    confirmation.snapshot.changesetId,
    confirmation.snapshot.baseRevision,
    confirmation.snapshot.diffHash,
    confirmation.snapshot.operationSetHash
  ];
  return (
    requiredValues.every(isNonBlank) &&
    attempt.agentId === detail.agentId &&
    confirmation.confirmationId === confirmation.snapshot.confirmationId &&
    confirmation.snapshot.sessionId === detail.sessionId &&
    confirmation.snapshot.taskId === detail.taskId &&
    confirmation.snapshot.attemptId === attempt.attemptId &&
    confirmation.snapshot.agentId === detail.agentId &&
    confirmation.snapshot.runtimeId === attempt.runtimeId &&
    confirmation.snapshot.toolCallId === detail.toolCallId &&
    confirmation.snapshot.changesetId === changeset.changesetId &&
    confirmation.snapshot.baseRevision === changeset.baseRevision &&
    confirmation.snapshot.diffHash === changeset.diffHash &&
    confirmation.snapshot.operationSetHash === changeset.operationSetHash
  );
}

/**
 * 定位当前 waiting_confirmation 对应的唯一持久化确认。
 */
async function locateConfirmation(): Promise<void> {
  if (confirmationBusy.value) return;
  const detail = trustedDetail.value;
  const attempt = detail?.currentAttempt;
  if (!detail || detail.status !== 'waiting_confirmation' || !attempt || !detail.changeset) return;
  const epoch = ++confirmationEpoch;
  const sequence = detail.taskSequence;
  confirmationBusy.value = true;
  confirmationError.value = null;
  let matches = confirmationQueue.findAgent(detail.sessionId, detail.taskId, attempt.attemptId);
  if (matches.length === 0) {
    const [recoveryError] = await asyncTo(confirmationQueue.recoverAgent());
    if (epoch !== confirmationEpoch) return;
    if (recoveryError) {
      confirmationBusy.value = false;
      confirmationError.value = 'agent_confirmation_recovery_failed';
      return;
    }
    const currentDetail = trustedDetail.value;
    if (
      !currentDetail ||
      currentDetail.taskSequence !== sequence ||
      currentDetail.status !== 'waiting_confirmation' ||
      currentDetail.currentAttempt?.attemptId !== attempt.attemptId ||
      currentDetail.changeset?.changesetId !== detail.changeset.changesetId
    ) {
      confirmationBusy.value = false;
      confirmationError.value = 'agent_confirmation_stale';
      return;
    }
    matches = confirmationQueue.findAgent(currentDetail.sessionId, currentDetail.taskId, currentDetail.currentAttempt.attemptId);
  }
  if (epoch !== confirmationEpoch) return;
  confirmationBusy.value = false;
  if (matches.length === 0) {
    confirmationError.value = 'agent_confirmation_missing';
    return;
  }
  if (matches.length > 1) {
    confirmationError.value = 'agent_confirmation_ambiguous';
    return;
  }
  const confirmation = matches[0];
  const currentDetail = trustedDetail.value;
  if (!confirmation || !currentDetail || !hasChangeIntegrity(confirmation, currentDetail)) {
    confirmationError.value = 'agent_confirmation_integrity_invalid';
    return;
  }
  confirmationQueue.select(confirmation.confirmationId);
}

/**
 * 打开经过 ownership 和闭集 opener 双重约束的 artifact。
 * @param artifact - 当前可信 Detail 的公开 artifact
 */
async function openArtifact(artifact: ChatAgentTaskArtifactSnapshot): Promise<void> {
  const epoch = ++artifactEpoch;
  const detail = trustedDetail.value;
  if (!detail || detail.status !== 'completed' || !visibleArtifacts.value.some((candidate): boolean => candidate.artifactId === artifact.artifactId)) return;
  artifactError.value = null;
  const [openError] = await asyncTo(openAgentArtifact(artifact));
  if (epoch !== artifactEpoch || !expanded.value || trustedDetail.value?.taskId !== detail.taskId || trustedDetail.value.taskSequence !== detail.taskSequence) {
    return;
  }
  if (openError) artifactError.value = 'agent_artifact_open_failed';
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

watch(detailIdentityKey, (): void => {
  detailEpoch += 1;
  confirmationEpoch += 1;
  artifactEpoch += 1;
  cancelEpoch += 1;
  expanded.value = false;
  detailLoading.value = false;
  detailError.value = null;
  confirmationBusy.value = false;
  confirmationError.value = null;
  artifactError.value = null;
  cancelBusy.value = false;
  cancelError.value = null;
});

watch(detailSequence, (): void => {
  confirmationEpoch += 1;
  artifactEpoch += 1;
  confirmationBusy.value = false;
  confirmationError.value = null;
  artifactError.value = null;
  if (expanded.value && !detailLoading.value && !trustedDetail.value) loadTaskDetail();
});

onScopeDispose((): void => {
  requestEpoch += 1;
  detailEpoch += 1;
  confirmationEpoch += 1;
  artifactEpoch += 1;
  cancelEpoch += 1;
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

.b-agent-task-card__detail {
  padding-top: 8px;
  margin-top: 8px;
  border-top: 1px solid var(--border-primary);
}

.b-agent-task-card__detail-state,
.b-agent-task-card__notice {
  color: var(--text-tertiary);
}

.b-agent-task-card__section + .b-agent-task-card__section {
  margin-top: 10px;
}

.b-agent-task-card__section h4 {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--text-primary);
}

.b-agent-task-card__section p,
.b-agent-task-card__section ol,
.b-agent-task-card__section ul,
.b-agent-task-card__section dl {
  margin: 4px 0 0;
}

.b-agent-task-card__section ol,
.b-agent-task-card__section ul {
  padding-left: 18px;
}

.b-agent-task-card__section li {
  margin-top: 3px;
}

.b-agent-task-card__section dl {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 3px 8px;
}

.b-agent-task-card__section dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.b-agent-task-card__criterion--contradicted,
.b-agent-task-card__error {
  color: var(--color-error);
}
</style>
