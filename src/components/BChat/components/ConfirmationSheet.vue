<template>
  <div v-if="confirmation" class="confirm-bottom-sheet">
    <div class="confirm-bottom-sheet__title">
      <BIcon :icon="riskLevel === 'dangerous' ? 'lucide:triangle-alert' : 'lucide:shield-check'" :size="14" />
      <span>{{ title }}</span>
      <BIcon :icon="isCollapsed ? 'lucide:chevron-down' : 'lucide:chevron-up'" :size="14" class="confirm-bottom-sheet__chevron" @click="toggleCollapse" />
    </div>

    <div v-show="!isCollapsed" class="confirm-bottom-sheet__body">
      <template v-if="agentSnapshot">
        <div class="confirm-bottom-sheet__description">
          Child Task <code>{{ agentSnapshot.taskId }}</code
          >（Session <code>{{ agentSnapshot.sessionId }}</code
          >，Agent <code>{{ agentSnapshot.agentId }}</code
          >）请求应用 {{ agentSnapshot.displayPaths.length }} 个文件变更，风险级别为 {{ agentSnapshot.riskLevel }}。
        </div>

        <div class="confirm-bottom-sheet__metadata">
          <div class="confirm-bottom-sheet__label">目标文件</div>
          <code v-for="displayPath in agentSnapshot.displayPaths" :key="displayPath">{{ displayPath }}</code>
          <div class="confirm-bottom-sheet__label">资源范围</div>
          <code v-for="resourceScope in agentSnapshot.resourceScopes" :key="resourceScope">{{ resourceScope }}</code>
        </div>

        <div class="confirm-bottom-sheet__preview">
          <div class="confirm-bottom-sheet__label">Unified diff</div>
          <pre class="confirm-bottom-sheet__code confirm-bottom-sheet__code--diff">{{ agentSnapshot.unifiedDiff }}</pre>
        </div>

        <div class="confirm-bottom-sheet__fingerprints">
          <span v-for="fingerprint in fingerprints" :key="fingerprint.label" :title="fingerprint.value">
            {{ fingerprint.label }} <code>{{ fingerprint.shortValue }}</code>
          </span>
        </div>
      </template>

      <template v-else-if="runtimeRequest">
        <div class="confirm-bottom-sheet__description" v-html="description"></div>

        <div v-if="runtimeRequest.beforeText" class="confirm-bottom-sheet__preview">
          <div class="confirm-bottom-sheet__label">原内容</div>
          <pre class="confirm-bottom-sheet__code">{{ truncatePreview(runtimeRequest.beforeText) }}</pre>
        </div>
        <div v-if="runtimeRequest.afterText" class="confirm-bottom-sheet__preview">
          <div class="confirm-bottom-sheet__label">{{ runtimeRequest.toolName === 'edit_file' ? '替换为' : '新内容' }}</div>
          <pre class="confirm-bottom-sheet__code">{{ truncatePreview(runtimeRequest.afterText) }}</pre>
        </div>
      </template>

      <div class="confirm-bottom-sheet__actions">
        <BButton size="small" @click="handleAction('approve')">应用</BButton>
        <BButton
          v-if="runtimeRequest?.allowRemember && runtimeRequest.rememberScopes?.includes('session')"
          size="small"
          type="secondary"
          @click="handleAction('approve-session')"
        >
          本会话允许
        </BButton>
        <BButton
          v-if="runtimeRequest?.allowRemember && runtimeRequest.rememberScopes?.includes('always')"
          size="small"
          type="secondary"
          @click="handleAction('approve-always')"
        >
          始终允许
        </BButton>
        <BButton size="small" type="text" @click="handleAction('cancel')">{{ agentSnapshot ? '拒绝' : '取消' }}</BButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file ConfirmationSheet.vue
 * @description 统一展示 Runtime 临时确认与 Child Agent 持久化 changeset 确认。
 */
import type { ChatMessageConfirmationAction } from 'types/chat';
import type { ChatAgentConfirmationSnapshot } from 'types/chat-agent';
import { computed, ref } from 'vue';
import { escape } from 'lodash-es';
import type { AIToolConfirmationRequest } from '@/ai/tools/confirmation';
import type { ChatConfirmationQueueItem } from '@/stores/chat/confirmationQueue';

defineOptions({ name: 'ConfirmationSheet' });

/** ConfirmationSheet 输入。 */
interface Props {
  /** 应用级当前 confirmation，为 null 时不渲染。 */
  confirmation: ChatConfirmationQueueItem | null;
}

/** 可复制的完整性短指纹。 */
interface ConfirmationFingerprint {
  /** 指纹标签。 */
  label: string;
  /** 完整 hash，保存在 title 且可通过文本选择复制。 */
  value: string;
  /** 展示用十二字符短指纹。 */
  shortValue: string;
}

/** ConfirmationSheet 绑定实际展示项的操作事件。 */
export interface ConfirmationSheetActionPayload {
  /** 用户确认操作。 */
  readonly action: ChatMessageConfirmationAction;
  /** 点击时实际展示的 confirmation 身份。 */
  readonly confirmationId: string;
  /** 点击时实际展示的 owner 域。 */
  readonly source: ChatConfirmationQueueItem['source'];
  /** Agent confirmation 点击时观察到的 CAS 版本。 */
  readonly expectedVersion?: number;
}

const props = withDefaults(defineProps<Props>(), {});

const emit = defineEmits<{
  (e: 'action', payload: ConfirmationSheetActionPayload): void;
}>();

/** 内容区域是否折叠。 */
const isCollapsed = ref(false);

/** 当前 Runtime 临时请求。 */
const runtimeRequest = computed<AIToolConfirmationRequest | null>((): AIToolConfirmationRequest | null => {
  return props.confirmation?.source === 'runtime' ? props.confirmation.request : null;
});

/** 当前 Child Agent confirmation 权威投影。 */
const agentSnapshot = computed<ChatAgentConfirmationSnapshot | null>((): ChatAgentConfirmationSnapshot | null => {
  return props.confirmation?.source === 'agent' ? props.confirmation.snapshot : null;
});

/** 当前确认标题。 */
const title = computed<string>((): string => runtimeRequest.value?.title ?? 'Child Agent 变更确认');

/** 当前风险等级。 */
const riskLevel = computed<'read' | 'write' | 'dangerous'>((): 'read' | 'write' | 'dangerous' => {
  return runtimeRequest.value?.riskLevel ?? agentSnapshot.value?.riskLevel ?? 'write';
});

/** Runtime 描述的安全 HTML。 */
const description = computed<string>((): string => {
  const raw = runtimeRequest.value?.description?.trim() || '';
  if (!raw) return '';
  return escape(raw).replace(/\n/g, '<br>');
});

/** Agent changeset 的完整性短指纹。 */
const fingerprints = computed<ConfirmationFingerprint[]>((): ConfirmationFingerprint[] => {
  const snapshot = agentSnapshot.value;
  if (!snapshot) return [];
  return [
    { label: 'base', value: snapshot.baseRevision, shortValue: snapshot.baseRevision.slice(0, 12) },
    { label: 'diff', value: snapshot.diffHash, shortValue: snapshot.diffHash.slice(0, 12) },
    { label: 'ops', value: snapshot.operationSetHash, shortValue: snapshot.operationSetHash.slice(0, 12) },
    { label: 'plan', value: snapshot.planHash, shortValue: snapshot.planHash.slice(0, 12) }
  ];
});

/** Runtime 文本预览最大字符数。 */
const PREVIEW_MAX_LENGTH = 800;

/**
 * 切换内容区域折叠状态。
 */
function toggleCollapse(): void {
  isCollapsed.value = !isCollapsed.value;
}

/**
 * 截断普通 Runtime 预览文本。
 * Agent unified diff 已由 Main 限制为 256 KiB，必须完整展示。
 * @param text - 原始文本
 * @returns 截断后的预览
 */
function truncatePreview(text: string): string {
  if (text.length <= PREVIEW_MAX_LENGTH) return text;
  return `${text.slice(0, PREVIEW_MAX_LENGTH)}\n...`;
}

/**
 * 处理用户操作并触发事件。
 * @param action - 确认操作类型
 */
function handleAction(action: ChatMessageConfirmationAction): void {
  const { confirmation } = props;
  if (!confirmation) return;
  emit('action', {
    action,
    confirmationId: confirmation.confirmationId,
    source: confirmation.source,
    ...(confirmation.source === 'agent' ? { expectedVersion: confirmation.snapshot.version } : {})
  });
}
</script>

<style scoped lang="less">
.confirm-bottom-sheet {
  padding: 10px 12px;
  margin-top: -6px;
  pointer-events: auto;
  user-select: text;
  background: var(--bg-secondary);
  border: var(--surface-border-width) solid var(--border-primary);
  border-radius: var(--surface-radius);
}

.confirm-bottom-sheet__title {
  display: flex;
  gap: 6px;
  align-items: center;
  font-weight: 600;
  color: var(--text-primary);
}

.confirm-bottom-sheet__chevron {
  margin-left: auto;
  cursor: pointer;
}

.confirm-bottom-sheet__description {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.confirm-bottom-sheet__description code,
.confirm-bottom-sheet__metadata code,
.confirm-bottom-sheet__fingerprints code {
  font-family: var(--font-mono);
}

.confirm-bottom-sheet__metadata {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 4px 8px;
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-secondary);
}

.confirm-bottom-sheet__metadata code {
  overflow-wrap: anywhere;
}

.confirm-bottom-sheet__preview {
  margin-top: 8px;
}

.confirm-bottom-sheet__label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
}

.confirm-bottom-sheet__code {
  max-height: 120px;
  padding: 8px;
  margin: 0;
  margin-top: 4px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  background: var(--bg-primary);
  border-radius: var(--control-radius);
}

.confirm-bottom-sheet__code--diff {
  max-height: 240px;
}

.confirm-bottom-sheet__fingerprints {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-secondary);
}

.confirm-bottom-sheet__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
</style>
