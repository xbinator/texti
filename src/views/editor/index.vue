<template>
  <div class="editor-layout editor-content">
    <div class="editor-main-container">
      <div class="editor-content-wrapper">
        <BEditor
          ref="editorRef"
          :key="fileState.id"
          v-model:value="fileState.content"
          v-model:title="fileState.name"
          :editor-id="fileState.id"
          :file-path="fileState.path"
          :view-mode="settingStore.sourceMode ? 'source' : 'rich'"
          :show-outline="settingStore.showOutline"
          @rename-file="actions.onRename"
          @delete-file="actions.onDelete"
          @show-in-folder="actions.onShowInFolder"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { editorToolContextRegistry } from '@/ai/tools/editor-context';
import BEditor from '@/components/BEditor/index.vue';
import type { BEditorPublicInstance } from '@/components/BEditor/types';
import { useSettingStore } from '@/stores/setting';
import { useBindings } from './hooks/useBindings';
import { useSession } from './hooks/useSession';

const route = useRoute();

const fileId = ref(String(route.params.id || ''));

const { fileState, actions } = useSession(fileId);
const settingStore = useSettingStore();

const editorRef = ref<BEditorPublicInstance | null>(null);
const isActive = ref(true);

useBindings(fileId, { fileState, actions, editorInstance: editorRef });

/**
 * 注销当前编辑器工具上下文。
 */
function unregisterEditorContext(): void {
  const documentId = fileState.value.id;
  if (documentId) {
    editorToolContextRegistry.unregister(documentId);
  }
}

/**
 * 注册当前激活编辑器的工具上下文。
 */
function registerEditorContext(): void {
  const editorInstance = editorRef.value;
  const documentId = fileState.value.id;

  if (!isActive.value || !editorInstance || !documentId) {
    return;
  }

  editorToolContextRegistry.register(documentId, {
    document: {
      id: documentId,
      title: fileState.value.name,
      path: fileState.value.path,
      getContent: () => fileState.value.content
    },
    editor: {
      getSelection: () => editorInstance.getSelection(),
      insertAtCursor: (content: string) => editorInstance.insertAtCursor(content),
      replaceSelection: (content: string) => editorInstance.replaceSelection(content),
      replaceDocument: (content: string) => editorInstance.replaceDocument(content)
    }
  });
}

watch([editorRef, () => fileState.value.id], registerEditorContext);

onActivated(() => {
  isActive.value = true;
  registerEditorContext();
});

onDeactivated(() => {
  isActive.value = false;
  unregisterEditorContext();
});

onBeforeUnmount(() => {
  unregisterEditorContext();
});
</script>

<style lang="less" scoped>
.editor-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.editor-main-container {
  position: relative;
  display: flex;
  flex: 1;
  gap: 6px;
  height: 100%;
  overflow: hidden;
}

.editor-content-wrapper {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  border-radius: 8px;
}
</style>
