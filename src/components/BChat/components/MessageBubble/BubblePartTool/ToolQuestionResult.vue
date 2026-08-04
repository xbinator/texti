<!--
  @file ToolQuestionResult.vue
  @description 以问答形式展示提问工具的用户选择和补充信息。
-->
<template>
  <div :class="bem('result')">
    <div v-for="(item, index) in qaItems" :key="index" :class="bem('result-item')">
      <div :class="bem('result-label')">{{ item.question }}</div>
      <div :class="bem('result-tags')">
        <span v-for="label in item.selectedLabels" :key="label" :class="bem('result-tag')">{{ label }}</span>
      </div>
    </div>
    <div :class="bem('result-item')">
      <div :class="bem('result-label')">是否有更多的补充信息需要提供？（可选）</div>
      <div :class="bem('result-tags')">
        <span :class="bem('result-tag')">{{ otherText || '未填写' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'ToolQuestionResult' });

/** 问答展示项：包含问题文本和用户选择的标签列表。 */
interface QaItem {
  /** 问题文本。 */
  question: string;
  /** 用户选择的选项标签列表。 */
  selectedLabels: string[];
}

/** 提问工具结果属性。 */
interface Props {
  /** 问答展示项列表。 */
  qaItems: QaItem[];
  /** 用户填写的补充信息。 */
  otherText?: string;
}

withDefaults(defineProps<Props>(), {
  otherText: undefined
});
const [, bem] = createNamespace('', 'bubble-part-tool');
</script>

<style scoped lang="less">
.bubble-part-tool__result {
  font-size: 12px;
  line-height: 1.6;
}

.bubble-part-tool__result-item + .bubble-part-tool__result-item {
  padding-top: 8px;
  margin-top: 8px;
  border-top: 1px dashed var(--border-primary);
}

.bubble-part-tool__result-label {
  font-weight: 500;
  color: var(--text-primary);
}

.bubble-part-tool__result-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.bubble-part-tool__result-tag {
  padding: 1px 6px;
  color: var(--color-primary);
  background: var(--color-primary-bg, rgb(22 119 255 / 8%));
  border-radius: 4px;
}
</style>
