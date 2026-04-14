<template>
  <div class="editor-layout editor-content">
    <div class="editor-main-container">
      <div class="editor-content-wrapper">
        <BEditor
          :key="fileState.id"
          ref="editorInstance"
          v-model:value="fileState.content"
          v-model:title="fileState.name"
          :editor-id="fileState?.id"
          :view-mode="viewState.mode"
          :show-outline="viewState.showOutline"
        />
      </div>

      <!-- 辅助工具侧边栏 -->
      <BPanelSplitter v-show="sidebarState.visible" v-model:size="sidebarState.width" position="left" :min-width="200" :max-width="500">
        <AuxiliarySidebar />
      </BPanelSplitter>

      <ShortcutsHelp v-model:visible="visible.shortcuts" />
    </div>

    <!-- 查找栏 -->
    <FindBar v-model:visible="visible.find" :content="fileState.content" :editor-instance="editorInstance" />

    <SearchRecent v-model:visible="visible.recentSearch" :files="savedRecentFiles" :active-id="fileState.id" @select="handleSelectRecentFile" />
  </div>
</template>

<script setup lang="ts">
import { inject, type Ref } from 'vue';
import BEditor from '@/components/BEditor/index.vue';
import type { BEditorPublicInstance } from '@/components/BEditor/types';
import BPanelSplitter from '@/components/BPanelSplitter/index.vue';
import type { EditorFile } from '@/layouts/default/types';
import AuxiliarySidebar from './components/AuxiliarySidebar.vue';
import FindBar from './components/FindBar.vue';
import SearchRecent from './components/SearchRecent.vue';
import ShortcutsHelp from './components/ShortcutsHelp.vue';

// Inject global editor state from layout
const fileState = inject('editorFileState') as Ref<EditorFile>;
const editorInstance = inject('editorInstance') as Ref<BEditorPublicInstance | null>;
const visible = inject('editorVisible') as { find: boolean; recentSearch: boolean; shortcuts: boolean };
const sidebarState = inject('editorSidebarState') as Ref<{ visible: boolean; width: number }>;
const viewState = inject('editorViewState') as Ref<{ mode: any; showOutline: boolean }>;
const savedRecentFiles = inject('editorSavedRecentFiles') as Ref<EditorFile[]>;
const handleSelectRecentFile = inject('editorHandleSelectRecentFile') as (id: string) => Promise<void>;
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
  margin: 0 6px 6px;
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
