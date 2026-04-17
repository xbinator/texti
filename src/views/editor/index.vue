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
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import BEditor from '@/components/BEditor/index.vue';
import type { BEditorPublicInstance } from '@/components/BEditor/types';
import { useSettingStore } from '@/stores/setting';
import { useBindings } from './hooks/useBindings';
import { useSession } from './hooks/useSession';

const route = useRoute();

const fileId = computed(() => String(route.params.id || ''));

const { fileState, actions } = useSession(fileId);
const settingStore = useSettingStore();

const editorRef = ref<BEditorPublicInstance | null>(null);

useBindings(fileId, { fileState, actions, editorInstance: editorRef });
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
