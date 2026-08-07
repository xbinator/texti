<template>
  <SelectDropdown
    :visible="dropdownVisible"
    :items="variables"
    :active-index="activeIndex"
    :teleport="teleport"
    :position="position"
    :dropdown-width="dropdownWidth"
    :inline-style="inlineStyle"
    @select="handleSelect"
    @update:active-index="handleMouseEnter"
  >
    <template #item="{ item }">
      <div class="variable-item" :class="{ 'is-without-toggle': !hasToggleButton(item) }" :style="getVariableItemStyle(item)">
        <BButton
          v-if="item.hasChildren"
          type="ghost"
          size="mini"
          square
          :icon="item.expanded ? 'lucide:chevron-down' : 'lucide:chevron-right'"
          @click.stop="handleToggle(item)"
          @mousedown.stop.prevent
        />
        <div class="variable-item-main">
          <span class="variable-item-label">{{ getVariableDisplayValue(item) }}</span>
          <span v-if="item.label" class="variable-item-value">{{ item.label }}</span>
        </div>
        <div v-if="item.description" class="variable-item-desc">
          {{ item.description }}
        </div>
      </div>
    </template>
  </SelectDropdown>
</template>

<script setup lang="ts">
import type { Variable } from '../types';
import type { CSSProperties } from 'vue';
import { computed } from 'vue';
import SelectDropdown from './_SelectDropdown.vue';

/**
 * 变量选择菜单项。
 */
interface VariableSelectItem extends Variable {
  /** 变量树深度 */
  depth?: number;
  /** 是否存在子级变量 */
  hasChildren?: boolean;
  /** 子级变量是否展开 */
  expanded?: boolean;
  /** 是否需要展示折叠按钮占位 */
  showTogglePlaceholder?: boolean;
}

/**
 * 带变量深度 CSS 自定义属性的样式。
 */
type VariableItemStyle = CSSProperties & {
  /** 变量树深度 */
  '--variable-depth': string;
  /** 无折叠按钮叶子项的额外缩进 */
  '--variable-leaf-offset': string;
};

/**
 * VariableSelect 组件属性定义
 */
interface Props {
  /** 是否显示菜单 */
  visible: boolean;
  /** 可选变量列表 */
  variables: VariableSelectItem[];
  /** 锚点位置，用于 Teleport 定位计算 */
  position: { top: number; left: number; bottom: number };
  /** 当前高亮项索引 */
  activeIndex?: number;
  /** 下拉菜单宽度 */
  dropdownWidth?: number;
  /** 是否将下拉菜单传送到 body */
  teleport?: boolean;
  /** 非 Teleport 模式下的下拉样式 */
  inlineStyle?: CSSProperties;
}

const props = withDefaults(defineProps<Props>(), {
  activeIndex: 0,
  dropdownWidth: 300,
  teleport: true,
  inlineStyle: undefined
});

const emit = defineEmits<{
  (e: 'select', variable: Variable): void;
  (e: 'toggle', variable: VariableSelectItem): void;
  (e: 'update:activeIndex', index: number): void;
}>();

/** 变量值末尾的括号路径片段。 */
const BRACKET_PATH_SEGMENT_PATTERN = /\[(\d+|"(?:\\.|[^"\\])*")\]$/u;

/** 仅当存在可选变量时展示下拉菜单，避免无匹配项时出现空白浮层。 */
const dropdownVisible = computed<boolean>(() => props.visible && props.variables.length > 0);

/**
 * 解码 JSON 字符串路径片段。
 * @param segment - 带双引号的路径片段
 * @returns 解码后的路径片段，失败时返回去掉引号的原始文本
 */
function parseQuotedPathSegment(segment: string): string {
  try {
    return JSON.parse(segment) as string;
  } catch {
    return segment.slice(1, -1);
  }
}

/**
 * 读取变量值最后一段路径。
 * @param value - 完整变量值
 * @returns 最后一段路径
 */
function readLastPathSegment(value: string): string {
  const bracketMatch = value.match(BRACKET_PATH_SEGMENT_PATTERN);
  if (bracketMatch) {
    const segment = bracketMatch[1];

    return segment.startsWith('"') ? parseQuotedPathSegment(segment) : segment;
  }

  const lastDotIndex = value.lastIndexOf('.');

  return lastDotIndex >= 0 ? value.slice(lastDotIndex + 1) : value;
}

/**
 * 读取变量菜单展示值。
 * @param item - 变量选择菜单项
 * @returns 展示给用户的变量值
 */
function getVariableDisplayValue(item: VariableSelectItem): string {
  if ((item.depth ?? 0) <= 0) {
    return item.value;
  }

  return readLastPathSegment(item.value);
}

/**
 * 获取变量项缩进样式。
 * @param item - 变量选择菜单项
 * @returns 变量项样式
 */
function getVariableItemStyle(item: VariableSelectItem): VariableItemStyle {
  const depth = item.depth ?? 0;

  return {
    '--variable-depth': String(depth),
    '--variable-leaf-offset': depth > 0 && !item.hasChildren ? '28px' : '0px'
  };
}

/**
 * 判断变量项是否需要展示折叠控制按钮。
 * @param item - 变量选择菜单项
 * @returns 存在子级变量时返回 true
 */
function hasToggleButton(item: VariableSelectItem): boolean {
  return Boolean(item.hasChildren);
}

/**
 * 处理变量选择
 * @param variable - 被选中的变量
 */
function handleSelect(variable: Variable): void {
  emit('select', variable);
}

/**
 * 处理变量树节点展开状态切换。
 * @param variable - 被切换的变量节点
 */
function handleToggle(variable: VariableSelectItem): void {
  emit('toggle', variable);
}

/**
 * 处理鼠标悬停，更新高亮索引
 * @param index - 鼠标悬停项的索引
 */
function handleMouseEnter(index: number): void {
  emit('update:activeIndex', index);
}
</script>

<style scoped lang="less">
.variable-header-icon {
  width: 14px;
  height: 14px;
}

.variable-item {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  column-gap: 4px;
  width: 100%;
  min-width: 0;
  padding-left: calc(var(--variable-depth, 0) * 24px);
}

.variable-item.is-without-toggle {
  grid-template-columns: minmax(0, 1fr);
  padding-left: calc(var(--variable-depth, 0) * 24px + var(--variable-leaf-offset, 0px));
}

.variable-item.is-without-toggle .variable-item-main,
.variable-item.is-without-toggle .variable-item-desc {
  grid-column: 1;
}

.variable-item-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px;
  align-items: center;
  width: 100%;
  min-width: 0;
}

.variable-item-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
  color: var(--text-primary);
  white-space: nowrap;
}

.variable-item-value {
  max-width: 150px;
  padding: 2px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-primary);
  white-space: nowrap;
  background: var(--color-primary-bg);
  border-radius: 4px;
}

.variable-item-desc {
  grid-column: 2;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-tertiary);
  overflow-wrap: anywhere;
}

.variable-empty-state {
  padding: 16px 12px;
  font-size: 13px;
  color: var(--text-tertiary);
  text-align: center;
}
</style>
