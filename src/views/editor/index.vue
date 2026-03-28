<template>
  <div class="editor-layout">
    <div class="editor-header">
      <div class="header-left">
        <Toolbar :title="'文件'" :options="toolbarMenuOptions" />
      </div>

      <div class="header-right">
        <span class="file-name">{{ currentFileName }}</span>
      </div>
    </div>

    <div class="editor-content">
      <BEditor v-model="sourceFile.content" />
    </div>

    <Modal v-model:open="confirmVisible" title="确认" @ok="handleConfirmOk" @cancel="handleConfirmCancel">
      <p>当前文档有未保存的修改，是否保存？</p>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Modal } from 'ant-design-vue';
import Toolbar from '@/components/Toolbar.vue';
import type { File } from '@/utils/native';
import { useToolbar } from './hooks/useToolbar';

const currentFilePath = ref<string | null>(null);

const isModified = ref(false);
const sourceFile = ref<Partial<File>>({});
const confirmVisible = ref(false);
const confirmCallback = ref<(() => Promise<void>) | null>(null);

const currentFileName = computed(() => {
  if (!currentFilePath.value) {
    return isModified.value ? '未命名 *' : '未命名';
  }

  const fileName = currentFilePath.value.split(/[/\\]/).pop() || '未命名';
  return isModified.value ? `${fileName} *` : fileName;
});

async function handleConfirmOk() {
  if (confirmCallback.value) {
    await confirmCallback.value();
  }

  confirmCallback.value = null;
  confirmVisible.value = false;
}

function handleConfirmCancel() {
  confirmCallback.value = null;
  confirmVisible.value = false;
}

const { toolbarMenuOptions } = useToolbar(sourceFile);
</script>

<style scoped>
.editor-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f5f5f5;
}

/* 顶部工具栏 */
.editor-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 20px;
  background: #fff;
}

.header-left {
  display: flex;
  align-items: center;
}

.header-right {
  display: flex;
  align-items: center;
}

.file-name {
  font-size: 14px;
  font-weight: 500;
  color: #57606a;
}

.editor-content {
  flex: 1;
  height: 0;
  margin: 6px;
  overflow: hidden;
  background: #fff;
  border-radius: 8px;
}
</style>
