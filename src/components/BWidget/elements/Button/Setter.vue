<!--
  @file Setter.vue
  @description BWidget 按钮元素专属属性设置面板。
-->
<template>
  <BSectionBlock title="按钮" label-min-width="60">
    <BSectionItem label="文字">
      <BSmartInput v-model:value="element.metadata.text" :options="variableOptions" placeholder="按钮文字" />
    </BSectionItem>
    <BSectionItem label="状态">
      <BSmartSelect v-model:value="element.metadata.disabled" :options="WIDGET_BUTTON_DISABLED_OPTIONS" :variables="variableOptions" />
    </BSectionItem>
    <BSectionItem label="加载">
      <BSmartSelect v-model:value="element.metadata.loading" :options="WIDGET_BUTTON_LOADING_OPTIONS" :variables="variableOptions" />
    </BSectionItem>
  </BSectionBlock>

  <BSectionBlock title="动作设置">
    <BSmartMethod v-model:value="element.metadata.actions" :methods="methodOptions" :variables="variableOptions" />
  </BSectionBlock>
</template>

<script setup lang="ts">
import type { WidgetButtonElementMetadata } from './schema';
import type { WidgetElement } from '../../types';
import { useElementMethods } from '../../hooks/useElementMethods';
import { useElementVariables } from '../../hooks/useElementVariables';
import { WIDGET_BUTTON_DISABLED_OPTIONS, WIDGET_BUTTON_LOADING_OPTIONS } from './schema';

/** 当前编辑的按钮元素。 */
const element = defineModel<WidgetElement<WidgetButtonElementMetadata>>('element', { required: true });

/** 当前可插入变量候选。 */
const { variableOptions } = useElementVariables((): WidgetElement<WidgetButtonElementMetadata> => element.value);
/** 当前 Widget 脚本里的公开方法候选。 */
const { methodOptions } = useElementMethods();
</script>
