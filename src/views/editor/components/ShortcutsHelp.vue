<template>
  <Drawer v-model:open="visible" placement="right" :width="480" :closable="false" :mask-closable="true" :keyboard="true">
    <template #title>
      <span>快捷键</span>
    </template>
    <template #extra>
      <button type="button" class="drawer-close-btn" @click="visible = false">
        <Icon icon="lucide:x" />
      </button>
    </template>
    <BScrollbar class="shortcuts-dialog">
      <div v-for="group in shortcutGroups" :key="group.title" class="shortcut-group">
        <div class="shortcut-group-title" role="heading" aria-level="3">{{ group.title }}</div>
        <div class="shortcut-list" role="list">
          <div v-for="item in group.items" :key="item.label" class="shortcut-item" role="listitem" tabindex="0">
            <span class="shortcut-label">{{ item.label }}</span>
            <div class="shortcut-keys" :aria-label="`快捷键: ${item.shortcut}`">
              <kbd v-for="(part, index) in getShortcutParts(item.shortcut)" :key="`${part}-${index}`" class="shortcut-key">
                {{ part }}
              </kbd>
            </div>
          </div>
        </div>
      </div>
    </BScrollbar>
  </Drawer>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';
import { Drawer } from 'ant-design-vue';
import BScrollbar from '@/components/BScrollbar/index.vue';
import { getShortcutParts } from '@/utils/shortcut';
import { EditorShortcuts } from '../constants/shortcuts';

interface ShortcutItem {
  label: string;
  shortcut: string;
}

interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: '文件操作',
    items: [
      { label: '新建文件', shortcut: EditorShortcuts.FILE_NEW },
      { label: '打开文件', shortcut: EditorShortcuts.FILE_OPEN },
      { label: '保存文件', shortcut: EditorShortcuts.FILE_SAVE },
      { label: '另存为', shortcut: EditorShortcuts.FILE_SAVE_AS },
      { label: '复制文件', shortcut: EditorShortcuts.FILE_DUPLICATE },
      { label: '重命名', shortcut: EditorShortcuts.FILE_RENAME },
      { label: '最近文件', shortcut: EditorShortcuts.FILE_RECENT_MORE }
    ]
  },
  {
    title: '编辑操作',
    items: [
      { label: '撤销', shortcut: EditorShortcuts.EDIT_UNDO },
      { label: '重做', shortcut: EditorShortcuts.EDIT_REDO },
      { label: '查找', shortcut: EditorShortcuts.EDIT_FIND }
    ]
  },
  {
    title: '视图操作',
    items: [{ label: '源代码模式', shortcut: EditorShortcuts.VIEW_SOURCE }]
  }
];

const visible = defineModel<boolean>('visible', { default: false });
</script>

<style lang="less" scoped>
.drawer-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: 16px;
  color: var(--text-secondary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 6px;
  transition: background-color 0.15s ease, color 0.15s ease;

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
}

.shortcuts-dialog {
  height: calc(100vh - 110px);
}

.shortcut-group {
  margin-bottom: 24px;

  &:last-child {
    margin-bottom: 4px;
  }
}

.shortcut-group-title {
  display: flex;
  gap: 8px;
  align-items: center;
  padding-bottom: 10px;
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 1.2px;
  border-bottom: 1px solid var(--border-secondary);
}

.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.shortcut-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border: 1px solid transparent;
  border-radius: 8px;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
}

.shortcut-label {
  font-size: 13px;
  line-height: 1.4;
  color: var(--text-secondary);
  user-select: none;
}

.shortcut-keys {
  display: flex;
  flex-shrink: 0;
  gap: 3px;
  align-items: center;
  margin-left: 12px;
}

.shortcut-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 22px;
  padding: 0 6px;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-bottom-width: 2px;
  border-radius: 4px;
  box-shadow: 0 1px 0 rgb(0 0 0 / 8%), inset 0 1px 0 rgb(255 255 255 / 6%);
  transition: box-shadow 0.1s ease;
}
</style>
