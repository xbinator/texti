/**
 * @file SlashCommandSelect.vue
 * @description BPromptEditor 斜杠命令菜单，负责展示候选项并回传选择结果。
 */
<template>
  <div v-if="visible && commands.length > 0" ref="menuRef" class="slash-command-menu" :style="menuStyle" data-testid="slash-command-menu" @mousedown.prevent>
    <div class="slash-command-menu__header">斜杠命令</div>
    <div class="slash-command-menu__list">
      <div
        v-for="(command, index) in commands"
        :key="command.id"
        class="slash-command-menu__item"
        :class="{ active: activeIndex === index }"
        data-testid="slash-command-item"
        @click="handleSelect(command)"
        @mouseenter="handleMouseEnter(index)"
      >
        <div class="slash-command-menu__item-main">
          <span class="slash-command-menu__item-trigger">{{ command.trigger }}</span>
          <span class="slash-command-menu__item-title">{{ command.title }}</span>
        </div>
        <div class="slash-command-menu__item-desc">{{ command.description }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 斜杠命令元数据。
 */
import type { CSSProperties } from 'vue';
import { nextTick, ref, watch } from 'vue';
import type { SlashCommandOption } from '../types';

/**
 * 斜杠命令菜单属性。
 */
interface Props {
  /** 是否显示菜单。 */
  visible: boolean;
  /** 可选命令列表。 */
  commands: readonly SlashCommandOption[];
  /** 光标位置，用于计算菜单摆放。 */
  position: { top: number; left: number; bottom: number };
  /** 当前高亮项索引。 */
  activeIndex?: number;
}

const props = withDefaults(defineProps<Props>(), {
  activeIndex: 0
});

const emit = defineEmits<{
  (e: 'select', command: SlashCommandOption): void;
  (e: 'update:activeIndex', index: number): void;
}>();

const menuRef = ref<HTMLElement>();
const menuStyle = ref<CSSProperties>({});

/**
 * 重新计算菜单位置，默认优先显示在输入框上方。
 */
watch(
  [() => props.visible, () => props.position, () => props.commands.length],
  async () => {
    if (!props.visible || props.commands.length === 0) return;

    await nextTick();

    const styles: CSSProperties = {
      position: 'fixed',
      maxHeight: '320px',
      minWidth: '280px',
      zIndex: 9999
    };

    const { innerHeight: viewportHeight, innerWidth: viewportWidth } = window;
    const dropdownHeight = menuRef.value?.clientHeight || 0;
    const dropdownWidth = menuRef.value?.clientWidth || 320;
    const gap = 8;
    const { top, left, bottom } = props.position;

    const enoughRoomAbove = top - dropdownHeight - gap >= gap;
    styles.top = `${enoughRoomAbove ? Math.max(gap, top - dropdownHeight - gap) : bottom + gap}px`;

    if (left + dropdownWidth > viewportWidth) {
      styles.left = `${Math.max(gap, viewportWidth - dropdownWidth - gap)}px`;
    } else {
      styles.left = `${Math.max(gap, left)}px`;
    }

    if (dropdownHeight > viewportHeight) {
      styles.maxHeight = `${Math.max(160, viewportHeight - gap * 2)}px`;
    }

    menuStyle.value = styles;
  },
  { immediate: true }
);

/**
 * 选择一个斜杠命令。
 * @param command - 被选择的命令
 */
function handleSelect(command: SlashCommandOption): void {
  emit('select', command);
}

/**
 * 更新当前高亮索引。
 * @param index - 新的高亮索引
 */
function handleMouseEnter(index: number): void {
  emit('update:activeIndex', index);
}
</script>

<style scoped lang="less">
.slash-command-menu {
  position: fixed;
  min-width: 280px;
  max-width: 400px;
  padding: 8px 0;
  overflow: auto;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  box-shadow: 0 6px 16px rgb(0 0 0 / 8%), 0 3px 6px -4px rgb(0 0 0 / 12%), 0 9px 28px 8px rgb(0 0 0 / 5%);
}

.slash-command-menu__header {
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-secondary);
}

.slash-command-menu__list {
  max-height: 280px;
  overflow-y: auto;
}

.slash-command-menu__item {
  padding: 8px 12px;
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover,
  &.active {
    background: var(--bg-secondary);
  }
}

.slash-command-menu__item-main {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.slash-command-menu__item-trigger {
  font-family: 'SF Mono', Monaco, 'Courier New', monospace;
  font-size: 12px;
  color: var(--color-primary);
  background: var(--color-primary-bg);
  border-radius: 4px;
}

.slash-command-menu__item-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.slash-command-menu__item-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>
