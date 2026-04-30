<!--
  @file LogTimeline.vue
  @description 日志时间轴单项组件，使用左侧信息列、中轴圆点连线和右侧消息卡片展示单条日志。
-->
<template>
  <div class="log-timeline__item" :class="itemClasses">
    <div class="log-timeline__meta">
      <div class="log-timeline__time">{{ formatDisplayTime(entry.timestamp) }}</div>
      <div class="log-timeline__scope">{{ getLogScopeLabel(entry.scope) }}</div>
    </div>

    <div class="log-timeline__axis">
      <div class="log-timeline__axis-track"></div>
      <div class="log-timeline__axis-anchor"></div>
      <div class="log-timeline__axis-dot" :class="`log-timeline__axis-dot--${entry.level.toLowerCase()}`"></div>
    </div>

    <div class="log-timeline__content">
      <div class="log-timeline__card">
        <div class="log-timeline__card-header">
          <ATag :color="getLogLevelColor(entry.level)">{{ getLogLevelLabel(entry.level) }}</ATag>
        </div>
        <div class="log-timeline__message">{{ entry.message }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { LogEntry } from '@/shared/logger/types';
import { getLogLevelColor, getLogLevelLabel, getLogScopeLabel } from '@/views/settings/logger/constant';

/**
 * 组件属性定义
 */
interface Props {
  /** 单条日志条目 */
  entry: LogEntry;
  /** 是否为第一条 */
  isFirst?: boolean;
  /** 是否为最后一条 */
  isLast?: boolean;
  /** 是否只有一条 */
  isOnly?: boolean;
}

const props = defineProps<Props>();

/**
 * 计算时间轴项的样式类
 */
const itemClasses = computed(() => ({
  'log-timeline__item--first': props.isFirst,
  'log-timeline__item--last': props.isLast,
  'log-timeline__item--only': props.isOnly
}));

/**
 * 提取用于左侧列展示的时间字符串。
 * @param timestamp - 原始时间戳。
 * @returns HH:mm:ss 格式的时间文本。
 */
function formatDisplayTime(timestamp: string): string {
  const match = timestamp.match(/\d{2}:\d{2}:\d{2}/);
  return match ? match[0] : timestamp;
}
</script>

<style scoped lang="less">
.log-timeline__item {
  display: grid;
  grid-template-columns: 100px 28px minmax(0, 1fr);
  column-gap: 18px;
  align-items: start;
  padding-bottom: 18px;
}

.log-timeline__item--first {
  .log-timeline__axis-track {
    top: 22px;
  }
}

.log-timeline__item--last {
  padding-bottom: 0;

  .log-timeline__axis-track {
    bottom: calc(100% - 22px);
  }
}

.log-timeline__item--only {
  .log-timeline__axis-track {
    display: none;
  }
}

.log-timeline__meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
  padding-top: 10px;
  text-align: right;
}

.log-timeline__time {
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--text-secondary);
}

.log-timeline__scope {
  font-size: 13px;
  line-height: 1.3;
  color: var(--text-secondary);
}

.log-timeline__axis {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100%;
  padding-top: 12px;
}

.log-timeline__axis-track {
  position: absolute;
  top: 0;
  bottom: -18px;
  left: 50%;
  width: 2px;
  background: var(--border-secondary);
  transform: translateX(-50%);
}

.log-timeline__axis-anchor {
  position: absolute;
  top: 20px;
  left: 50%;
  width: 0;
  height: 0;
  transform: translateX(-50%);
}

.log-timeline__axis-dot {
  z-index: 1;
  width: 16px;
  height: 16px;
  background: var(--color-primary-border);
  border: 4px solid var(--bg-primary);
  border-radius: 50%;
  transform: translateY(8px);
}

.log-timeline__axis-dot--error {
  background: var(--color-error);
}

.log-timeline__axis-dot--warn {
  background: var(--color-warning);
}

.log-timeline__axis-dot--info {
  background: var(--color-info);
}

.log-timeline__content {
  min-width: 0;
}

.log-timeline__card {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 18px 20px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
}

.log-timeline__card-header {
  flex-shrink: 0;
  padding-top: 1px;
}

.log-timeline__message {
  min-width: 0;
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
  word-break: break-all;
  white-space: pre-wrap;
}
</style>
