<!--
  @file SummaryModal.vue
  @description 摘要查看模态框组件，显示会话压缩摘要的详细信息。
-->
<template>
  <BModal v-model:open="visible" title="会话摘要" :footer="null" width="600px" @cancel="handleClose">
    <div v-if="summary" class="summary-modal">
      <!-- 基本信息 -->
      <div class="summary-section">
        <div class="summary-section__title">基本信息</div>
        <div class="summary-info-grid">
          <div class="summary-info-item">
            <span class="summary-info-label">压缩模式</span>
            <span class="summary-info-value">{{ buildModeText }}</span>
          </div>
          <div class="summary-info-item">
            <span class="summary-info-label">触发原因</span>
            <span class="summary-info-value">{{ triggerReasonText }}</span>
          </div>
          <div class="summary-info-item">
            <span class="summary-info-label">消息轮数</span>
            <span class="summary-info-value">{{ summary.messageCountSnapshot }} 轮</span>
          </div>
          <div class="summary-info-item">
            <span class="summary-info-label">字符体积</span>
            <span class="summary-info-value">{{ formatCharCount(summary.charCountSnapshot) }}</span>
          </div>
        </div>
      </div>

      <!-- 摘要文本 -->
      <div class="summary-section">
        <div class="summary-section__title">摘要内容</div>
        <div class="summary-text">{{ summary.summaryText }}</div>
      </div>

      <!-- 结构化摘要 -->
      <div v-if="summary.structuredSummary" class="summary-section">
        <div class="summary-section__title">结构化信息</div>
        <div class="structured-summary">
          <div class="structured-item">
            <div class="structured-label">目标</div>
            <div class="structured-value">{{ summary.structuredSummary.goal }}</div>
          </div>

          <div class="structured-item">
            <div class="structured-label">最近话题</div>
            <div class="structured-value">{{ summary.structuredSummary.recentTopic }}</div>
          </div>

          <div v-if="summary.structuredSummary.userPreferences?.length" class="structured-item">
            <div class="structured-label">用户偏好</div>
            <ul class="structured-list">
              <li v-for="(pref, index) in summary.structuredSummary.userPreferences" :key="index">
                {{ pref }}
              </li>
            </ul>
          </div>

          <div v-if="summary.structuredSummary.decisions?.length" class="structured-item">
            <div class="structured-label">已做决策</div>
            <ul class="structured-list">
              <li v-for="(decision, index) in summary.structuredSummary.decisions" :key="index">
                {{ decision }}
              </li>
            </ul>
          </div>

          <div v-if="summary.structuredSummary.importantFacts?.length" class="structured-item">
            <div class="structured-label">重要事实</div>
            <ul class="structured-list">
              <li v-for="(fact, index) in summary.structuredSummary.importantFacts" :key="index">
                {{ fact }}
              </li>
            </ul>
          </div>

          <div v-if="summary.structuredSummary.openQuestions?.length" class="structured-item">
            <div class="structured-label">待解决问题</div>
            <ul class="structured-list">
              <li v-for="(question, index) in summary.structuredSummary.openQuestions" :key="index">
                {{ question }}
              </li>
            </ul>
          </div>

          <div v-if="summary.structuredSummary.pendingActions?.length" class="structured-item">
            <div class="structured-label">待处理操作</div>
            <ul class="structured-list">
              <li v-for="(action, index) in summary.structuredSummary.pendingActions" :key="index">
                {{ action }}
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- 元数据 -->
      <div class="summary-section">
        <div class="summary-section__title">元数据</div>
        <div class="summary-meta">
          <div class="meta-item">
            <Icon icon="lucide:calendar" width="14" height="14" />
            <span>创建时间：{{ formatTime(summary.createdAt) }}</span>
          </div>
          <div class="meta-item">
            <Icon icon="lucide:refresh-cw" width="14" height="14" />
            <span>更新时间：{{ formatTime(summary.updatedAt) }}</span>
          </div>
          <div v-if="summary.derivedFromSummaryId" class="meta-item">
            <Icon icon="lucide:git-branch" width="14" height="14" />
            <span>继承自上一摘要</span>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="summary-empty">
      <Icon icon="lucide:file-x" width="48" height="48" />
      <p>暂无摘要信息</p>
    </div>
  </BModal>
</template>

<script setup lang="ts">
import type { ConversationSummaryRecord } from '../utils/compression/types';
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import dayjs from 'dayjs';
import BModal from '@/components/BModal/index.vue';

/**
 * 组件 Props 定义
 */
interface Props {
  /** 是否显示模态框 */
  open: boolean;
  /** 摘要记录 */
  summary?: ConversationSummaryRecord;
}

const props = withDefaults(defineProps<Props>(), {
  open: false,
  summary: undefined
});

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();

/**
 * 模态框可见性（双向绑定）
 */
const visible = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value)
});

/**
 * 构建模式文本
 */
const buildModeText = computed(() => {
  if (!props.summary) return '';
  const modeMap: Record<string, string> = {
    incremental: '增量构建',
    full_rebuild: '完全重建'
  };
  return modeMap[props.summary.buildMode] || props.summary.buildMode;
});

/**
 * 触发原因文本
 */
const triggerReasonText = computed(() => {
  if (!props.summary) return '';
  const reasonMap: Record<string, string> = {
    message_count: '消息轮数超限',
    context_size: '上下文体积超限',
    manual: '手动触发'
  };
  return reasonMap[props.summary.triggerReason] || props.summary.triggerReason;
});

/**
 * 格式化字符数
 */
function formatCharCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

/**
 * 格式化时间
 */
function formatTime(time: string): string {
  return dayjs(time).format('YYYY-MM-DD HH:mm:ss');
}

/**
 * 关闭模态框
 */
function handleClose(): void {
  emit('update:open', false);
}
</script>

<style scoped lang="less">
.summary-modal {
  max-height: 70vh;
  overflow-y: auto;
}

.summary-section {
  margin-bottom: 20px;

  &:last-child {
    margin-bottom: 0;
  }

  &__title {
    padding-bottom: 8px;
    margin-bottom: 12px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color);
    border-bottom: 1px solid var(--border-color);
  }
}

.summary-info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.summary-info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.summary-info-label {
  font-size: 12px;
  color: var(--text-color-secondary);
}

.summary-info-value {
  font-size: 13px;
  color: var(--text-color);
}

.summary-text {
  padding: 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-color);
  background: var(--bg-color-secondary);
  border-radius: 4px;
}

.structured-summary {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.structured-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.structured-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-color-secondary);
}

.structured-value {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-color);
}

.structured-list {
  padding-left: 20px;
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-color);

  li {
    margin-bottom: 4px;

    &:last-child {
      margin-bottom: 0;
    }
  }
}

.summary-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.meta-item {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: var(--text-color-secondary);

  svg {
    flex-shrink: 0;
  }
}

.summary-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--text-color-secondary);

  p {
    margin-top: 12px;
    font-size: 14px;
  }
}
</style>
