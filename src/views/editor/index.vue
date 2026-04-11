<template>
  <BLayout class="editor-layout" content-class="editor-content">
    <template #header-left>
      <div class="header-left">
        <BToolbar :title="'文件'" :options="toolbarFileOptions" />

        <BToolbar :title="'编辑'" :options="toolbarEditOptions" />

        <BToolbar :title="'视图'" show-selected-check :options="toolbarViewOptions" />

        <BToolbar :title="'帮助'" :options="toolbarHelpOptions" />
      </div>
    </template>
    <template #header-right>
      <div class="header-right">
        <div class="settings-btn" @click="handleOpenSettings">
          <Icon icon="lucide:settings" />
        </div>
      </div>
    </template>

    <BEditor
      :key="fileState.id"
      ref="editorInstance"
      v-model:value="fileState.content"
      v-model:title="fileState.name"
      :editor-id="fileState?.id"
      :view-mode="viewState.mode"
      :show-outline="viewState.showOutline"
    />
    <!-- 查找栏 -->
    <FindBar v-model:visible="visible.find" :content="fileState.content" :editor-instance="editorInstance" />

    <SearchRecent v-model:visible="visible.recentSearch" :files="recentFiles" :active-id="fileState.id" @select="handleSelectRecentFile" />

    <ShortcutsHelp v-model:visible="visible.shortcuts" />
  </BLayout>
</template>

<script setup lang="ts">
import type { EditorFile } from './types';
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import BEditor from '@/components/BEditor/index.vue';
import type { BEditorPublicInstance } from '@/components/BEditor/types';
import FindBar from './components/FindBar.vue';
import SearchRecent from './components/SearchRecent.vue';
import ShortcutsHelp from './components/ShortcutsHelp.vue';
import { useAutoSave } from './hooks/useAutoSave';
import { useEditActive } from './hooks/useEditActive';
import { useFileActive } from './hooks/useFileActive';
import { useHelp } from './hooks/useHelp';
import { useViewActive } from './hooks/useViewActive';

const fileState = ref<EditorFile>({ id: '', path: '', content: '', name: '', ext: 'md' });
const editorInstance = ref<BEditorPublicInstance | null>(null);
const router = useRouter();

const visible = reactive({ find: false, recentSearch: false, shortcuts: false });

function handleOpenSettings(): void {
  router.push('/settings');
}

const { pause, resume } = useAutoSave(fileState);

const { toolbarFileOptions, recentFiles, openRecentFile } = useFileActive(fileState, { pause, resume, visible });

async function handleSelectRecentFile(id: string): Promise<void> {
  await openRecentFile(id);
}

const { toolbarEditOptions } = useEditActive(fileState, { editorInstance, visible });

const { viewState, toolbarViewOptions } = useViewActive();

const { toolbarHelpOptions } = useHelp({
  onShowShortcuts: () => {
    visible.shortcuts = true;
  }
});
</script>

<style lang="less" scoped>
.editor-layout {
  background: var(--bg-secondary);
}

.header-left {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 0 20px;
}

.header-right {
  display: flex;
  gap: 12px;
  align-items: center;
}

.settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s;
}

.settings-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

:deep(.editor-content) {
  position: relative;
  margin: 0 6px 6px;
  overflow: hidden;
  background: var(--bg-primary);
  border-radius: 8px;
}
</style>
