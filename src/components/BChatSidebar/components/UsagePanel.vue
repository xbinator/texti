<!--
  @file UsagePanel.vue
  @description 聊天侧边栏的持久化会话用量摘要面板。
-->
<template>
  <section class="usage-panel">
    <div class="usage-panel__header">
      <div class="usage-panel__header-text">
        <div class="usage-panel__title">会话用量</div>
        <div class="usage-panel__subtitle">当前会话的持久化 Token 统计</div>
      </div>
      <BButton type="text" size="small" @click="onClose"> 关闭 </BButton>
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

      <div v-else-if="usage" data-testid="usage-panel-data" class="usage-panel__stats">
        <div class="usage-panel__stat">
          <span class="usage-panel__label">输入</span>
          <strong class="usage-panel__value">{{ formatTokens(usage.inputTokens) }}</strong>
        </div>
        <div class="usage-panel__stat">
          <span class="usage-panel__label">输出</span>
          <strong class="usage-panel__value">{{ formatTokens(usage.outputTokens) }}</strong>
        </div>
        <div class="usage-panel__stat">
          <span class="usage-panel__label">总计</span>
          <strong class="usage-panel__value">{{ formatTokens(usage.totalTokens) }}</strong>
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

withDefaults(defineProps<UsagePanelProps>(), {
  usage: undefined,
  error: undefined
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
  flex: 0 0 auto;
  min-height: 132px;
  padding: 12px 14px;
  margin: 0 12px 12px;
  background: linear-gradient(180deg, var(--bg-elevated), var(--bg-secondary));
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  box-shadow: 0 10px 22px rgb(47 53 64 / 6%);
}

.usage-panel__header {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}

.usage-panel__header-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.usage-panel__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.usage-panel__subtitle {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.usage-panel__body {
  min-height: 72px;
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

.usage-panel__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.usage-panel__stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  background: var(--bg-primary);
  border: 1px solid var(--border-secondary);
  border-radius: 6px;
}

.usage-panel__label {
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.usage-panel__value {
  font-size: 18px;
  line-height: 1.2;
  color: var(--text-primary);
}

@keyframes usage-panel-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
