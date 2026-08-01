<!--
  @file SidebarState.vue
  @description 侧边栏数据源 schema 配置面板，承载入参与出参字段定义与编辑。
-->
<template>
  <SidebarPanel title="数据源">
    <template #help>
      <BIcon class="schema-help-icon" icon="lucide:circle-alert" role="button" :size="14" tabindex="0" @click="openSchemaHelp" />
    </template>
    <template #extra>
      <BButton type="secondary" icon="lucide:plus" size="mini" square tooltip="添加字段" @click="addRootSchemaField" />
      <BButton type="secondary" size="mini" @click="openSchemaInputEditor"> JSON 编辑 </BButton>
    </template>
    <div class="schema-mode">
      <BSegmented :value="activeMode" block :options="schemaModeOptions" @change="handleSchemaModeChange" />
    </div>
    <div class="schema-body">
      <SchemaTreeEditor v-model:schema="activeSchema" />
    </div>
  </SidebarPanel>

  <!-- Schema JSON 编辑弹窗 -->
  <BMonacoModal
    v-model:open="schemaInputEditorOpen"
    v-model:value="activeSchema"
    :default-value="WIDGET_SCHEMA_DEFAULT_FIELD_NAME"
    :editor-state="schemaEditorState"
    :validate="validateSchemaEditorValue"
    language="json"
    :options="{ wordWrap: true, search: false }"
  />
  <!-- Schema 填写说明抽屉 -->
  <SchemaHelp v-model:open="schemaHelpDrawerOpen" :kind="activeMode" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { cloneDeep, has } from 'lodash-es';
import type { EditorState } from '@/components/BEditor/types';
import BMonacoModal from '@/components/BMonaco/Modal.vue';
import type { BSegmentedOption } from '@/components/BSegmented/types';
import type { WidgetData, WidgetSchemaObject } from '@/components/BWidget/types';
import { DEFAULT_WIDGET_EMPTY_SCHEMA, normalizeWidgetSchemaObject } from '@/components/BWidget/utils/widgetData';
import { isWidgetSchemaObject } from '@/components/BWidget/utils/widgetSchema';
import { WIDGET_SCHEMA_DEFAULT_FIELD_NAME } from '../constants/pageSetter';
import SidebarPanel from './_SidebarPanel.vue';
import SchemaHelp from './PageSetter/SchemaHelp.vue';
import SchemaTreeEditor from './PageSetter/SchemaTreeEditor.vue';

defineOptions({ name: 'SidebarState' });

/**
 * 数据源 schema 分段选项。
 */
type SidebarSchemaModeOption = Omit<BSegmentedOption, 'value'> & {
  /** 选项对应的 WidgetData schema 字段名。 */
  value: 'inputSchema' | 'outputSchema';
};

const dataItem = defineModel<WidgetData>('value', { required: true });

/** 当前正在编辑的 schema 类型。 */
const activeMode = ref<'inputSchema' | 'outputSchema'>('inputSchema');
/** Schema JSON 编辑弹窗开关状态。 */
const schemaInputEditorOpen = ref(false);
/** Schema 填写说明抽屉开关。 */
const schemaHelpDrawerOpen = ref(false);

/** 数据源 schema 模式切换选项。 */
const schemaModeOptions: SidebarSchemaModeOption[] = [
  { label: '入参', value: 'inputSchema' },
  { label: '出参', value: 'outputSchema' }
];

/**
 * 创建根级唯一 schema 字段名。
 * @param schema - schema 对象
 * @returns 唯一字段名
 */
function createUniqueRootSchemaFieldName(schema: WidgetSchemaObject): string {
  if (!has(schema.properties, WIDGET_SCHEMA_DEFAULT_FIELD_NAME)) {
    return WIDGET_SCHEMA_DEFAULT_FIELD_NAME;
  }

  let index = 1;
  while (has(schema.properties, `${WIDGET_SCHEMA_DEFAULT_FIELD_NAME}${index}`)) {
    index += 1;
  }

  return `${WIDGET_SCHEMA_DEFAULT_FIELD_NAME}${index}`;
}

/**
 * 校验 Schema JSON 编辑器保存值。
 * @param value - 待校验模型值
 * @returns 错误文案；undefined 表示校验通过
 */
function validateSchemaEditorValue(value: unknown): string | undefined {
  if (!isWidgetSchemaObject(value)) {
    return 'Schema 必须是合法 JSON 对象';
  }

  return undefined;
}

/** 当前正在编辑的 schema。 */
const activeSchema = computed<WidgetSchemaObject>({
  get: (): WidgetSchemaObject => normalizeWidgetSchemaObject(dataItem.value[activeMode.value]),
  set: (schema: WidgetSchemaObject): void => {
    dataItem.value = { ...dataItem.value, [activeMode.value]: schema };
  }
});

/** Schema JSON 编辑器状态。 */
const schemaEditorState = computed<EditorState>(() => ({
  id: `widget-${activeMode.value}-schema`,
  name: `${activeMode.value}.json`,
  path: null,
  ext: 'json',
  content: JSON.stringify(activeSchema.value, null, 2)
}));

/**
 * 添加根级 schema 字段。
 */
function addRootSchemaField(): void {
  const nextSchema = cloneDeep(activeSchema.value || DEFAULT_WIDGET_EMPTY_SCHEMA);
  const fieldName = createUniqueRootSchemaFieldName(nextSchema);

  nextSchema.properties[fieldName] = { type: 'string' };

  activeSchema.value = nextSchema;
}

/**
 * 打开 Schema JSON 编辑弹窗。
 */
function openSchemaInputEditor(): void {
  schemaInputEditorOpen.value = true;
}

/**
 * 打开 Schema 填写说明抽屉。
 */
function openSchemaHelp(): void {
  schemaHelpDrawerOpen.value = true;
}

/**
 * 切换当前 schema 编辑模式。
 * @param value - 分段选项值
 */
function handleSchemaModeChange(value: string | number): void {
  activeMode.value = value as 'inputSchema' | 'outputSchema';
}
</script>

<style lang="less" scoped>
.schema-help-icon {
  color: var(--text-tertiary);
  cursor: pointer;
  transition: color var(--motion-duration-fast) var(--motion-easing-standard);
}

.schema-help-icon:hover,
.schema-help-icon:focus {
  color: var(--color-primary);
}

.schema-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.schema-mode {
  margin-bottom: 10px;
}
</style>
