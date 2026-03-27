<template>
  <div class="editor-layout">
    <div class="editor-header">
      <div class="header-left">
        <Toolbar @new-file="newFile" @open-file="openFile" @save-file="saveFile" @save-file-as="saveFileAs" />
      </div>

      <div class="header-right">
        <span class="file-name">{{ currentFileName }}</span>
      </div>
    </div>

    <div class="editor-content">
      <BEditor v-model="editorContent" />
    </div>

    <Modal v-model:open="confirmVisible" title="确认" @ok="handleConfirmOk" @cancel="handleConfirmCancel">
      <p>当前文档有未保存的修改，是否保存？</p>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import { Modal } from 'ant-design-vue';
import Toolbar from '../../components/Toolbar.vue';
import { fileAPI } from '../../utils/file';

const currentFilePath = ref<string | null>(null);
const lastSavedContent = ref('');
const isModified = ref(false);
const editorContent = ref('');
const confirmVisible = ref(false);
const confirmCallback = ref<(() => Promise<void>) | null>(null);

const currentFileName = computed(() => {
  if (!currentFilePath.value) {
    return isModified.value ? '未命名 *' : '未命名';
  }

  const fileName = currentFilePath.value.split(/[/\\]/).pop() || '未命名';
  return isModified.value ? `${fileName} *` : fileName;
});

const currentWindowTitle = computed(() => `${currentFileName.value} - Vault`);

function showConfirm(callback: () => Promise<void>) {
  confirmCallback.value = callback;
  confirmVisible.value = true;
}

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

async function updateTitle() {
  await fileAPI.setWindowTitle(currentWindowTitle.value);
}

async function saveFileAs() {
  const content = editorContent.value;
  const file = await fileAPI.saveFile(content);
  if (file) {
    currentFilePath.value = file;
    lastSavedContent.value = content;
    isModified.value = false;
    await updateTitle();
  }
}

async function saveFile() {
  if (currentFilePath.value) {
    const content = editorContent.value;
    await fileAPI.writeFile(currentFilePath.value, content);
    lastSavedContent.value = content;
    isModified.value = false;
    await updateTitle();
  } else {
    await saveFileAs();
  }
}

async function resetEditor() {
  currentFilePath.value = null;
  lastSavedContent.value = '';
  isModified.value = false;
  editorContent.value = '';
  await updateTitle();
}

async function maybeSaveBefore(action: () => Promise<void>) {
  if (!isModified.value) {
    await action();
    return;
  }

  showConfirm(async () => {
    await saveFile();
    await action();
  });
}

async function newFile() {
  await maybeSaveBefore(resetEditor);
}

async function openSelectedFile() {
  const file = await fileAPI.openFile();
  if (!file) return;

  const content = await fileAPI.readFile(file);
  currentFilePath.value = file;
  editorContent.value = content;
  lastSavedContent.value = content;
  isModified.value = false;
  await updateTitle();
}

async function openFile() {
  await maybeSaveBefore(openSelectedFile);
}

onMounted(() => {
  updateTitle();
});

watch(editorContent, async (value) => {
  const modified = value !== lastSavedContent.value;
  if (isModified.value === modified) return;

  isModified.value = modified;
  await updateTitle();
});
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
  background: #fff;
  border-radius: 8px;
}
</style>
