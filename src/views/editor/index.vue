<template>
  <BLayout class="editor-layout" content-class="editor-content">
    <template #header-left>
      <div class="header-left">
        <BToolbar :title="'文件'" :options="toolbarFileOptions" />

        <BToolbar :title="'编辑'" :options="toolbarEditOptions" />

        <BToolbar :title="'视图'" show-selected-check :options="toolbarViewOptions" />

        <BToolbar :title="'帮助'" :options="toolbarHelpOptions" />

        <div class="header-divider"></div>

        <BDropdownButton :options="recentFileOptions" :value="fileState.id" :overlay-width="220">
          <div>{{ fileState.name || '未命名文件' }}{{ isDirty ? ' *' : '' }}</div>

          <template #menu="{ record }">
            <div class="flex items-center justify-between w-full gap-2">
              <BTruncateText :text="record.label" />
              <Icon v-if="record.selected" icon="lucide:check" class="flex-shrink-0" />
            </div>
          </template>
        </BDropdownButton>
      </div>
    </template>
    <template #header-right>
      <div class="header-right">
        <!-- 辅助工具侧边栏切换按钮 -->
        <BButton type="secondary" size="small" square @click="toggleSidebar">
          <Icon icon="lucide:panel-right" width="16" height="16" />
        </BButton>

        <BButton type="secondary" size="small" square @click="handleOpenSettings">
          <Icon icon="lucide:settings" width="16" height="16" />
        </BButton>
      </div>
    </template>

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
      <BPanelSplitter v-show="sidebarVisible" v-model:size="sidebarWidth" position="left" :min-width="200" :max-width="500">
        <AuxiliarySidebar />
      </BPanelSplitter>

      <ShortcutsHelp v-model:visible="visible.shortcuts" />
    </div>

    <!-- 查找栏 -->
    <FindBar v-model:visible="visible.find" :content="fileState.content" :editor-instance="editorInstance" />

    <SearchRecent v-model:visible="visible.recentSearch" :files="savedRecentFiles" :active-id="fileState.id" @select="handleSelectRecentFile" />
  </BLayout>
</template>

<script setup lang="ts">
import type { EditorFile } from './types';
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import type { DropdownOption } from '@/components/BDropdown/type';
import BEditor from '@/components/BEditor/index.vue';
import type { BEditorPublicInstance } from '@/components/BEditor/types';
import BPanelSplitter from '@/components/BPanelSplitter/index.vue';
import AuxiliarySidebar from './components/AuxiliarySidebar.vue';
import FindBar from './components/FindBar.vue';
import SearchRecent from './components/SearchRecent.vue';
import ShortcutsHelp from './components/ShortcutsHelp.vue';
import { useAutoSave } from './hooks/useAutoSave';
import { useDirty } from './hooks/useDirty';
import { useEditActive } from './hooks/useEditActive';
import { useFileActive, getRecentFileLabel } from './hooks/useFileActive';
import { useHelp } from './hooks/useHelp';
import { useViewActive } from './hooks/useViewActive';

const fileState = ref<EditorFile>({ id: '', path: '', content: '', name: '', ext: 'md' });
const editorInstance = ref<BEditorPublicInstance | null>(null);
const router = useRouter();

const { isDirty, setOriginalContent } = useDirty(fileState);

const visible = reactive({ find: false, recentSearch: false, shortcuts: false });
const sidebarVisible = ref(false);
const sidebarWidth = ref(300);

function toggleSidebar(): void {
  sidebarVisible.value = !sidebarVisible.value;
}

function handleOpenSettings(): void {
  router.push('/settings');
}

const { pause, resume } = useAutoSave(fileState);

const { toolbarFileOptions, savedRecentFiles, openRecentFile } = useFileActive(fileState, {
  pause,
  resume,
  setOriginalContent,
  visible
});

const recentFileOptions = computed<DropdownOption[]>(() =>
  savedRecentFiles.value.map((file) => ({
    value: file.id,
    label: getRecentFileLabel(file),
    class: 'b-dropdown-menu-item-selected',
    selected: file.id === fileState.value.id,
    onClick: async () => {
      await openRecentFile(file.id);
    }
  }))
);

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

.header-divider {
  width: 1px;
  height: 16px;
  margin: 0 2px;
  background-color: var(--border-primary);
}

:deep(.b-dropdown-menu-item.is-active) {
  color: var(--color-primary);
  background-color: var(--color-primary-bg);
}

.header-right {
  display: flex;
  gap: 12px;
  align-items: center;
}

:deep(.editor-content) {
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
