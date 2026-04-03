<template>
  <div class="editor-layout">
    <div class="editor-header">
      <div class="header-left">
        <Toolbar :title="'文件'" :options="toolbarFileOptions" />

        <Toolbar :title="'编辑'" :options="toolbarEditOptions" />

        <Toolbar :title="'视图'" :options="toolbarViewOptions" />
      </div>
    </div>

    <div class="editor-content">
      <BEditor
        v-if="viewMode === 'rich'"
        :key="fileState.id"
        ref="editor"
        v-model:value="fileState.content"
        v-model:title="fileState.name"
        :editor-id="fileState?.id"
        @title-blur="handleTitleBlur"
      />
      <div v-else class="source-editor">
        <textarea v-model="fileState.name" class="source-editor-title" placeholder="请输入标题" @blur="handleTitleBlur(fileState.name)"></textarea>
        <textarea ref="sourceTextareaRef" v-model="fileState.content" class="source-editor-textarea" spellcheck="false"></textarea>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { EditorFile } from './types';
import { computed, ref } from 'vue';
import { useClipboard } from '@vueuse/core';
import { message } from 'ant-design-vue';
import BEditor from '@/components/BEditor/index.vue';
import Toolbar from '@/components/Toolbar.vue';
import { native } from '@/utils/native';
import { indexedDB } from '@/utils/storage';
import { useAutoSave } from './hooks/useAutoSave';
import { useEditActive } from './hooks/useEditActive';
import { useFileActive } from './hooks/useFileActive';
import { useViewActive } from './hooks/useViewActive';

const fileState = ref<EditorFile>({ id: '', path: '', content: '', name: '', ext: 'md' });
const editor = ref<InstanceType<typeof BEditor> | null>(null);
const sourceTextareaRef = ref<HTMLTextAreaElement | null>(null);

const { pause, resume } = useAutoSave(fileState);

const { toolbarFileOptions, loadRecentFiles } = useFileActive(fileState, { pause, resume });

const { toolbarEditOptions: toolbarEditOptionsRich } = useEditActive(fileState, editor);

const { copy } = useClipboard();
const { viewMode, toolbarViewOptions } = useViewActive();

const toolbarEditOptionsSource = computed(() => {
  const { content } = fileState.value;
  const canCopy = Boolean(content.trim());
  return [
    {
      value: 'selectAll',
      label: '全选',
      shortcut: 'Ctrl+A',
      onClick: () => {
        const el = sourceTextareaRef.value;
        if (!el) return;
        el.focus();
        el.setSelectionRange(0, el.value.length);
      }
    },
    {
      value: 'copyAll',
      label: '复制全文',
      disabled: !canCopy,
      onClick: async () => {
        if (!canCopy) {
          message.warning('内容为空');
          return;
        }

        try {
          await copy(content);
          message.success('复制成功');
        } catch {
          message.error('复制失败');
        }
      }
    }
  ];
});

const toolbarEditOptions = computed(() => (viewMode.value === 'rich' ? toolbarEditOptionsRich.value : toolbarEditOptionsSource.value));

function handleTitleBlur(title: string): void {
  if (!title || !fileState.value?.id) return;

  const ext = fileState.value?.ext || '';
  native.setWindowTitle(ext ? `${title}.${ext}` : title);

  indexedDB.updateRecentFile(fileState.value.id, fileState.value).then(loadRecentFiles);
}
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
  height: 40px;
  padding: 0 20px;
  background: #fff;
}

.header-left {
  display: flex;
  gap: 10px;
  align-items: center;
}

.editor-content {
  flex: 1;
  height: 0;
  margin: 6px;
  overflow: hidden;
  background: #fff;
  border-radius: 8px;
}

.source-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.source-editor-title {
  flex-shrink: 0;
  height: 54px;
  padding: 12px 16px;
  font-size: 26px;
  font-weight: 600;
  line-height: 30px;
  resize: none;
  outline: none;
  border: 0;
}

.source-editor-textarea {
  flex: 1;
  padding: 16px;
  font-family: ui-monospace, sfmono-regular, menlo, monaco, consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.6;
  resize: none;
  outline: none;
  border: 0;
}
</style>
