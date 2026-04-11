<template>
  <BDropdown v-model:open="visible">
    <button class="b-dropdown-button" :class="[{ 'is-active': visible, 'is-small': props.size === 'small', 'is-bordered': props.bordered }]">
      <slot>
        <div class="b-dropdown-button-content" :style="{ width }">{{ contentPrefix }}{{ label }}</div>
      </slot>
      <Icon v-if="showIcon" class="dropdown-icon" icon="lucide:chevron-down" :style="{ transform: visible ? 'rotate(180deg)' : 'rotate(0deg)' }" />
    </button>

    <template #overlay>
      <BDropdownMenu v-model:value="active" :options="options" :row-class="rowClass" :width="overlayWidth" @change="handleActiveChange">
        <template #menu="record">
          <slot name="menu" v-bind="record"></slot>
        </template>
      </BDropdownMenu>
    </template>
  </BDropdown>
</template>

<script setup lang="ts" generic="T extends DropdownOption">
import type { DropdownOption, DropdownOptionItem } from './type';
import { computed, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { addCssUnit } from '../../utils/css';

interface Props {
  /** 当前选中的值 */
  value?: string | number;
  /** 是否展开下拉菜单 */
  open?: boolean;
  /** 下拉菜单项的类名 */
  rowClass?: string;
  /** 内容宽度 */
  contentWidth?: string | number;
  /** 下拉选项列表 */
  options?: T[];
  /** 点击菜单项后是否隐藏下拉菜单 */
  menuClickHide?: boolean;
  /** 下拉菜单的类名 */
  overlayClassName?: string;
  /** 内容前缀 */
  contentPrefix?: string;
  /** 尺寸 */
  size?: 'small' | 'middle' | 'large';
  /** 是否显示边框 */
  bordered?: boolean;
  /** 是否显示图标 */
  showIcon?: boolean;
  /** 内容宽度 */
  overlayWidth?: string | number;
}

const props = withDefaults(defineProps<Props>(), {
  options: () => [],
  contentWidth: 'auto',
  rowClass: '',
  value: '',
  menuClickHide: false,
  open: false,
  overlayClassName: '',
  contentPrefix: '',
  size: 'middle',
  bordered: false,
  showIcon: true,
  overlayWidth: 'auto'
});

const emit = defineEmits(['update:value', 'change', 'update:open']);

const active = defineModel<string | number>('value', { default: '' });

const width = computed(() => addCssUnit(props.contentWidth));

const label = computed(() => (props.options.find((el) => el.type === 'item' && active.value === el.value) as DropdownOptionItem)?.label);

const visible = defineModel<boolean>('open', { default: false });

function handleActiveChange(record: DropdownOptionItem) {
  emit('change', record);
}

watch(
  () => props.open,
  (value) => (visible.value = value)
);
</script>

<style scoped>
.b-dropdown-button {
  display: flex;
  gap: 10px;
  align-items: center;
  height: 28px;
  padding: 0 8px;
  font-size: 14px;
  cursor: pointer;
  user-select: none;
  background-color: transparent;
  border-radius: 6px;
  transition: all 0.3s;
}

.b-dropdown-button:hover {
  color: var(--text-primary);
  background-color: var(--bg-active);
}

.b-dropdown-button.is-active {
  color: var(--text-primary);
  background-color: var(--bg-active);
}

.b-dropdown-button.is-small {
  height: 28px;
}

.b-dropdown-button.is-bordered {
  border: 1px solid var(--input-border);
}

.b-dropdown-button-content {
  margin-right: 4px;
}

.dropdown-icon {
  width: 12px;
  height: 12px;
  transition: transform 0.3s;
}
</style>
