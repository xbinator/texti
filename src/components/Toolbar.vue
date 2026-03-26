<template>
  <div class="toolbar">
    <div class="toolbar-left">
      <BDropdownButton :show-icon="false" :options="menuOptions" :min-width="220" @change="handleMenuChange">
        <div>文件</div>

        <template #menu="{ record }">
          <span>{{ record.label }}</span>
        </template>
      </BDropdownButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { DropdownOption } from './BDropdown/type';

const emit = defineEmits(['new-file', 'open-file', 'save-file', 'save-file-as']);

const menuOptions: DropdownOption[] = [
  { value: 'new', label: '新建' },
  { value: 'open', label: '打开' },
  { value: 'save', label: '保存' },
  { value: 'saveAs', label: '另存为' }
];

function handleMenuChange(record: DropdownOption) {
  switch (record.value) {
    case 'new':
      emit('new-file');
      break;
    case 'open':
      emit('open-file');
      break;
    case 'save':
      emit('save-file');
      break;
    case 'saveAs':
      emit('save-file-as');
      break;
    default:
      break;
  }
}
</script>

<style scoped>
.toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  height: 56px;
  padding: 0 24px;
  -webkit-app-region: drag;
}

.toolbar-left {
  display: flex;
  gap: 8px;
  align-items: center;
  -webkit-app-region: no-drag;
}
</style>
