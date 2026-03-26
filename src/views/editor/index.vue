<template>
  <div class="editor-layout">
    <!-- 顶部工具栏 -->
    <div class="editor-header">
      <div class="header-left">
        <Toolbar @new-file="newFile" @open-file="openFile" @save-file="saveFile" @save-file-as="saveFileAs" />
      </div>
      <div class="header-right">
        <span class="file-name">{{ currentFileName }}</span>
      </div>
    </div>

    <div class="editor-content">
      <!-- 左侧目录 -->
      <div class="editor-sidebar">
        <TocSidebar :content="editorContent" />
      </div>

      <!-- 右侧编辑器 -->
      <div class="editor-main">
        <BEditor v-model="editorContent" />
      </div>
    </div>

    <Modal v-model:open="confirmVisible" title="确认" @ok="handleConfirmOk" @cancel="handleConfirmCancel">
      <p>当前文档有未保存的修改，是否保存？</p>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { Modal } from 'ant-design-vue';
import Toolbar from '../../components/Toolbar.vue';
import { fileAPI } from '../../utils/fileAPI';

const currentFilePath = ref<string | null>(null);
const isModified = ref(false);
const editorContent = ref('');
const confirmVisible = ref(false);
const confirmCallback = ref<(() => void) | null>(null);

const currentFileName = computed(() => {
  if (currentFilePath.value) {
    const fileName = currentFilePath.value.split(/[/\\]/).pop();
    return isModified.value ? `${fileName} *` : fileName;
  }
  return '未命名';
});

function showConfirm(callback: () => void) {
  confirmCallback.value = callback;
  confirmVisible.value = true;
}

function handleConfirmOk() {
  if (confirmCallback.value) {
    confirmCallback.value();
  }
  confirmVisible.value = false;
}

function handleConfirmCancel() {
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
    isModified.value = false;
    await updateTitle();
  }
}

async function saveFile() {
  if (currentFilePath.value) {
    const content = editorContent.value;
    await fileAPI.writeFile(currentFilePath.value, content);
    isModified.value = false;
    await updateTitle();
  } else {
    await saveFileAs();
  }
}

async function newFile() {
  if (isModified.value) {
    showConfirm(async () => {
      await saveFile();
    });
  }
  currentFilePath.value = null;
  isModified.value = false;
  editorContent.value = '';
  await updateTitle();
}

async function openFile() {
  const file = await fileAPI.openFile();
  if (file) {
    const content = await fileAPI.readFile(file);
    currentFilePath.value = file;
    editorContent.value = content;
    isModified.value = false;
    await updateTitle();
  }
}

onMounted(() => {
  updateTitle();
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
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 20px;
  background: #fff;
  border-bottom: 1px solid #e8e8e8;
  box-shadow: 0 1px 4px rgb(0 0 0 / 10%);
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
  color: #333;
}

/* 主要内容区域 */
.editor-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* 左侧目录 */
.editor-sidebar {
  flex-shrink: 0;
  width: 240px;
  overflow-y: auto;
  background: #fff;
  border-right: 1px solid #e8e8e8;
}

/* 右侧编辑器 */
.editor-main {
  flex: 1;
  margin: 20px;
  overflow: hidden;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 8%);
}
</style>
