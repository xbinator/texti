<!--
  @file ShortcutsHelp.vue
  @description 默认布局快捷键帮助抽屉。
-->
<template>
  <BDrawer v-model:open="visible" :width="500" :get-container="false">
    <template #title>
      <div class="shortcuts-help__title">
        <span>快捷键</span>
      </div>
    </template>

    <div class="shortcuts-help" role="region" aria-label="快捷键速查">
      <section v-for="group in shortcutGroups" :key="group.title" class="shortcuts-help__group">
        <div class="shortcuts-help__group-header">
          <div class="shortcuts-help__group-title-wrap">
            <span class="shortcuts-help__group-icon">
              <BIcon :icon="group.icon" :size="14" />
            </span>
            <div>
              <div class="shortcuts-help__group-title" role="heading" aria-level="3">{{ group.title }}</div>
              <div class="shortcuts-help__group-description">{{ group.description }}</div>
            </div>
          </div>
        </div>

        <div class="shortcuts-help__list" role="list">
          <div v-for="item in group.items" :key="item.label" class="shortcuts-help__item" role="listitem" tabindex="0">
            <span class="shortcuts-help__label">{{ item.label }}</span>
            <div class="shortcuts-help__keys" :aria-label="formatShortcutAriaLabel(item.shortcut)">
              <kbd v-for="(part, index) in getShortcutParts(item.shortcut)" :key="`${part}-${index}`" class="shortcuts-help__key">
                {{ part }}
              </kbd>
            </div>
          </div>
        </div>
      </section>
    </div>
  </BDrawer>
</template>

<script setup lang="ts">
import { EditorShortcuts } from '@/constants/shortcuts';
import { getShortcutParts } from '@/utils/shortcut';

/**
 * 快捷键条目。
 */
interface ShortcutItem {
  /** 操作名称 */
  label: string;
  /** 快捷键组合 */
  shortcut: string;
}

/**
 * 快捷键分组。
 */
interface ShortcutGroup {
  /** 分组标题 */
  title: string;
  /** 分组说明 */
  description: string;
  /** 分组图标 */
  icon: string;
  /** 分组内快捷键列表 */
  items: ShortcutItem[];
}

/** 快捷键帮助分组配置。 */
const shortcutGroups: ShortcutGroup[] = [
  {
    title: '文件操作',
    description: '新建、打开与保存',
    icon: 'lucide:file-text',
    items: [
      { label: '新建文件', shortcut: EditorShortcuts.FILE_NEW },
      { label: '打开文件', shortcut: EditorShortcuts.FILE_OPEN },
      { label: '保存文件', shortcut: EditorShortcuts.FILE_SAVE },
      { label: '另存为', shortcut: EditorShortcuts.FILE_SAVE_AS },
      { label: '复制文件', shortcut: EditorShortcuts.FILE_DUPLICATE },
      { label: '重命名', shortcut: EditorShortcuts.FILE_RENAME },
      { label: '打开最近文件', shortcut: EditorShortcuts.COMMAND_PANEL }
    ]
  },
  {
    title: '编辑操作',
    description: '撤销与重做',
    icon: 'lucide:pencil-line',
    items: [
      { label: '撤销', shortcut: EditorShortcuts.EDIT_UNDO },
      { label: '重做', shortcut: EditorShortcuts.EDIT_REDO }
    ]
  },
  {
    title: '视图操作',
    description: '编辑模式切换',
    icon: 'lucide:panel-top',
    items: [{ label: '源代码模式', shortcut: EditorShortcuts.VIEW_SOURCE }]
  },
  {
    title: '窗口与标签页',
    description: '新建、关闭与切换标签',
    icon: 'lucide:app-window',
    items: [
      { label: '新建文档标签页', shortcut: EditorShortcuts.FILE_NEW },
      { label: '关闭当前标签页', shortcut: EditorShortcuts.TAB_CLOSE },
      { label: '切换到下一个标签页', shortcut: EditorShortcuts.TAB_NEXT }
    ]
  }
];

const visible = defineModel<boolean>('visible', { default: false });

/**
 * 格式化快捷键的无障碍标签。
 * @param shortcut - 快捷键字符串
 * @returns 可读的快捷键说明
 */
function formatShortcutAriaLabel(shortcut: string): string {
  return `快捷键: ${getShortcutParts(shortcut).join(' + ')}`;
}
</script>

<style lang="less" scoped>
.shortcuts-help {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-bottom: 6px;
}

.shortcuts-help__title {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  color: var(--text-primary);
}

.shortcuts-help__group-icon {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: var(--color-primary);
  background: var(--bg-primary);
  border: var(--control-border-width) solid var(--border-primary);
  border-radius: var(--control-radius);
}

.shortcuts-help__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.shortcuts-help__group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
}

.shortcuts-help__group-title-wrap {
  display: flex;
  gap: 9px;
  align-items: center;
  min-width: 0;
}

.shortcuts-help__group-title {
  font-size: 13px;
  font-weight: 650;
  line-height: 1.35;
  color: var(--text-primary);
}

.shortcuts-help__group-description {
  margin-top: 1px;
  font-size: 12px;
  line-height: 1.35;
  color: var(--text-tertiary);
}

.shortcuts-help__list {
  overflow: hidden;
  background: var(--bg-primary);
  border: var(--overlay-border-width) solid var(--border-primary);
  border-radius: var(--overlay-radius);
}

.shortcuts-help__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  min-height: 40px;
  padding: 8px 10px 8px 12px;
  outline: none;
  border-bottom: var(--overlay-border-width) solid var(--border-secondary);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard), box-shadow var(--motion-duration-fast) var(--motion-easing-standard);
}

.shortcuts-help__item:last-child {
  border-bottom: 0;
}

.shortcuts-help__item:hover,
.shortcuts-help__item:focus-visible {
  background: var(--bg-hover);
}

.shortcuts-help__item:focus-visible {
  box-shadow: inset 0 0 0 1px var(--color-primary);
}

.shortcuts-help__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text-secondary);
  white-space: nowrap;
  user-select: none;
}

.shortcuts-help__keys {
  display: inline-flex;
  flex-shrink: 0;
  gap: 4px;
  align-items: center;
}

.shortcuts-help__key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 25px;
  height: 23px;
  padding: 0 7px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 650;
  line-height: 1;
  color: var(--text-primary);
  letter-spacing: 0;
  background: linear-gradient(180deg, var(--bg-primary), var(--bg-secondary));
  border: var(--control-border-width) solid var(--border-primary);
  border-bottom-color: color-mix(in srgb, var(--border-primary) 65%, var(--text-tertiary));
  border-bottom-width: var(--control-border-width);
  border-radius: var(--control-radius);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 8%), 0 1px 1px rgb(0 0 0 / 6%);
}
</style>
