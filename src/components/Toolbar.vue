<template>
  <div class="toolbar">
    <div class="toolbar-left">
      <Dropdown :trigger="['click']">
        <!-- <button class="toolbar-button">
          <span class="button-text">文件</span>
          <svg class="dropdown-icon" width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 4L6 8L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button> -->
        <template #overlay>
          <Menu>
            <MenuItem key="new">
            <template #icon>
              <FileOutlined />
            </template>
            新建
            </MenuItem>
            <MenuItem key="open">
            <template #icon>
              <FolderOpenOutlined />
            </template>
            打开
            </MenuItem>
            <MenuItem key="save">
            <template #icon>
              <SaveOutlined />
            </template>
            保存
            </MenuItem>
            <MenuItem key="saveAs">
            <template #icon>
              <SaveOutlined />
            </template>
            另存为
            </MenuItem>
          </Menu>
        </template>
      </Dropdown>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Dropdown, Menu, MenuItem } from 'ant-design-vue'

const emit = defineEmits([
  'new-file',
  'open-file',
  'save-file',
  'save-file-as'
])

interface MenuClickEvent {
  key: string
}

function handleMenuClick({ key }: MenuClickEvent) {
  switch (key) {
    case 'new':
      emit('new-file')
      break
    case 'open':
      emit('open-file')
      break
    case 'save':
      emit('save-file')
      break
    case 'saveAs':
      emit('save-file-as')
      break
  }
}
</script>

<style scoped>
.toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 24px;
  height: 56px;
  -webkit-app-region: drag;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  -webkit-app-region: no-drag;
}

.toolbar-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  color: #374151;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.toolbar-button:hover {
  background: #f3f4f6;
  border-color: #d1d5db;
}

.button-text {
  user-select: none;
}

:global(.dark) .toolbar-header {
  background: #1f2937;
  border-bottom-color: #374151;
}

:global(.dark) .toolbar-button {
  background: #374151;
  border-color: #4b5563;
  color: #e5e7eb;
}

:global(.dark) .toolbar-button:hover {
  background: #4b5563;
  border-color: #6b7280;
}
</style>