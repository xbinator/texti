<!--
  @file ToolShellDisplay.vue
  @description 展示 Shell 工具命令、终端当前屏幕和失败或取消后的弱提示。
-->
<template>
  <div :class="bem('shell-terminal')">
    <div v-if="commandContent" :class="bem('shell-command')">
      <span aria-hidden="true">$</span>
      <span>{{ ` ${commandContent}` }}</span>
    </div>
    <div v-if="terminalContent" :class="bem('shell-output')">{{ terminalContent }}</div>
  </div>
  <div v-if="attentionText" :class="bem('shell-finished', { failure })">{{ attentionText }}</div>
</template>

<script setup lang="ts">
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'ToolShellDisplay' });

/** Shell 工具展示属性。 */
interface Props {
  /** Shell 命令文本。 */
  commandContent: string;
  /** Shell 当前屏幕或最终输出。 */
  terminalContent: string;
  /** 失败或取消时需要展示的提示。 */
  attentionText: string;
  /** 提示是否为失败状态。 */
  failure: boolean;
}

defineProps<Props>();
const [, bem] = createNamespace('', 'bubble-part-tool');
</script>

<style scoped lang="less">
.bubble-part-tool__shell-terminal {
  max-height: 280px;
  padding: 6px 8px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.2;
  background: var(--color-fill-tertiary, rgb(0 0 0 / 3%));
  border-radius: 4px;
}

.bubble-part-tool__shell-output {
  color: var(--text-secondary);
  word-break: normal;
  overflow-wrap: normal;
  white-space: pre;
}

.bubble-part-tool__shell-command + .bubble-part-tool__shell-output {
  margin-top: 4px;
}

.bubble-part-tool__shell-finished {
  padding: 0 2px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.bubble-part-tool__shell-finished--failure {
  color: var(--color-error);
}
</style>
