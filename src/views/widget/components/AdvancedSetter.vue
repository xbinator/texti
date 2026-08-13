<!--
  @file AdvancedSetter.vue
  @description Widget元素高级配置面板。
-->
<template>
  <div class="widget-advanced-setter">
    <BSectionBlock title="循环数据" :label-min-width="60">
      <BSectionItem label="启用" content-align="right">
        <ACheckbox v-model:checked="element.loop.enabled" />
      </BSectionItem>

      <BSectionItem label="数据源">
        <BSmartInput v-model:value="element.loop.source" :options="variableOptions" placeholder="数组数据路径，如 $input.items" />
      </BSectionItem>

      <BSectionItem label="迭代变量名">
        <AInput v-model:value="element.loop.itemName" placeholder="默认为：item" />
      </BSectionItem>
      <BSectionItem label="索引变量名">
        <AInput v-model:value="element.loop.indexName" placeholder="默认为：index" />
      </BSectionItem>

      <BSectionItem label="列数" direction="vertical">
        <template #label-extra>
          <ACheckbox v-model:checked="element.loop.autoColumns"> 自适应 </ACheckbox>
        </template>
        <BInputNumber v-model:value="element.loop.columns" :disabled="element.loop.autoColumns" :min="1" :precision="0" placeholder="列数" />
      </BSectionItem>

      <div class="widget-advanced-setter__loop-grid">
        <BSectionItem label="列距" direction="vertical">
          <BInputNumber v-model:value="element.loop.columnGap" placeholder="列距" />
        </BSectionItem>
        <BSectionItem label="行距" direction="vertical">
          <BInputNumber v-model:value="element.loop.rowGap" placeholder="行距" />
        </BSectionItem>
      </div>
    </BSectionBlock>
  </div>
</template>

<script setup lang="ts">
import { Checkbox as ACheckbox, Input as AInput } from 'ant-design-vue';
import { useElementVariables } from '@/components/BWidget/hooks/useElementVariables';
import type { WidgetElement } from '@/components/BWidget/types';

defineOptions({ name: 'AdvancedSetter' });

const element = defineModel<WidgetElement>('element', { required: true });

/** 当前可插入变量候选。 */
const { variableOptions } = useElementVariables((): WidgetElement => element.value);
</script>

<style lang="less" scoped>
.widget-advanced-setter {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.widget-advanced-setter__loop-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
</style>
