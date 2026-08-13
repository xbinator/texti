<!--
  @file Method.vue
  @description 支持选择函数并配置参数的方法动作弹窗。
-->
<template>
  <div :class="name">
    <BDraggable
      v-if="actionEntries.length"
      :class="bem('actions')"
      :list="actionEntries"
      item-key="key"
      item-class="b-smart-method__action-item"
      handle-class="b-smart-method__action-drag-handle"
      @move="handleActionMove"
    >
      <template #default="{ item: entry, handleClass }">
        <div :class="bem('action')">
          <button :class="[bem('action-drag-handle'), handleClass]" type="button" @click.stop>
            <BIcon icon="lucide:grip-vertical" />
          </button>
          <div :class="bem('action-content')">
            <span :class="bem('action-name')">{{ readActionLabel(entry.action) }}</span>
          </div>
          <div :class="bem('action-controls')">
            <BButton type="text" size="mini" square icon="lucide:pencil" @click="editAction(entry.index)" />
            <BButton type="text" size="mini" danger square icon="lucide:trash-2" @click="deleteAction(entry.index)" />
          </div>
        </div>
      </template>
    </BDraggable>

    <BButton :class="bem('trigger')" type="secondary" size="small" icon="lucide:mouse-pointer-click" @click="openModal">
      {{ props.placeholder }}
    </BButton>

    <BModal v-model:open="modalOpen" title="动作设置" :width="720">
      <div :class="bem('content')">
        <div :class="bem('section')">
          <div :class="bem('section-title')">
            <span>函数</span>
          </div>
          <div :class="bem('methods')">
            <button
              v-for="method in methods"
              :key="method.value"
              :class="[bem('method'), { 'is-active': editingAction.method === method.value }]"
              type="button"
              :data-method-value="method.value"
              @click="handleMethodSelect(method)"
            >
              <span :class="bem('method-name')">{{ method.label }}</span>
            </button>
            <div v-if="methods.length === 0" :class="bem('empty')">
              <BIcon icon="lucide:inbox" :class="bem('empty-icon')" />
              <span :class="bem('empty-text')">暂无可用函数</span>
            </div>
          </div>
        </div>

        <div :class="bem('section')">
          <div :class="bem('section-title')">
            <span>参数</span>
            <BButton v-if="editingAction.method" type="secondary" size="mini" icon="lucide:plus" @click="addArgument">添加参数</BButton>
          </div>
          <div :class="bem('args')">
            <div v-for="(_argument, index) in editingAction.args" :key="index" :class="bem('arg')">
              <label :class="bem('arg-label')">{{ readArgumentLabel(index) }}</label>
              <BSmartInput v-model:value="editingAction.args[index]" :options="variables" :placeholder="readArgumentPlaceholder(index)" />
              <BButton :class="bem('arg-remove')" type="text" danger square icon="lucide:trash-2" @click="removeArgument(index)" />
            </div>
            <div v-if="editingAction.args.length === 0" :class="bem('empty')">
              <BIcon icon="lucide:brackets" :class="bem('empty-icon')" />
              <span :class="bem('empty-text')">{{ editingAction.method ? '暂无参数' : '请先选择函数' }}</span>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <BButton type="secondary" @click="closeModal">取消</BButton>
        <BButton @click="confirmAction">确定</BButton>
      </template>
    </BModal>
  </div>
</template>

<script setup lang="ts">
import type { BSmartMethodAction, BSmartMethodOption, BSmartValue, VariableOptionGroup } from './types';
import { computed, ref } from 'vue';
import type { BDraggableMoveEvent } from '@/components/BDraggable/types';
import { createLiteralValue } from '@/components/BSmart/utils/value';
import { normalizeMethodAction, normalizeMethodActions } from '@/components/BWidget/utils/widgetMethods';
import { createNamespace } from '@/utils/namespace';

/**
 * BSmartMethod 组件属性。
 */
interface Props {
  /** 可选方法列表 */
  methods?: BSmartMethodOption[];
  /** 变量候选 */
  variables?: VariableOptionGroup[];
  /** 未配置动作时的按钮文案 */
  placeholder?: string;
}

/**
 * 已配置动作的拖拽展示项。
 */
interface MethodActionEntry {
  /** 拖拽项唯一标识 */
  key: string;
  /** 当前动作下标 */
  index: number;
  /** 方法动作 */
  action: BSmartMethodAction;
}

const props = withDefaults(defineProps<Props>(), {
  methods: (): BSmartMethodOption[] => [],
  variables: (): VariableOptionGroup[] => [],
  placeholder: '设置动作'
});

const modelValue = defineModel<BSmartMethodAction[]>('value', { default: (): BSmartMethodAction[] => [] });
const [name, bem] = createNamespace('smart-method');

/**
 * 创建空方法动作。
 * @returns 空方法动作
 */
function createEmptyMethodAction(): BSmartMethodAction {
  return {
    args: [],
    method: ''
  };
}

/**
 * 复制方法动作，避免拖拽排序时复用外部引用。
 * @param action - 方法动作
 * @returns 方法动作副本
 */
function cloneMethodAction(action: BSmartMethodAction): BSmartMethodAction {
  return {
    args: action.args.map((argument: BSmartValue<string>): BSmartValue<string> => ({ ...argument })),
    method: action.method
  };
}

/** 弹窗是否打开。 */
const modalOpen = ref(false);
/** 弹窗内正在编辑的方法动作副本。 */
const editingAction = ref<BSmartMethodAction>(createEmptyMethodAction());
/** 当前编辑的已配置动作下标，null 表示新增动作。 */
const editingActionIndex = ref<number | null>(null);
/** 当前选中的方法选项。 */
const selectedMethod = computed<BSmartMethodOption | undefined>((): BSmartMethodOption | undefined =>
  props.methods.find((method: BSmartMethodOption): boolean => method.value === editingAction.value.method)
);

/** 已配置动作列表。 */
const actions = computed<BSmartMethodAction[]>((): BSmartMethodAction[] => normalizeMethodActions(modelValue.value));
/** 已配置动作的拖拽展示项。 */
const actionEntries = computed<MethodActionEntry[]>((): MethodActionEntry[] =>
  actions.value.map(
    (action: BSmartMethodAction, index: number): MethodActionEntry => ({
      action,
      index,
      key: `action-${index}`
    })
  )
);

/**
 * 写入弹窗编辑动作。
 * @param nextAction - 方法动作
 */
function writeEditingAction(nextAction: BSmartMethodAction | null): void {
  editingAction.value = nextAction ? cloneMethodAction(nextAction) : createEmptyMethodAction();
}

/**
 * 处理已配置动作拖拽排序。
 * @param event - 拖拽排序事件
 */
function handleActionMove(event: BDraggableMoveEvent<MethodActionEntry>): void {
  modelValue.value = event.nextList.map((entry: MethodActionEntry): BSmartMethodAction => cloneMethodAction(entry.action));
}

/**
 * 读取方法参数列表。
 * @param method - 方法选项
 * @returns 参数名列表
 */
function readMethodParameters(method: BSmartMethodOption | undefined): string[] {
  return method?.parameters ?? [];
}

/**
 * 读取动作标签。
 * @param action - 方法动作
 * @returns 动作标签
 */
function readActionLabel(action: BSmartMethodAction): string {
  return action.method || '未选择函数';
}

/**
 * 读取参数标签。
 * @param index - 参数下标
 * @returns 参数标签
 */
function readArgumentLabel(index: number): string {
  return readMethodParameters(selectedMethod.value)[index] ?? `参数 ${index + 1}`;
}

/**
 * 读取参数输入占位。
 * @param index - 参数下标
 * @returns 参数输入占位
 */
function readArgumentPlaceholder(index: number): string {
  return `${readArgumentLabel(index)}，可选择变量`;
}

/**
 * 打开弹窗。
 */
function openModal(): void {
  editingActionIndex.value = null;
  writeEditingAction(null);
  modalOpen.value = true;
}

/**
 * 编辑指定动作。
 * @param index - 动作下标
 */
function editAction(index: number): void {
  editingActionIndex.value = index;
  writeEditingAction(actions.value[index] ?? null);
  modalOpen.value = true;
}

/**
 * 删除指定动作。
 * @param index - 动作下标
 */
function deleteAction(index: number): void {
  modelValue.value = actions.value.filter((_action: BSmartMethodAction, currentIndex: number): boolean => currentIndex !== index);
}

/**
 * 关闭弹窗。
 */
function closeModal(): void {
  modalOpen.value = false;
}

/**
 * 选择方法并按方法参数补足参数行。
 * @param method - 方法选项
 */
function handleMethodSelect(method: BSmartMethodOption): void {
  const parameters = readMethodParameters(method);
  const preservedArgs = editingAction.value.args.map((argument: BSmartValue<string>): BSmartValue<string> => ({ ...argument }));
  const missingParameterCount = parameters.length - preservedArgs.length;
  const nextArgs =
    missingParameterCount > 0
      ? [...preservedArgs, ...Array.from({ length: missingParameterCount }, (): BSmartValue<string> => createLiteralValue(''))]
      : preservedArgs;

  editingAction.value = {
    args: nextArgs,
    method: method.value
  };
}

/**
 * 新增参数。
 */
function addArgument(): void {
  editingAction.value = {
    args: [...editingAction.value.args, createLiteralValue('')],
    method: editingAction.value.method
  };
}

/**
 * 删除参数。
 * @param index - 参数下标
 */
function removeArgument(index: number): void {
  editingAction.value = {
    args: editingAction.value.args.filter((_argument: BSmartValue<string>, currentIndex: number): boolean => currentIndex !== index),
    method: editingAction.value.method
  };
}

/**
 * 确认方法动作配置。
 */
function confirmAction(): void {
  const nextAction = normalizeMethodAction(editingAction.value);

  if (editingActionIndex.value === null) {
    modelValue.value = nextAction ? [...actions.value, nextAction] : actions.value;
    modalOpen.value = false;
    return;
  }

  modelValue.value = actions.value.flatMap((action: BSmartMethodAction, index: number): BSmartMethodAction[] => {
    if (index !== editingActionIndex.value) {
      return [action];
    }

    return nextAction ? [nextAction] : [];
  });
  modalOpen.value = false;
}
</script>

<style lang="less" scoped>
.b-smart-method {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  min-width: 0;
}

.b-smart-method__trigger {
  max-width: 100%;
}

.b-smart-method__actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.b-smart-method__action {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  gap: 4px;
  align-items: center;
  min-width: 0;
  min-height: 32px;
  padding: 0 4px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
}

.b-smart-method__action:hover .b-smart-method__action-controls,
.b-smart-method__action:focus-within .b-smart-method__action-controls {
  pointer-events: auto;
  opacity: 1;
}

.b-smart-method__action-drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 24px;
  padding: 0;
  color: var(--text-tertiary);
  appearance: none;
  cursor: grab;
  background: transparent;
  border: 0;
  opacity: 0.72;
  transition: all 0.16s ease;

  &:hover,
  &:focus-visible {
    color: var(--color-primary);
    opacity: 1;
  }

  &:active {
    cursor: grabbing;
  }
}

.b-smart-method__action-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  min-width: 0;
}

.b-smart-method__action-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--text-primary);
  white-space: nowrap;
}

.b-smart-method__action-controls {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
  align-items: center;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.16s ease;
}

.b-smart-method__arg-remove {
  flex-shrink: 0;
}

.b-smart-method__content {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.b-smart-method__section {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 360px;
  overflow: hidden;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
}

.b-smart-method__section-title {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  min-height: 36px;
  padding: 0 10px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-primary);
}

.b-smart-method__methods {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  padding: 10px;
  overflow-y: auto;
}

.b-smart-method__method {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  min-height: 32px;
  padding: 0 10px;
  color: var(--text-secondary);
  cursor: pointer;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 6px;

  &:hover,
  &.is-active {
    color: var(--color-primary);
    background: var(--color-primary-bg);
    border-color: var(--color-primary-border);
  }
}

.b-smart-method__method-name {
  font-size: 13px;
  color: inherit;
}

.b-smart-method__method-meta {
  font-size: 12px;
  color: var(--text-tertiary);
}

.b-smart-method__empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  padding: 24px 12px;
  color: var(--text-tertiary);
}

.b-smart-method__empty-icon {
  width: 28px;
  height: 28px;
  opacity: 0.4;
}

.b-smart-method__empty-text {
  font-size: 13px;
}

.b-smart-method__args {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  padding: 10px;
  overflow-y: auto;
}

.b-smart-method__arg {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr) 28px;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.b-smart-method__arg-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
}
</style>
