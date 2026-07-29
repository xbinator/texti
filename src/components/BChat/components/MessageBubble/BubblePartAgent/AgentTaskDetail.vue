<template>
  <div v-if="expanded" :id="detailPanelId" :class="bem('detail')">
    <div v-if="detailLoading" :class="bem('detail-state')" role="status">正在加载任务详情…</div>
    <div v-else-if="detailError" :class="bem('detail-state')" role="alert">
      <code>{{ detailError }}</code>
      <button type="button" data-action="retry-detail" @click="emit('retry-detail')">重试</button>
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
          <button v-if="canLocateConfirmation" type="button" data-action="open-confirmation" :disabled="confirmationBusy" @click="emit('locate-confirmation')">
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
            <button type="button" data-action="open-artifact" @click="emit('open-artifact', artifact)">打开</button>
          </li>
        </ul>
        <p v-if="visibleArtifacts.length === 0">无公开产物</p>
        <p v-if="artifactError" :class="bem('notice')" role="alert">
          <code>{{ artifactError }}</code>
        </p>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * @file AgentTaskDetail.vue
 * @description Agent Task 卡片的详情展开区域，展示契约、执行、时间线、完成诊断、用量、变更集与产物。
 */
import type {
  AgentTaskMode,
  AgentTaskPriority,
  ChatAgentTaskArtifactSnapshot,
  ChatAgentTaskDetailSnapshot,
  ChatAgentTaskErrorDetailKey
} from 'types/chat-agent';
import { createNamespace } from '@/utils/namespace';

/** Agent Task Detail 属性。 */
interface Props {
  /** 详情区域是否展开。 */
  expanded: boolean;
  /** 详情面板 DOM ID。 */
  detailPanelId: string;
  /** 详情请求是否进行中。 */
  detailLoading: boolean;
  /** 详情加载的稳定本地错误。 */
  detailError: string | null;
  /** 当前可信的完整 Task Detail。 */
  trustedDetail: ChatAgentTaskDetailSnapshot | undefined;
  /** 当前可见的公开 artifact 列表。 */
  visibleArtifacts: ChatAgentTaskArtifactSnapshot[];
  /** waiting_confirmation 上下文是否完整。 */
  confirmationContextError: string | null;
  /** 是否允许定位确认。 */
  canLocateConfirmation: boolean;
  /** 确认定位是否进行中。 */
  confirmationBusy: boolean;
  /** 确认定位的稳定本地错误。 */
  confirmationError: string | null;
  /** artifact 打开的稳定本地错误。 */
  artifactError: string | null;
}

/** Detail 事件定义。 */
interface Emits {
  /** 重试详情请求。 */
  (event: 'retry-detail'): void;
  /** 定位并选中当前确认。 */
  (event: 'locate-confirmation'): void;
  /** 打开指定 artifact。 */
  (event: 'open-artifact', artifact: ChatAgentTaskArtifactSnapshot): void;
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
</script>

<style scoped lang="less">
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
