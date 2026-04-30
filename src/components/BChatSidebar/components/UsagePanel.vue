<!--
  @file UsagePanel.vue
  @description 聊天侧边栏的持久化会话用量摘要面板。
-->
<template>
  <section class="usage-panel">
    <div class="usage-panel__header">
      <span class="usage-panel__title">TOKEN 用量</span>
      <BButton type="text" size="small" class="usage-panel__close" @click="onClose"> 关闭 </BButton>
    </div>

    <div class="usage-panel__body">
      <div v-if="loading" data-testid="usage-panel-loading" class="usage-panel__state usage-panel__state--loading">
        <div class="usage-panel__spinner" aria-hidden="true"></div>
        <div class="usage-panel__state-text">加载用量中...</div>
      </div>

      <div v-else-if="error" data-testid="usage-panel-error" class="usage-panel__state usage-panel__state--error">
        <div class="usage-panel__state-text">加载用量失败</div>
        <div class="usage-panel__detail">{{ error }}</div>
      </div>

      <div v-else-if="usage" data-testid="usage-panel-data" class="usage-panel__content">
        <div class="usage-panel__summary">
          <div class="usage-panel__total">
            <div class="usage-panel__total-value">{{ formatTokens(usage.totalTokens) }}</div>
            <div class="usage-panel__total-label">本次会话合计</div>
          </div>

          <div class="usage-panel__stats">
            <div class="usage-panel__stat">
              <span class="usage-panel__dot usage-panel__dot--input"></span>
              <span class="usage-panel__stat-label">输入</span>
              <span class="usage-panel__stat-value">{{ formatTokens(usage.inputTokens) }}</span>
            </div>
            <div class="usage-panel__stat">
              <span class="usage-panel__dot usage-panel__dot--output"></span>
              <span class="usage-panel__stat-label">输出</span>
              <span class="usage-panel__stat-value">{{ formatTokens(usage.outputTokens) }}</span>
            </div>
          </div>
        </div>

        <div class="usage-panel__progress">
          <div class="usage-panel__progress-bar usage-panel__progress-bar--input" :style="{ width: inputPercent + '%' }"></div>
          <div class="usage-panel__progress-bar usage-panel__progress-bar--output" :style="{ width: outputPercent + '%' }"></div>
        </div>
      </div>

      <div v-else data-testid="usage-panel-empty" class="usage-panel__state usage-panel__state--empty">
        <div class="usage-panel__state-text">暂无持久化用量</div>
        <div class="usage-panel__detail">请先发送消息，然后再次打开 /usage。</div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { AIUsage } from 'types/ai';
import { computed } from 'vue';

/**
 * 用量面板属性。
 */
interface UsagePanelProps {
  /** 侧边栏是否正在从存储中加载用量数据。 */
  loading: boolean;
  /** 持久化的会话用量统计。 */
  usage?: AIUsage;
  /** 查询失败时显示的内联错误消息。 */
  error?: string;
  /** 关闭面板的回调函数。 */
  onClose: () => void;
}

defineOptions({ name: 'UsagePanel' });

const props = withDefaults(defineProps<UsagePanelProps>(), {
  usage: undefined,
  error: undefined
});

const inputPercent = computed(() => {
  if (!props.usage || props.usage.totalTokens === 0) return 0;
  return (props.usage.inputTokens / props.usage.totalTokens) * 100;
});

const outputPercent = computed(() => {
  if (!props.usage || props.usage.totalTokens === 0) return 0;
  return (props.usage.outputTokens / props.usage.totalTokens) * 100;
});

/**
 * 格式化 Token 数量用于显示。
 * @param value - Token 数量。
 * @returns 本地化格式的 Token 数量字符串。
 */
function formatTokens(value: number): string {
  return value.toLocaleString();
}
</script>

<style scoped>
.usage-panel {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  margin: 0 12px 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-secondary);
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
}

.usage-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-secondary);
}

.usage-panel__title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  letter-spacing: 0.05em;
}

.usage-panel__close {
  font-size: 12px;
  color: var(--text-tertiary);
}

.usage-panel__close:hover {
  color: var(--text-primary);
}

.usage-panel__body {
  min-height: 72px;
  padding: 16px;
}

.usage-panel__content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.usage-panel__summary {
  display: flex;
  flex-direction: row;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
}

.usage-panel__total {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.usage-panel__total-value {
  font-size: 28px;
  font-weight: 600;
  line-height: 1.1;
  color: var(--text-primary);
}

.usage-panel__total-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.usage-panel__progress {
  display: flex;
  height: 6px;
  overflow: hidden;
  background: var(--bg-disabled);
  border-radius: 3px;
}

.usage-panel__progress-bar {
  height: 100%;
}

.usage-panel__progress-bar--input {
  background: var(--usage-input);
}

.usage-panel__progress-bar--output {
  background: var(--usage-output);
}

.usage-panel__stats {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}

.usage-panel__stat {
  display: flex;
  gap: 6px;
  align-items: center;
  width: 100%;
}

.usage-panel__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.usage-panel__dot--input {
  background: var(--usage-input);
}

.usage-panel__dot--output {
  background: var(--usage-output);
}

.usage-panel__stat-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.usage-panel__stat-value {
  margin-left: auto;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.usage-panel__divider {
  display: none;
}

.usage-panel__state {
  display: flex;
  flex-direction: column;
  gap: 6px;
  justify-content: center;
  min-height: 72px;
}

.usage-panel__state--loading {
  align-items: flex-start;
}

.usage-panel__state--error {
  color: var(--color-error);
}

.usage-panel__state--empty {
  color: var(--text-secondary);
}

.usage-panel__state-text {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
}

.usage-panel__detail {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.usage-panel__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-secondary);
  border-top-color: var(--color-primary);
  border-radius: 999px;
  animation: usage-panel-spin 0.9s linear infinite;
}

@keyframes usage-panel-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
