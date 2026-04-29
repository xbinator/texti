<!--
  @file LogTimeline.vue
  @description 日志时间轴组件，使用左侧信息列、中轴圆点连线和右侧消息卡片展示日志条目。
-->
<template>
  <div class="log-timeline">
    <div v-for="(entry, index) in entries" :key="`${entry.timestamp}-${entry.scope}-${index}`" class="log-timeline__item">
      <div class="log-timeline__meta">
        <div class="log-timeline__time">{{ formatDisplayTime(entry.timestamp) }}</div>
        <div class="log-timeline__scope">{{ getLogScopeLabel(entry.scope) }}</div>
      </div>

      <div class="log-timeline__axis">
        <div class="log-timeline__axis-dot" :class="`log-timeline__axis-dot--${entry.level.toLowerCase()}`"></div>
        <div v-if="index < entries.length - 1" class="log-timeline__axis-line"></div>
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
  </div>
</template>

<script setup lang="ts">
import type { LogEntry } from '@/shared/logger/types';
import { getLogLevelColor, getLogLevelLabel, getLogScopeLabel } from '@/views/settings/logger/constant';

/**
 * 组件属性定义
 */
interface Props {
  /** 日志条目列表 */
  entries: LogEntry[];
}

defineProps<Props>();

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
.log-timeline {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.log-timeline__item {
  display: grid;
  grid-template-columns: 132px 28px minmax(0, 1fr);
  column-gap: 18px;
  align-items: start;
}

.log-timeline__meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
  padding-top: 4px;
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
  padding-top: 6px;
}

.log-timeline__axis-dot {
  z-index: 1;
  width: 16px;
  height: 16px;
  background: #91caff;
  border: 4px solid var(--bg-primary);
  border-radius: 50%;
}

.log-timeline__axis-dot--error {
  background: #ff4d4f;
}

.log-timeline__axis-dot--warn {
  background: #faad14;
}

.log-timeline__axis-dot--info {
  background: #4096ff;
}

.log-timeline__axis-line {
  position: absolute;
  top: 22px;
  bottom: -18px;
  width: 2px;
  background: var(--border-light);
}

.log-timeline__content {
  min-width: 0;
}

.log-timeline__card {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  min-height: 72px;
  padding: 18px 20px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 18px;
}

.log-timeline__card-header {
  flex-shrink: 0;
  padding-top: 2px;
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
