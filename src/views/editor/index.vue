<template>
  <div class="editor-layout">
    <!-- 顶部工具栏 -->
    <div class="editor-header">
      <div class="header-left">
        <Toolbar @new-file="newFile" @open-file="openFile" @save-file="saveFile" @save-file-as="saveFileAs" />
      </div>
    </div>

    <div class="editor-content">
      <!-- 右侧编辑器 -->
      <BEditor v-model="editorContent" />
    </div>

    <Modal v-model:open="confirmVisible" title="确认" @ok="handleConfirmOk" @cancel="handleConfirmCancel">
      <p>当前文档有未保存的修改，是否保存？</p>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { Modal } from 'ant-design-vue';
import Toolbar from '../../components/Toolbar.vue';
import { fileAPI } from '../../utils/fileAPI';

const currentFilePath = ref<string | null>(null);
const lastSavedContent = ref('');
const isModified = ref(false);
const editorContent = ref('');
const confirmVisible = ref(false);
const confirmCallback = ref<(() => Promise<void>) | null>(null);

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
  const fileName = currentFilePath.value ? currentFilePath.value.split(/[/\\]/).pop() : '未命名';
  const title = isModified.value ? `${fileName} *` : fileName;
  await fileAPI.setWindowTitle(`Markdown Editor - ${title}`);
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

/* 主要内容区域 */
.editor-content {
  flex: 1;
  height: 0;
  margin: 6px;
  background: #fff;
  border-radius: 8px;
}

/* 左侧目录 */
.editor-sidebar {
  flex-shrink: 0;
  width: 240px;
  overflow-y: auto;
  background: #fff;
  border-right: 1px solid #e8e8e8;
}
</style>
