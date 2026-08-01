<!--
  @file AgentTaskProjectionNotice.vue
  @description 为当前 Session 展示 Child Task 投影过期或版本不兼容提示。
-->
<template>
  <div v-if="noticeCode" :class="name" data-agent-task-projection-notice role="status">
    <BIcon icon="lucide:refresh-cw-off" :size="14" />
    <span>{{ noticeMessage }}</span>
    <code>{{ noticeCode }}</code>
    <button type="button" data-action="retry-agent-tasks" :disabled="retryBusy" @click="retryProjection">
      {{ retryBusy ? '正在重新加载…' : '重新加载' }}
    </button>
    <code v-if="retryError" role="alert">{{ retryError }}</code>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useChatAgentTaskStore } from '@/stores/chat/agentTask';
import { asyncTo } from '@/utils/asyncTo';
import { createNamespace } from '@/utils/namespace';

/**
 * Session 级 Task 投影提示参数。
 */
interface Props {
  /** 当前权威 Session；没有会话时不显示。 */
  sessionId: string | null;
}

const [name] = createNamespace('agent-task-projection-notice');
const props = defineProps<Props>();
/** 应用级 Main-owned Task 投影。 */
const agentTaskStore = useChatAgentTaskStore();
/** 显式恢复请求是否仍在执行。 */
const retryBusy = ref<boolean>(false);
/** 只展示稳定本地机器码的恢复错误。 */
const retryError = ref<string | null>(null);
/** 当前提示机器码；不兼容优先于过期。 */
const noticeCode = computed<string | null>(() => {
  const { sessionId } = props;
  if (!sessionId) return null;
  if (agentTaskStore.incompatibleSessions[sessionId]) return 'agent_task_projection_incompatible';
  if (agentTaskStore.staleSessions[sessionId]) return 'agent_task_projection_stale';
  return null;
});
/** 当前提示的简短用户说明。 */
const noticeMessage = computed<string>(() => {
  return noticeCode.value === 'agent_task_projection_incompatible' ? 'Child 任务卡片版本不兼容。' : 'Child 任务状态可能不是最新。';
});

/**
 * 显式强制恢复当前 Session，不提前清除最后可信投影。
 */
async function retryProjection(): Promise<void> {
  const { sessionId } = props;
  if (!sessionId || retryBusy.value) return;
  retryBusy.value = true;
  retryError.value = null;
  const [requestError] = await asyncTo(agentTaskStore.ensureSession(sessionId, { force: true }));
  // 旧 Session 的迟到响应不能覆盖 watch 已清理的新 Session 提示状态。
  if (props.sessionId !== sessionId) {
    retryBusy.value = false;
    return;
  }
  if (requestError || agentTaskStore.staleSessions[sessionId] || agentTaskStore.incompatibleSessions[sessionId]) {
    retryError.value = 'agent_task_projection_retry_failed';
  }
  retryBusy.value = false;
}

watch(
  (): string | null => props.sessionId,
  (): void => {
    retryBusy.value = false;
    retryError.value = null;
  }
);
</script>

<style lang="less" scoped>
.b-agent-task-projection-notice {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 6px 10px;
  margin: 0 12px 6px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: var(--surface-border-width) solid var(--border-color);
  border-radius: var(--surface-radius);
}

.b-agent-task-projection-notice button {
  padding: 2px 6px;
  margin-left: auto;
  color: var(--text-primary);
  cursor: pointer;
  background: transparent;
  border: var(--control-border-width) solid var(--border-color);
  border-radius: var(--control-radius);
}

.b-agent-task-projection-notice button:disabled {
  cursor: wait;
  opacity: 0.6;
}
</style>
