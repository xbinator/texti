<template>
  <div class="editor-layout editor-content">
    <div class="editor-main-container">
      <div class="editor-content-wrapper">
        <BEditor
          :key="fileState.id"
          v-model:value="fileState.content"
          v-model:title="fileState.name"
          :editor-id="fileState?.id"
          :show-outline="viewState.showOutline"
        />

        <!-- :view-mode="viewState.mode" -->
      </div>

      <!-- 辅助工具侧边栏 -->
      <BPanelSplitter v-show="sidebarState.visible" v-model:size="sidebarState.width" position="left" :min-width="200" :max-width="500">
        <AuxiliarySidebar />
      </BPanelSplitter>

      <ShortcutsHelp v-model:visible="visible.shortcuts" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { EditorFile } from './types';
import { computed, reactive, ref, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import BEditor from '@/components/BEditor/index.vue';
import BPanelSplitter from '@/components/BPanelSplitter/index.vue';
import { native } from '@/shared/platform';
import { recentFilesStorage } from '@/shared/storage';
import { useTabsStore } from '@/stores/tabs';
import AuxiliarySidebar from './components/AuxiliarySidebar.vue';
import ShortcutsHelp from './components/ShortcutsHelp.vue';
import { useAutoSave } from './hooks/useAutoSave';

const route = useRoute();

const tabsStore = useTabsStore();

const fileId = computed(() => (route.params.id || '') as string);
// 编辑器文件状态
const fileState = ref<EditorFile>({ id: '', name: '', content: '', ext: '', path: null });
// 编辑器视图状态
const viewState = reactive({ mode: 'rich', showOutline: true });

const sidebarState = ref({ visible: false, width: 300 });

const visible = reactive({ shortcuts: false });

const { pause, resume } = useAutoSave(fileState);

async function loadFileState() {
  pause();

  const stored = await recentFilesStorage.getRecentFile(fileId.value);
  fileState.value = stored || { id: fileId.value, name: '', content: '', ext: '', path: null };

  fileState.value.path ? native.watchFile(fileState.value.path) : native.unwatchFile();

  tabsStore.addTab({ id: fileId.value, path: route.fullPath, title: fileState.value.name || '未命名文件' });

  nextTick(resume);
}

watch(fileId, () => loadFileState(), { immediate: true });
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
