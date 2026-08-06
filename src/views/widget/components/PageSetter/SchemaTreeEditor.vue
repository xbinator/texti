<!--
  @file SchemaTreeEditor.vue
  @description Widget页面 Schema 树形字段编辑器。
-->
<template>
  <div class="schema-editor">
    <div class="schema-editor__header">
      <span class="schema-editor__header-name">
        <span v-if="hasToggleColumn" class="schema-editor__header-toggle-placeholder" aria-hidden="true"></span>
        <span>变量名</span>
      </span>
      <span class="schema-editor__header-type">变量类型</span>
      <span class="schema-editor__header-controls" :class="{ 'is-object': hasObjectActionColumn }">
        <span class="schema-editor__header-required">必填</span>
        <span class="schema-editor__header-actions">操作</span>
      </span>
    </div>

    <div v-if="schemaRows.length === 0" class="schema-editor__empty">
      <span class="schema-editor__empty-text">暂无字段</span>
    </div>

    <div v-else class="schema-editor__rows">
      <div
        v-for="row in schemaRows"
        :key="row.path"
        class="schema-editor__row-wrap"
        :class="{ 'is-description-expanded': isDescriptionExpanded(row.path) }"
        :style="readRowStyle(row.depth)"
      >
        <div class="schema-editor__row" :class="{ 'is-invalid': Boolean(readFieldNameError(row.path)), 'is-object': isObjectSchemaProperty(row.property) }">
          <div class="schema-editor__name-cell">
            <BButton
              v-if="isFoldableSchemaProperty(row.property)"
              class="schema-editor__toggle"
              :icon="isRowExpanded(row.path) ? 'lucide:chevron-down' : 'lucide:chevron-right'"
              size="mini"
              square
              type="text"
              @click="toggleRow(row.path)"
            />
            <span v-else-if="hasToggleColumn" class="schema-editor__toggle-placeholder" aria-hidden="true"></span>
            <div class="schema-editor__name-input">
              <AInput size="small" :value="readFieldNameDraft(row)" @update:value="(value: string) => handleFieldNameInput(row, value)" />
            </div>
          </div>

          <div class="schema-editor__type-select">
            <BSelect
              :options="schemaTypeOptions"
              size="small"
              :value="row.property.type"
              @change="(value: string | number) => handlePropertyTypeChange(row, value)"
            />
          </div>

          <div class="schema-editor__controls" :class="{ 'is-object': hasObjectActionColumn }">
            <div class="schema-editor__control-cell">
              <ACheckbox :checked="isFieldRequired(row)" @update:checked="(checked: boolean) => handleRequiredChange(row, checked)" />
            </div>
            <div class="schema-editor__control-cell">
              <BButton
                :icon="isDescriptionExpanded(row.path) ? 'lucide:minimize-2' : 'lucide:maximize-2'"
                size="mini"
                square
                type="text"
                @click="toggleDescription(row.path)"
              />
            </div>
            <div v-if="isObjectSchemaProperty(row.property)" class="schema-editor__control-cell">
              <BButton icon="lucide:git-branch-plus" size="mini" square tooltip="添加子字段" type="text" @click="handleChildFieldAdd(row)" />
            </div>
            <div v-else-if="hasObjectActionColumn" class="schema-editor__control-cell"></div>
            <div class="schema-editor__control-cell">
              <BButton danger icon="lucide:minus" size="mini" square tooltip="删除字段" type="text" @click="handleFieldDelete(row)" />
            </div>
          </div>
        </div>
        <p v-if="readFieldNameError(row.path)" class="schema-editor__field-error">{{ readFieldNameError(row.path) }}</p>
        <div v-if="isDescriptionExpanded(row.path)" class="schema-editor__description">
          <ATextarea
            :auto-size="{ minRows: 2, maxRows: 4 }"
            placeholder="输入字段描述"
            size="small"
            :value="readFieldDescription(row)"
            @update:value="(value: string) => handleDescriptionInput(row, value)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { cloneDeep } from 'lodash-es';
import type { WidgetSchemaObject, WidgetSchemaProperty, WidgetSchemaPropertyType } from '@/components/BWidget/types';

/**
 * Schema 编辑器字段行。
 */
interface SchemaTreeEditorRow {
  /** 字段完整路径 */
  path: string;
  /** 父级字段路径，根级为空字符串 */
  parentPath: string;
  /** 字段名 */
  name: string;
  /** 字段定义 */
  property: WidgetSchemaProperty;
  /** 字段缩进层级 */
  depth: number;
}

/**
 * Schema 字段容器。
 */
interface SchemaFieldContainer {
  /** 对象字段定义 */
  properties: Record<string, WidgetSchemaProperty>;
  /** 必填字段名列表 */
  required?: string[];
}

/**
 * 字段类型下拉选项。
 */
interface SchemaTypeOption {
  /** 选项显示文本 */
  label: string;
  /** 字段类型值 */
  value: WidgetSchemaPropertyType;
}

/** Schema 类型选项。 */
const schemaTypeOptions: SchemaTypeOption[] = [
  { label: 'String', value: 'string' },
  { label: 'Number', value: 'number' },
  { label: 'Boolean', value: 'boolean' },
  { label: 'Object', value: 'object' },
  { label: 'Array', value: 'array' }
];

/** 默认新增字段名。 */
const DEFAULT_FIELD_NAME = 'field';

const schema = defineModel<WidgetSchemaObject>('schema', { required: true });

/** 已展开的对象字段路径。 */
const expandedPaths = ref<Set<string>>(new Set());
/** 已展开描述编辑器的字段路径。 */
const descriptionExpandedPaths = ref<Set<string>>(new Set());
/** 字段名编辑草稿。 */
const fieldNameDrafts = ref<Record<string, string>>({});
/** 字段名校验错误。 */
const fieldNameErrors = ref<Record<string, string>>({});

/**
 * 判断字段类型值是否合法。
 * @param value - 待判断值
 * @returns 是否为 schema 字段类型
 */
function isWidgetSchemaPropertyType(value: unknown): value is WidgetSchemaPropertyType {
  return value === 'string' || value === 'number' || value === 'boolean' || value === 'object' || value === 'array';
}

/**
 * 判断 schema 字段是否为对象字段。
 * @param property - schema 字段
 * @returns 是否为对象字段
 */
function isObjectSchemaProperty(property: WidgetSchemaProperty): boolean {
  return property.type === 'object';
}

/**
 * 判断对象字段是否已有可折叠的子字段。
 * @param property - schema 字段
 * @returns 是否需要展示折叠按钮
 */
function isFoldableSchemaProperty(property: WidgetSchemaProperty): boolean {
  return isObjectSchemaProperty(property) && Object.keys(property.properties ?? {}).length > 0;
}

/**
 * 判断值是否为 schema 字段容器。
 * @param value - 待判断值
 * @returns 是否为字段容器
 */
function isSchemaFieldContainer(value: WidgetSchemaObject | WidgetSchemaProperty): value is WidgetSchemaObject | (WidgetSchemaProperty & SchemaFieldContainer) {
  return value.type === 'object' && typeof value.properties === 'object' && value.properties !== null;
}

/**
 * 转义 schema 字段路径片段，避免字段名中的点号或斜杠影响内部路径寻址。
 * @param segment - 原始字段名
 * @returns 转义后的路径片段
 */
function encodeSchemaPathSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

/**
 * 拼接字段路径。
 * @param parentPath - 父级路径
 * @param name - 字段名
 * @returns 字段完整路径
 */
function joinSchemaPath(parentPath: string, name: string): string {
  const segment = encodeSchemaPathSegment(name);

  return parentPath ? `${parentPath}/${segment}` : segment;
}

/**
 * 还原 schema 字段路径片段。
 * @param segment - 转义后的路径片段
 * @returns 原始字段名
 */
function decodeSchemaPathSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

/**
 * 拆分内部 schema 字段路径。
 * @param path - 字段路径
 * @returns 原始字段名片段列表
 */
function splitSchemaPath(path: string): string[] {
  return path ? path.split('/').map(decodeSchemaPathSegment) : [];
}

/**
 * 判断路径是否为指定前缀本身或其后代。
 * @param path - 待判断路径
 * @param prefix - 路径前缀
 * @returns 是否匹配路径前缀
 */
function isSameOrDescendantPath(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * 替换路径前缀。
 * @param path - 原路径
 * @param oldPrefix - 旧前缀
 * @param newPrefix - 新前缀
 * @returns 替换后的路径
 */
function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (path === oldPrefix) {
    return newPrefix;
  }

  return `${newPrefix}${path.slice(oldPrefix.length)}`;
}

/**
 * 读取指定路径的字段容器。
 * @param root - 根 schema
 * @param path - 字段路径，空字符串表示根 schema
 * @returns 字段容器，不存在时返回 null
 */
function readSchemaContainer(root: WidgetSchemaObject, path: string): SchemaFieldContainer | null {
  if (!path) {
    return root;
  }

  let current: WidgetSchemaObject | WidgetSchemaProperty = root;
  for (const segment of splitSchemaPath(path)) {
    if (!isSchemaFieldContainer(current)) {
      return null;
    }

    const next = current.properties[segment];
    if (!next) {
      return null;
    }

    current = next;
  }

  return isSchemaFieldContainer(current) ? current : null;
}

/**
 * 更新 schema。
 * @param mutator - schema 草稿修改函数
 */
function updateSchema(mutator: (draft: WidgetSchemaObject) => void): void {
  const draft = cloneDeep(schema.value);

  mutator(draft);
  schema.value = draft;
}

/**
 * 创建指定类型的默认字段。
 * @param type - 字段类型
 * @returns schema 字段
 */
function createDefaultSchemaProperty(type: WidgetSchemaPropertyType = 'string'): WidgetSchemaProperty {
  if (type === 'object') {
    return {
      type: 'object',
      properties: {},
      required: []
    };
  }

  if (type === 'array') {
    return {
      type: 'array',
      items: {
        type: 'string'
      }
    };
  }

  return { type };
}

/**
 * 按新类型转换字段。
 * @param property - 原字段
 * @param type - 新字段类型
 * @returns 转换后的字段
 */
function convertSchemaPropertyType(property: WidgetSchemaProperty, type: WidgetSchemaPropertyType): WidgetSchemaProperty {
  const converted = createDefaultSchemaProperty(type);

  if (property.description) {
    converted.description = property.description;
  }

  if (type === 'object' && property.type === 'object') {
    converted.properties = cloneDeep(property.properties ?? {});
    converted.required = [...(property.required ?? [])];
  }

  if (type === 'array' && property.type === 'array') {
    converted.items = cloneDeep(property.items ?? { type: 'string' });
  }

  return converted;
}

/**
 * 创建同级唯一字段名。
 * @param container - 字段容器
 * @returns 唯一字段名
 */
function createUniqueFieldName(container: SchemaFieldContainer): string {
  if (!Object.prototype.hasOwnProperty.call(container.properties, DEFAULT_FIELD_NAME)) {
    return DEFAULT_FIELD_NAME;
  }

  let index = 1;
  while (Object.prototype.hasOwnProperty.call(container.properties, `${DEFAULT_FIELD_NAME}${index}`)) {
    index += 1;
  }

  return `${DEFAULT_FIELD_NAME}${index}`;
}

/**
 * 判断字段行是否展开。
 * @param path - 字段路径
 * @returns 是否展开
 */
function isRowExpanded(path: string): boolean {
  return expandedPaths.value.has(path);
}

/**
 * 收集可见 schema 字段行。
 * @param container - 字段容器
 * @param parentPath - 父级路径
 * @param depth - 当前层级
 * @returns 字段行列表
 */
function collectSchemaRows(container: SchemaFieldContainer, parentPath: string, depth: number): SchemaTreeEditorRow[] {
  return Object.entries(container.properties).flatMap(([name, property]: [string, WidgetSchemaProperty]): SchemaTreeEditorRow[] => {
    const path = joinSchemaPath(parentPath, name);
    const row: SchemaTreeEditorRow = {
      path,
      parentPath,
      name,
      property,
      depth
    };

    if (!isObjectSchemaProperty(property) || !isRowExpanded(path)) {
      return [row];
    }

    return [row, ...collectSchemaRows({ properties: property.properties ?? {}, required: property.required ?? [] }, path, depth + 1)];
  });
}

/**
 * 读取字段行内联样式。
 * @param depth - 缩进层级
 * @returns CSS 变量样式
 */
function readRowStyle(depth: number): Record<string, string> {
  return {
    '--schema-editor-depth': String(depth)
  };
}

/**
 * 写入展开路径集合。
 * @param updater - 展开路径修改函数
 */
function updateExpandedPaths(updater: (draft: Set<string>) => void): void {
  const draft = new Set(expandedPaths.value);

  updater(draft);
  expandedPaths.value = draft;
}

/**
 * 切换字段展开状态。
 * @param path - 字段路径
 */
function toggleRow(path: string): void {
  updateExpandedPaths((draft: Set<string>): void => {
    if (draft.has(path)) {
      draft.delete(path);
      return;
    }

    draft.add(path);
  });
}

/**
 * 判断描述编辑器是否展开。
 * @param path - 字段路径
 * @returns 描述编辑器是否展开
 */
function isDescriptionExpanded(path: string): boolean {
  return descriptionExpandedPaths.value.has(path);
}

/**
 * 写入描述展开路径集合。
 * @param updater - 描述展开路径修改函数
 */
function updateDescriptionExpandedPaths(updater: (draft: Set<string>) => void): void {
  const draft = new Set(descriptionExpandedPaths.value);

  updater(draft);
  descriptionExpandedPaths.value = draft;
}

/**
 * 切换字段描述编辑器展开状态。
 * @param path - 字段路径
 */
function toggleDescription(path: string): void {
  updateDescriptionExpandedPaths((draft: Set<string>): void => {
    if (draft.has(path)) {
      draft.delete(path);
      return;
    }

    draft.add(path);
  });
}

/**
 * 读取字段名草稿。
 * @param row - schema 字段行
 * @returns 字段名输入值
 */
function readFieldNameDraft(row: SchemaTreeEditorRow): string {
  return fieldNameDrafts.value[row.path] ?? row.name;
}

/**
 * 读取字段名错误。
 * @param path - 字段路径
 * @returns 错误文本
 */
function readFieldNameError(path: string): string {
  return fieldNameErrors.value[path] ?? '';
}

/**
 * 写入指定字段名草稿与错误。
 * @param path - 字段路径
 * @param draftName - 字段名草稿
 * @param message - 错误提示
 */
function writeFieldNameError(path: string, draftName: string, message: string): void {
  fieldNameDrafts.value = {
    ...fieldNameDrafts.value,
    [path]: draftName
  };
  fieldNameErrors.value = {
    ...fieldNameErrors.value,
    [path]: message
  };
}

/**
 * 清理指定路径的字段名草稿与错误。
 * @param path - 字段路径
 */
function clearFieldNameState(path: string): void {
  const nextDrafts = { ...fieldNameDrafts.value };
  const nextErrors = { ...fieldNameErrors.value };

  delete nextDrafts[path];
  delete nextErrors[path];
  fieldNameDrafts.value = nextDrafts;
  fieldNameErrors.value = nextErrors;
}

/**
 * 清理指定路径及其后代的本地编辑状态。
 * @param path - 字段路径
 */
function clearDescendantLocalState(path: string): void {
  fieldNameDrafts.value = Object.fromEntries(
    Object.entries(fieldNameDrafts.value).filter(([key]: [string, string]): boolean => !isSameOrDescendantPath(key, path))
  );
  fieldNameErrors.value = Object.fromEntries(
    Object.entries(fieldNameErrors.value).filter(([key]: [string, string]): boolean => !isSameOrDescendantPath(key, path))
  );
  updateExpandedPaths((draft: Set<string>): void => {
    for (const key of [...draft]) {
      if (isSameOrDescendantPath(key, path)) {
        draft.delete(key);
      }
    }
  });
  updateDescriptionExpandedPaths((draft: Set<string>): void => {
    for (const key of [...draft]) {
      if (isSameOrDescendantPath(key, path)) {
        draft.delete(key);
      }
    }
  });
}

/**
 * 字段改名后同步本地路径状态。
 * @param oldPath - 旧路径
 * @param newPath - 新路径
 */
function syncLocalStateAfterRename(oldPath: string, newPath: string): void {
  fieldNameDrafts.value = Object.fromEntries(
    Object.entries(fieldNameDrafts.value)
      .filter(([key]: [string, string]): boolean => !isSameOrDescendantPath(key, oldPath))
      .map(([key, value]: [string, string]): [string, string] => [replacePathPrefix(key, oldPath, newPath), value])
  );
  fieldNameErrors.value = Object.fromEntries(
    Object.entries(fieldNameErrors.value)
      .filter(([key]: [string, string]): boolean => !isSameOrDescendantPath(key, oldPath))
      .map(([key, value]: [string, string]): [string, string] => [replacePathPrefix(key, oldPath, newPath), value])
  );
  updateExpandedPaths((draft: Set<string>): void => {
    const renamedPaths = [...draft].map((key: string): string => (isSameOrDescendantPath(key, oldPath) ? replacePathPrefix(key, oldPath, newPath) : key));

    draft.clear();
    renamedPaths.forEach((key: string): void => {
      draft.add(key);
    });
  });
  updateDescriptionExpandedPaths((draft: Set<string>): void => {
    const renamedPaths = [...draft].map((key: string): string => (isSameOrDescendantPath(key, oldPath) ? replacePathPrefix(key, oldPath, newPath) : key));

    draft.clear();
    renamedPaths.forEach((key: string): void => {
      draft.add(key);
    });
  });
}

/**
 * 判断字段是否必填。
 * @param row - schema 字段行
 * @returns 是否必填
 */
function isFieldRequired(row: SchemaTreeEditorRow): boolean {
  const container = readSchemaContainer(schema.value, row.parentPath);

  return Boolean(container?.required?.includes(row.name));
}

/**
 * 处理字段名输入。
 * @param row - schema 字段行
 * @param value - 新字段名
 */
function handleFieldNameInput(row: SchemaTreeEditorRow, value: string): void {
  const nextName = value.trim();
  const container = readSchemaContainer(schema.value, row.parentPath);

  if (!container || nextName === row.name) {
    clearFieldNameState(row.path);
    return;
  }

  if (!nextName) {
    writeFieldNameError(row.path, value, '字段名不能为空');
    return;
  }

  if (Object.prototype.hasOwnProperty.call(container.properties, nextName)) {
    writeFieldNameError(row.path, value, '同级字段名不能重复');
    return;
  }

  updateSchema((draft: WidgetSchemaObject): void => {
    const draftContainer = readSchemaContainer(draft, row.parentPath);
    const currentProperty = draftContainer?.properties[row.name];

    if (!draftContainer || !currentProperty) {
      return;
    }

    draftContainer.properties = Object.fromEntries(
      Object.entries(draftContainer.properties).map(([name, property]: [string, WidgetSchemaProperty]): [string, WidgetSchemaProperty] => [
        name === row.name ? nextName : name,
        property
      ])
    );
    draftContainer.required = (draftContainer.required ?? []).map((name: string): string => (name === row.name ? nextName : name));
  });
  syncLocalStateAfterRename(row.path, joinSchemaPath(row.parentPath, nextName));
  clearFieldNameState(row.path);
}

/**
 * 处理字段类型变更。
 * @param row - schema 字段行
 * @param value - 新字段类型
 */
function handlePropertyTypeChange(row: SchemaTreeEditorRow, value: string | number): void {
  if (!isWidgetSchemaPropertyType(value)) {
    return;
  }

  updateSchema((draft: WidgetSchemaObject): void => {
    const draftContainer = readSchemaContainer(draft, row.parentPath);
    const currentProperty = draftContainer?.properties[row.name];

    if (!draftContainer || !currentProperty) {
      return;
    }

    draftContainer.properties[row.name] = convertSchemaPropertyType(currentProperty, value);
  });

  if (value === 'object') {
    updateExpandedPaths((draft: Set<string>): void => {
      draft.add(row.path);
    });
  }
}

/**
 * 处理字段必填状态变更。
 * @param row - schema 字段行
 * @param checked - 是否必填
 */
function handleRequiredChange(row: SchemaTreeEditorRow, checked: boolean): void {
  updateSchema((draft: WidgetSchemaObject): void => {
    const draftContainer = readSchemaContainer(draft, row.parentPath);
    if (!draftContainer) {
      return;
    }

    const required = new Set(draftContainer.required ?? []);
    if (checked) {
      required.add(row.name);
    } else {
      required.delete(row.name);
    }

    draftContainer.required = [...required];
  });
}

/**
 * 读取字段描述。
 * @param row - schema 字段行
 * @returns 字段描述输入值
 */
function readFieldDescription(row: SchemaTreeEditorRow): string {
  return row.property.description ?? '';
}

/**
 * 处理字段描述输入。
 * @param row - schema 字段行
 * @param value - 字段描述输入值
 */
function handleDescriptionInput(row: SchemaTreeEditorRow, value: string): void {
  updateSchema((draft: WidgetSchemaObject): void => {
    const draftContainer = readSchemaContainer(draft, row.parentPath);
    const currentProperty = draftContainer?.properties[row.name];

    if (!draftContainer || !currentProperty) {
      return;
    }

    if (value.trim()) {
      currentProperty.description = value;
      return;
    }

    delete currentProperty.description;
  });
}

/**
 * 添加对象子字段。
 * @param row - 对象字段行
 */
function handleChildFieldAdd(row: SchemaTreeEditorRow): void {
  updateSchema((draft: WidgetSchemaObject): void => {
    const draftContainer = readSchemaContainer(draft, row.path);
    if (!draftContainer) {
      return;
    }

    const name = createUniqueFieldName(draftContainer);

    draftContainer.properties[name] = createDefaultSchemaProperty();
    draftContainer.required = draftContainer.required ?? [];
  });
  updateExpandedPaths((draft: Set<string>): void => {
    draft.add(row.path);
  });
}

/**
 * 删除字段。
 * @param row - schema 字段行
 */
function handleFieldDelete(row: SchemaTreeEditorRow): void {
  updateSchema((draft: WidgetSchemaObject): void => {
    const draftContainer = readSchemaContainer(draft, row.parentPath);
    if (!draftContainer) {
      return;
    }

    delete draftContainer.properties[row.name];
    draftContainer.required = (draftContainer.required ?? []).filter((name: string): boolean => name !== row.name);
  });
  clearDescendantLocalState(row.path);
}

/** 可见 schema 字段行。 */
const schemaRows = computed<SchemaTreeEditorRow[]>(() => collectSchemaRows(schema.value, '', 0));
/** 是否需要展示折叠按钮占位列。 */
const hasToggleColumn = computed<boolean>(() => schemaRows.value.some((row: SchemaTreeEditorRow): boolean => isFoldableSchemaProperty(row.property)));
/** 是否需要展示对象字段添加子项操作列。 */
const hasObjectActionColumn = computed<boolean>(() => schemaRows.value.some((row: SchemaTreeEditorRow): boolean => isObjectSchemaProperty(row.property)));
</script>

<style lang="less" scoped>
.schema-editor {
  --schema-editor-type-width: 100px;

  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;

  .schema-editor__header {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 0 2px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-tertiary);
  }

  .schema-editor__header-name {
    display: flex;
    flex: 1 1 132px;
    gap: 4px;
    align-items: center;
    min-width: 0;
  }

  .schema-editor__header-toggle-placeholder {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
  }

  .schema-editor__header-type {
    flex-shrink: 0;
    width: var(--schema-editor-type-width);
    min-width: var(--schema-editor-type-width);
  }

  .schema-editor__header-controls {
    display: grid;
    flex: 0 0 92px;
    grid-template-columns: 28px 28px 28px;
    gap: 4px;
    align-items: center;
    width: 92px;

    .schema-editor__header-actions {
      grid-column: 2 / 4;
      text-align: right;
    }

    &.is-object {
      flex-basis: 124px;
      grid-template-columns: 28px 28px 28px 28px;
      width: 124px;

      .schema-editor__header-actions {
        grid-column: 2 / 5;
      }
    }
  }

  .schema-editor__header-required {
    text-align: center;
  }

  .schema-editor__rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .schema-editor__row-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;

    &.is-description-expanded {
      padding: 6px;
      background: var(--bg-secondary);
      border-radius: var(--control-radius);
    }
  }

  .schema-editor__row {
    display: flex;
    gap: 8px;
    align-items: center;

    &.is-invalid {
      align-items: start;
    }
  }

  .schema-editor__name-cell {
    display: flex;
    flex: 1 1 132px;
    gap: 4px;
    align-items: center;
    min-width: 0;
    padding-left: calc(var(--schema-editor-depth, 0) * 18px);
  }

  .schema-editor__toggle-placeholder {
    display: block;
    flex-shrink: 0;
    width: 24px;
    height: 24px;
  }

  .schema-editor__name-input {
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;

    :deep(.ant-input),
    :deep(input) {
      box-sizing: border-box;
      width: 100%;
      height: 28px;
      font-size: 12px;
    }
  }

  .schema-editor__type-select {
    flex-shrink: 0;
    width: var(--schema-editor-type-width);
    min-width: var(--schema-editor-type-width);

    :deep(.b-select .ant-select-selection-item),
    :deep(.b-select .ant-select-selection-placeholder) {
      font-size: 12px;
      line-height: 26px;
    }

    :deep(.b-select),
    :deep(.ant-select-selector),
    :deep(.ant-select-selection-item),
    :deep(select) {
      font-size: 12px;
    }

    :deep(.ant-select-selector),
    :deep(select) {
      height: 28px;
    }
  }

  textarea.ant-input {
    padding: 2px 7px;
  }

  .schema-editor__controls {
    display: grid;
    flex: 0 0 92px;
    grid-template-columns: 28px 28px 28px;
    gap: 4px;
    align-items: center;
    width: 92px;

    &.is-object {
      flex-basis: 124px;
      grid-template-columns: 28px 28px 28px 28px;
      width: 124px;
    }
  }

  .schema-editor__control-cell {
    display: flex;
    justify-content: center;
  }

  .schema-editor__field-error {
    margin: 0 0 0 calc(var(--schema-editor-depth, 0) * 18px);
    font-size: 12px;
    line-height: 1.4;
    color: var(--color-danger);
  }

  .schema-editor__description {
    box-sizing: border-box;
    width: 100%;

    :deep(.ant-input),
    :deep(textarea) {
      box-sizing: border-box;
      width: 100%;
      font-size: 12px;
      line-height: 1.5;
      resize: vertical;
    }
  }

  .schema-editor__empty {
    padding: 8px 10px;
    color: var(--text-tertiary);
    background: var(--bg-secondary);
    border: var(--surface-border-width) dashed var(--border-primary);
    border-radius: var(--surface-radius);
  }

  .schema-editor__empty-text {
    font-size: 12px;
  }
}
</style>
