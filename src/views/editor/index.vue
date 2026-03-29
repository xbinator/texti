<template>
  <div class="editor-layout">
    <div class="editor-header">
      <div class="header-left">
        <Toolbar :title="'文件'" :options="toolbarMenuOptions" />
      </div>
    </div>

    <div class="editor-content">
      <BEditor v-model="fileState.content" v-model:title="fileState.name" @title-blur="handleTitleBlur" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { EditorFile } from './types';
import { ref } from 'vue';
import Toolbar from '@/components/Toolbar.vue';
import { native } from '@/utils/native';
import { useAutoSave } from './hooks/useAutoSave';
import { useFileActive } from './hooks/useFileActive';

const fileState = ref<Partial<EditorFile>>({});

const { pause, resume } = useAutoSave(fileState);

const { toolbarMenuOptions } = useFileActive(fileState, { pause, resume });

function handleTitleBlur(title: string): void {
  if (!title) return;

  const ext = fileState.value.ext || '';
  native.setWindowTitle(ext ? `${title}.${ext}` : title);
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
</style>
