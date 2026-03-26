<template>
  <BDropdown v-model:open="visible">
    <div class="b-dropdown-button" :class="[{ 'is-active': visible, 'is-small': props.size === 'small', 'is-bordered': props.bordered }]">
      <slot>
        <div class="b-dropdown-button-content" :style="{ width }">{{ contentPrefix }}{{ label }}</div>
      </slot>

      <Icon v-if="showIcon" class="dropdown-icon" icon="lucide:chevron-down" :style="{ transform: visible ? 'rotate(180deg)' : 'rotate(0deg)' }" />
    </div>

    <template #overlay>
      <BDropdownMenu v-model:value="active" :options="options" :row-class="rowClass" :min-width="minWidth" @change="handleActiveChange">
        <template #menu="record">
          <slot name="menu" v-bind="record"></slot>
        </template>
      </BDropdownMenu>
    </template>
  </BDropdown>
</template>

<script setup lang="ts">
import type { DropdownOption } from './type';
import { computed, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { addCssUnit } from '../../utils/common';

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
  options?: DropdownOption[];
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
  /** 最小宽度 */
  minWidth?: string | number;
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
  minWidth: 'auto'
});

const emit = defineEmits(['update:value', 'change', 'update:open']);

const active = defineModel<string | number>('value', { default: '' });

const width = computed(() => addCssUnit(props.contentWidth));

const label = computed(() => props.options.find((el) => active.value === el.value)?.label);

const visible = defineModel<boolean>('open', { default: false });

function handleActiveChange(record: DropdownOption) {
  props.menuClickHide && (visible.value = false);

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
  height: 32px;
  padding: 0 10px;
  font-size: 14px;
  color: rgb(0 0 0 / 65%);
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.3s;
}

.b-dropdown-button:hover {
  color: rgb(0 0 0 / 88%);
  background-color: rgb(68 83 130 / 10%);
}

.b-dropdown-button.is-active {
  color: rgb(0 0 0 / 88%);
  background-color: rgb(68 83 130 / 10%);
}

.b-dropdown-button.is-small {
  height: 28px;
}

.b-dropdown-button.is-bordered {
  border: 1px solid #d9d9d9;
}

.b-dropdown-button-content {
  margin-right: 4px;
}

.dropdown-icon {
  width: 12px;
  height: 12px;
  transition: transform 0.3s;
}

:global(.dark) .b-dropdown-button {
  color: rgb(255 255 255 / 65%);
}

:global(.dark) .b-dropdown-button:hover {
  color: rgb(255 255 255 / 88%);
  background-color: rgb(255 255 255 / 10%);
}

:global(.dark) .b-dropdown-button.is-active {
  color: rgb(255 255 255 / 88%);
  background-color: rgb(255 255 255 / 10%);
}

:global(.dark) .b-dropdown-button.is-bordered {
  border-color: #4b5563;
}
</style>
