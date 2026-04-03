<template>
  <div class="b-dropdown-menu" :style="{ width: typeof width === 'number' ? `${width}px` : width }" @contextmenu.prevent>
    <template v-for="(item, index) in options" :key="index">
      <div v-if="item.type === 'divider'" class="b-dropdown-menu-item-divider"></div>
      <div
        v-else
        class="b-dropdown-menu-item"
        :class="[item.class, rowClass, { disabled: item.disabled, danger: item.danger }, item.color]"
        @click="handleClickMenu(item)"
      >
        <BDropdown v-if="item.children?.length" placement="rightTop" :align="{ targetOffset: [-9, 0] }" :disabled="item.disabled">
          <div class="b-dropdown-menu-item-content">
            <slot name="menu" v-bind="{ record: item }">
              <BTruncateText :text="item.label" />
            </slot>

            <Icon class="b-dropdown-menu-item-arrow" icon="lucide:chevron-right" />
          </div>

          <template #overlay>
            <Menu :options="(item.children as T[])" :row-class="rowClass" :width="width" />
          </template>
        </BDropdown>

        <slot v-else name="menu" v-bind="{ record: item }">
          <BTruncateText :text="item.label" />
        </slot>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts" generic="T extends DropdownOption">
import type { DropdownOption, DropdownOptionItem } from './type';
import { Icon } from '@iconify/vue';
import BTruncateText from '../BTruncateText/index.vue';

interface Props {
  value?: string | number | Array<string | number>;
  /** 下拉选项列表 */
  options: T[];
  /** 下拉菜单项的类名 */
  rowClass?: string;
  /** 内容宽度 */
  width?: string | number;
}

withDefaults(defineProps<Props>(), { value: () => [], rowClass: '', width: 'auto' });

const emit = defineEmits<{
  (e: 'update:value', value: string | number): void;
  (e: 'change', value: DropdownOptionItem): void;
}>();

const active = defineModel<string | number | Array<string | number>>('value', { default: () => [] });

function handleClickMenu(record: DropdownOptionItem) {
  if (record.disabled) return;

  if (!Array.isArray(active.value) && record.value !== active.value) {
    active.value = record.value;
  }

  record.onClick?.();

  emit('change', record);
}
</script>

<style scoped>
.b-dropdown-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  line-height: 32px;
  background: #fff;
  border: 1px solid #e5e6eb;
  border-radius: 6px;
}

.b-dropdown-menu-item {
  display: flex;
  align-items: center;
  padding: 0 8px;
  color: rgb(0 0 0 / 78%);
  cursor: pointer;
  border-radius: 6px;
}

.b-dropdown-menu-item:hover {
  color: rgb(0 0 0 / 78%);
  background-color: #f2f3f5;
}

.b-dropdown-menu-item.disabled {
  cursor: default;
  background-color: rgb(255 255 255 / 0%);
  opacity: 0.3;
}

.b-dropdown-menu-item.danger {
  color: #ff4d4f;
}

.b-dropdown-menu-item-divider {
  height: 1px;
  margin: 3px 8px;
  border-top: 1px solid #e5e6eb;
}

.b-dropdown-menu-item-content {
  display: flex;
  flex: 1;
  align-items: center;
  width: 0;
}
</style>
