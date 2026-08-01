<!--
  @file FrontMatterBlock.vue
  @description BEditor Rich 模式 Front Matter NodeView，负责元数据编辑、整体选中与节点属性同步。
-->
<template>
  <NodeViewWrapper as="section" class="b-markdown-frontmatter-node" :class="{ 'is-selected': selected }" contenteditable="false" @mousedown="handleMouseDown">
    <div :class="name">
      <div :class="bem('header')">
        <span :class="bem('title')">元数据</span>
        <div data-export-ignore :class="bem('actions')">
          <button :class="[bem('action-btn')]" @click="collapsed = !collapsed">
            <BIcon :icon="collapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'" />
          </button>
        </div>
      </div>

      <div v-show="!collapsed" :class="bem('content')">
        <div v-for="(value, key) in frontMatterData" :key="key" :class="bem('item')">
          <input
            v-if="editingKey === key"
            v-model="editKeyInput"
            v-focus="{ selectAll: true }"
            :class="bem('key', 'editing')"
            placeholder="键名"
            @blur="handleKeyEditComplete(String(key))"
            @keydown.enter="handleKeyEditComplete(String(key))"
            @keydown.escape="cancelKeyEdit"
          />
          <div v-else :class="bem('key')" @dblclick="startKeyEdit(String(key))">
            {{ key }}
          </div>

          <div :class="bem('value-wrapper')">
            <AInput
              v-if="isSimpleValue(value)"
              :value="getInputValue(String(key))"
              :class="bem('value')"
              placeholder="值"
              @change="(v) => handleInputChange(String(key), v.target.value)"
            />
            <ADatePicker
              v-else-if="isDateValue(value)"
              :value="getDatePickerValue(String(key))"
              :class="bem('value')"
              show-time
              value-format="YYYY-MM-DD"
              input-read-only
              placeholder="选择日期"
              @change="(v) => handleDateChange(String(key), v)"
            />
            <div v-else :class="[bem('value'), bem('value', 'complex')]" @click="toggleComplexEdit(String(key))">
              {{ formatComplexValue(value) }}
            </div>
          </div>

          <button :class="bem('delete')" data-export-ignore title="删除" @click="handleDeleteField(String(key))">
            <BIcon icon="mdi:close" />
          </button>
        </div>

        <div data-export-ignore :class="bem('add-row')">
          <input v-model="newKey" :class="[bem('key'), bem('new-key')]" placeholder="新键名" @keydown.enter="confirmAddField" />
          <input v-model="newValue" :class="[bem('value'), bem('new-value')]" placeholder="新值" @keydown.enter="confirmAddField" />
          <button :class="[bem('action-btn'), bem('add-btn')]" title="添加" :disabled="!newKey.trim()" @click="confirmAddField">
            <BIcon icon="mdi:check" />
          </button>
        </div>
      </div>

      <BModal v-model:open="complexEditOpen" title="编辑元数据值" :width="520">
        <ATextarea v-model:value="complexEditValue" :autosize="{ minRows: 16, maxRows: 20 }" placeholder="输入 YAML 格式的值" />
        <template #footer>
          <BButton type="secondary" @click="cancelComplexEdit">取消</BButton>
          <BButton @click="confirmComplexEditInline">确定</BButton>
        </template>
      </BModal>
    </div>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import type { FrontMatterData } from '../hooks/useFrontMatter';
import { computed, ref, watch } from 'vue';
import { NodeSelection } from '@tiptap/pm/state';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import dayjs from 'dayjs';
import yaml from 'js-yaml';
import { vFocus } from '@/directives/focus';
import { createNamespace } from '@/utils/namespace';

const [name, bem] = createNamespace('', 'b-markdown-frontmatter');
const props = defineProps(nodeViewProps);

const collapsed = ref(false);
const localData = ref<Record<string, unknown>>({});
const editingKey = ref<string | null>(null);
const editKeyInput = ref('');
const newKey = ref('');
const newValue = ref('');
const complexEditingKey = ref<string | null>(null);
const complexEditValue = ref('');

const complexEditOpen = computed<boolean>({
  get: (): boolean => complexEditingKey.value !== null,
  set: (val: boolean): void => {
    if (!val) {
      complexEditingKey.value = null;
      complexEditValue.value = '';
    }
  }
});

const frontMatterData = computed<FrontMatterData>((): FrontMatterData => {
  const {
    attrs: { data }
  } = props.node;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as FrontMatterData;
  }

  return {};
});

watch(
  frontMatterData,
  (newData: FrontMatterData): void => {
    localData.value = { ...newData };
  },
  { deep: true, immediate: true }
);

/**
 * 判断当前点击目标是否属于可编辑表单控件。
 * @param target - 鼠标事件目标
 * @returns 命中表单控件时返回 true
 */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest('input, textarea, button, [role="button"], .ant-picker, .ant-select'));
}

/**
 * 判断字段值是否能用单行输入框直接编辑。
 * @param value - 待判断的字段值
 * @returns 简单标量值返回 true
 */
function isSimpleValue(value: unknown): boolean {
  return ['string', 'number', 'boolean'].includes(typeof value);
}

/**
 * 判断字段值是否为日期对象。
 * @param value - 待判断的字段值
 * @returns Date 实例返回 true
 */
function isDateValue(value: unknown): boolean {
  return value instanceof Date;
}

/**
 * 格式化复杂字段值的折叠态摘要。
 * @param value - 复杂字段值
 * @returns 展示在编辑器内的摘要文本
 */
function formatComplexValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.length} 项]`;
  }
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value).length} 个属性}`;
  }
  return String(value);
}

/**
 * 获取可用于 AInput 绑定的简单值。
 * @param key - 字段名
 * @returns 字符串、数字或 undefined
 */
function getInputValue(key: string): string | number | undefined {
  const value = localData.value[key];
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  return undefined;
}

/**
 * 获取可用于 ADatePicker 绑定的日期字符串。
 * @param key - 字段名
 * @returns 日期字符串或 undefined
 */
function getDatePickerValue(key: string): string | undefined {
  const value = localData.value[key];
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

/**
 * 整体选中 Front Matter 节点，交给 ProseMirror 处理 Delete/Undo 等编辑语义。
 * @param event - 鼠标按下事件
 */
function handleMouseDown(event: MouseEvent): void {
  if (isInteractiveTarget(event.target)) {
    return;
  }

  const position = props.getPos();
  if (typeof position !== 'number') {
    return;
  }

  event.preventDefault();
  props.editor.view.dispatch(props.editor.state.tr.setSelection(NodeSelection.create(props.editor.state.doc, position)));
}

/**
 * 更新完整 Front Matter 数据。
 * @param data - 新的 Front Matter 数据
 */
function handleFrontMatterUpdate(data: FrontMatterData): void {
  props.updateAttributes({ data, parseError: false, raw: null });
}

/**
 * 更新 Front Matter 字段。
 * @param key - 字段名
 * @param value - 字段值
 */
function handleFrontMatterFieldUpdate(key: string, value: unknown): void {
  props.updateAttributes({
    data: {
      ...frontMatterData.value,
      [key]: value
    },
    parseError: false,
    raw: null
  });
}

/**
 * 删除 Front Matter 字段。
 * @param key - 字段名
 */
function handleFrontMatterFieldRemove(key: string): void {
  const nextData = { ...frontMatterData.value };
  delete nextData[key];
  props.updateAttributes({ data: nextData, parseError: false, raw: null });
}

/**
 * 新增 Front Matter 字段。
 * @param key - 字段名
 * @param value - 字段值
 */
function handleFrontMatterFieldAdd(key: string, value: unknown): void {
  if (key in frontMatterData.value) {
    return;
  }

  props.updateAttributes({
    data: {
      ...frontMatterData.value,
      [key]: value
    },
    parseError: false,
    raw: null
  });
}

/**
 * 处理单行输入框值变更。
 * @param key - 字段名
 * @param value - 输入框字符串值
 */
function handleInputChange(key: string, value?: string): void {
  localData.value[key] = value;
  handleFrontMatterFieldUpdate(key, value);
}

/**
 * 处理日期选择器值变更。
 * @param key - 字段名
 * @param value - 日期选择器返回值
 */
function handleDateChange(key: string, value: dayjs.Dayjs | Date | string | null): void {
  localData.value[key] = value;
  handleFrontMatterFieldUpdate(key, value);
}

/**
 * 开始编辑字段名。
 * @param key - 当前字段名
 */
function startKeyEdit(key: string): void {
  editingKey.value = key;
  editKeyInput.value = key;
}

/**
 * 取消字段名编辑并清理输入状态。
 */
function cancelKeyEdit(): void {
  editingKey.value = null;
  editKeyInput.value = '';
}

/**
 * 完成字段名编辑，并保持字段顺序不变。
 * @param oldKey - 修改前的字段名
 */
function handleKeyEditComplete(oldKey: string): void {
  const editedKey = editKeyInput.value.trim();

  if (!editedKey || editedKey === oldKey) {
    cancelKeyEdit();
    return;
  }

  if (editedKey in frontMatterData.value) {
    cancelKeyEdit();
    return;
  }

  const nextData: FrontMatterData = {};
  Object.entries(frontMatterData.value).forEach(([key, value]): void => {
    if (key === oldKey) {
      nextData[editedKey] = value;
    } else {
      nextData[key] = value;
    }
  });

  handleFrontMatterUpdate(nextData);
  cancelKeyEdit();
}

/**
 * 删除单个字段，但保留 Front Matter 节点本身。
 * @param key - 字段名
 */
function handleDeleteField(key: string): void {
  handleFrontMatterFieldRemove(key);
}

/**
 * 确认新增字段，并在用户输入 YAML 片段时尝试解析为结构化值。
 */
function confirmAddField(): void {
  const key = newKey.value.trim();
  if (!key) {
    return;
  }

  let parsedValue: unknown = newValue.value;
  if (newValue.value.includes('\n') || newValue.value.includes(':')) {
    try {
      parsedValue = yaml.load(newValue.value);
    } catch {
      parsedValue = newValue.value;
    }
  }

  handleFrontMatterFieldAdd(key, parsedValue);
  newKey.value = '';
  newValue.value = '';
}

/**
 * 打开或关闭复杂值 YAML 编辑弹窗。
 * @param key - 字段名
 */
function toggleComplexEdit(key: string): void {
  if (complexEditingKey.value === key) {
    complexEditOpen.value = false;
    return;
  }

  const value = frontMatterData.value[key];
  complexEditingKey.value = key;
  complexEditValue.value = yaml.dump(value, { indent: 2, lineWidth: -1 }).trim();
}

/**
 * 取消复杂值编辑。
 */
function cancelComplexEdit(): void {
  complexEditOpen.value = false;
}

/**
 * 确认复杂值编辑，优先按 YAML 解析，失败时回退为原始字符串。
 */
function confirmComplexEditInline(): void {
  if (!complexEditingKey.value) {
    return;
  }

  try {
    const value = yaml.load(complexEditValue.value);
    handleFrontMatterFieldUpdate(complexEditingKey.value, value);
  } catch {
    handleFrontMatterFieldUpdate(complexEditingKey.value, complexEditValue.value);
  }
  complexEditOpen.value = false;
}
</script>

<style lang="less" scoped>
.b-markdown-frontmatter-node {
  display: block;
}

.b-markdown-frontmatter-node.is-selected :deep(.b-markdown-frontmatter) {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 18%, transparent);
}

.b-markdown-frontmatter {
  margin-bottom: 25px;
  background: var(--frontmatter-bg);
  border: var(--surface-border-width) solid var(--frontmatter-border);
  border-radius: var(--surface-radius);
  transition: border-color var(--motion-duration-base) var(--motion-easing-standard), box-shadow var(--motion-duration-base) var(--motion-easing-standard),
    background var(--motion-duration-base) var(--motion-easing-standard);
}

.b-markdown-frontmatter__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 42px;
  padding: 0 14px;
}

.b-markdown-frontmatter__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--frontmatter-key-text);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.b-markdown-frontmatter__actions {
  display: flex;
  gap: 4px;
}

.b-markdown-frontmatter__action-btn {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  font-size: 16px;
  color: var(--tag-secondary-text);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--control-radius);
  transition: color var(--motion-duration-base) var(--motion-easing-standard), background var(--motion-duration-base) var(--motion-easing-standard);

  &:hover {
    color: var(--tag-text);
    background: var(--tag-hover-bg);
  }
}

.b-markdown-frontmatter__content {
  padding: 8px 14px;
  border-top: var(--surface-border-width) solid var(--frontmatter-border);
}

.b-markdown-frontmatter__item {
  position: relative;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 0;
}

.b-markdown-frontmatter__key {
  box-sizing: border-box;
  min-width: 80px;
  max-width: 150px;
  height: 28px;
  padding: 0 8px;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  line-height: 28px;
  color: var(--color-purple);
  cursor: pointer;
  background: var(--color-purple-bg);
  border: var(--control-border-width) solid transparent;
  border-radius: var(--control-radius);
  transition: border-color var(--motion-duration-base) var(--motion-easing-standard);

  &:hover {
    border-color: var(--color-purple-border);
  }

  &--editing {
    width: 120px;
    outline: none;
    background: var(--bg-primary);
    border-color: var(--color-purple);
  }
}

.b-markdown-frontmatter__value-wrapper {
  flex: 1;
  min-width: 0;
}

.b-markdown-frontmatter__value {
  box-sizing: border-box;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  font-size: 13px;
  line-height: 24px;
  color: var(--frontmatter-value-text);
  outline: none;
  background: var(--bg-primary);
  border: var(--control-border-width) solid var(--border-primary);
  border-radius: var(--control-radius);
  transition: border-color var(--motion-duration-base) var(--motion-easing-standard);

  &:focus {
    border-color: var(--color-purple);
  }

  &--complex {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 28px;
    color: var(--tag-secondary-text);
    cursor: pointer;
    background: var(--tag-bg);

    &:hover {
      background: var(--tag-hover-bg);
    }
  }
}

.b-markdown-frontmatter__delete {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  font-size: 14px;
  color: var(--tag-placeholder);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--control-radius);
  opacity: 0;
  transition: color var(--motion-duration-base) var(--motion-easing-standard), background var(--motion-duration-base) var(--motion-easing-standard),
    opacity var(--motion-duration-base) var(--motion-easing-standard);

  &:hover {
    color: var(--color-error);
    background: var(--color-error-bg);
  }
}

.b-markdown-frontmatter__item:hover .b-markdown-frontmatter__delete {
  opacity: 1;
}

.b-markdown-frontmatter__add-row {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 0 0;
  margin-top: 8px;
  border-top: var(--surface-border-width) dashed var(--frontmatter-divider);

  &:first-child {
    padding-top: 0;
    margin-top: 0;
    border-top: none;
  }
}

.b-markdown-frontmatter__new-key {
  background: var(--bg-primary);
  border: var(--control-border-width) solid var(--border-primary);
}

.b-markdown-frontmatter__new-value {
  background: var(--bg-primary);
}

.b-markdown-frontmatter__add-btn {
  opacity: 0.5;

  &:not(:disabled):hover {
    color: var(--color-success);
    background: var(--color-success-bg);
    opacity: 1;
  }

  &:disabled {
    cursor: not-allowed;
  }
}
</style>
