<template>
  <BScrollbar class="editor-scrollbar" @click="handleScrollbarClick">
    <EditorContent :editor="editorInstance" class="tiptap-editor" />
  </BScrollbar>
</template>

<script setup lang="ts">
import { watch, nextTick } from 'vue';
import StarterKit from '@tiptap/starter-kit';
import { useEditor, EditorContent } from '@tiptap/vue-3';

interface Props {
  editable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  editable: true
});

const content = defineModel<string>();

const editorInstance = useEditor({
  content: content.value ?? '',
  extensions: [StarterKit],
  editable: props.editable,

  onUpdate: ({ editor }) => {
    const html = editor.getHTML();
    content.value = html;
  }
});

function addHeadingIds() {
  nextTick(() => {
    const editorElement = editorInstance.value?.view.dom;
    if (!editorElement) return;

    const headings = editorElement.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach((heading, index) => {
      if (!heading.id) {
        heading.id = `heading-${index}`;
      }
    });
  });
}

watch(
  () => editorInstance.value?.getHTML(),
  () => {
    addHeadingIds();
  },
  { immediate: true }
);

watch(content, (newContent) => {
  const instance = editorInstance.value;
  if (!instance) return;

  const current = instance.getHTML();

  if (newContent !== current) {
    instance.commands.setContent(newContent ?? '', {
      emitUpdate: false
    });
  }
});

function handleScrollbarClick() {
  const instance = editorInstance.value;
  if (instance) {
    instance.commands.focus();
  }
}
</script>

<style scoped>
.tiptap-editor {
  min-height: 100%;
}

.tiptap-editor :deep(.ProseMirror) {
  min-height: 100%;
  padding: 0 20px;
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #2e2e2e;
  caret-color: #2e2e2e;
  outline: none;
}

.tiptap-editor :deep(.ProseMirror h1) {
  padding-bottom: 0.3em;
  margin: 1.5em 0 0.75em;
  font-size: 24px;
  font-weight: 600;
  color: #2e2e2e;
  border-bottom: 1px solid #e0e0e0;
}

.tiptap-editor :deep(.ProseMirror h2) {
  padding-bottom: 0.2em;
  margin: 1.25em 0 0.625em;
  font-size: 20px;
  font-weight: 600;
  color: #2e2e2e;
  border-bottom: 1px solid #e0e0e0;
}

.tiptap-editor :deep(.ProseMirror h3) {
  margin: 1em 0 0.5em;
  font-size: 16px;
  font-weight: 600;
  color: #2e2e2e;
}

.tiptap-editor :deep(.ProseMirror h4) {
  margin: 0.875em 0 0.4375em;
  font-size: 14px;
  font-weight: 600;
  color: #2e2e2e;
}

.tiptap-editor :deep(.ProseMirror h5) {
  margin: 0.75em 0 0.375em;
  font-size: 12px;
  font-weight: 600;
  color: #2e2e2e;
  text-transform: uppercase;
}

.tiptap-editor :deep(.ProseMirror h6) {
  margin: 0.625em 0 0.3125em;
  font-size: 11px;
  font-weight: 600;
  color: #2e2e2e;
  text-transform: uppercase;
}

.tiptap-editor :deep(.ProseMirror p) {
  min-height: 1em;
  margin: 0.75em 0;
}

.tiptap-editor :deep(.ProseMirror ul),
.tiptap-editor :deep(.ProseMirror ol) {
  padding-left: 1.5em;
  margin: 0.75em 0;
}

.tiptap-editor :deep(.ProseMirror li) {
  margin: 0.25em 0;
}

.tiptap-editor :deep(.ProseMirror li > p) {
  margin: 0.25em 0;
}

.tiptap-editor :deep(.ProseMirror blockquote) {
  padding: 0.5em 1em 0.5em 1.25em;
  margin: 0.75em 0;
  color: #585858;
  background-color: #f5f5f5;
  border-left: 4px solid #d0d0d0;
  border-radius: 0 4px 4px 0;
}

.tiptap-editor :deep(.ProseMirror code) {
  padding: 0.125em 0.25em;
  font-family: Menlo, Monaco, 'Courier New', monospace;
  font-size: 0.85em;
  color: #e83e8c;
  background-color: #f1f1f1;
  border-radius: 3px;
}

.tiptap-editor :deep(.ProseMirror pre) {
  padding: 1em;
  margin: 0.75em 0;
  overflow-x: auto;
  background-color: #f5f5f5;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
}

.tiptap-editor :deep(.ProseMirror pre code) {
  padding: 0;
  color: #2e2e2e;
  background-color: transparent;
}

.tiptap-editor :deep(.ProseMirror hr) {
  margin: 1.5em 0;
  border: none;
  border-top: 1px solid #e0e0e0;
}

.tiptap-editor :deep(.ProseMirror a) {
  font-weight: 500;
  color: #1761d2;
  text-decoration: none;
}

.tiptap-editor :deep(.ProseMirror a:hover) {
  text-decoration: underline;
}

.tiptap-editor :deep(.ProseMirror img) {
  max-width: 100%;
  margin: 0.75em 0;
  border-radius: 4px;
  box-shadow: 0 1px 3px rgb(0 0 0 / 10%);
}

.tiptap-editor :deep(.ProseMirror table) {
  width: 100%;
  margin: 0.75em 0;
  overflow: hidden;
  border-collapse: collapse;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
}

.tiptap-editor :deep(.ProseMirror th) {
  padding: 0.5em 0.75em;
  font-weight: 600;
  color: #2e2e2e;
  text-align: left;
  background-color: #f5f5f5;
  border: 1px solid #e0e0e0;
}

.tiptap-editor :deep(.ProseMirror td) {
  padding: 0.5em 0.75em;
  color: #2e2e2e;
  text-align: left;
  border: 1px solid #e0e0e0;
}

.tiptap-editor :deep(.ProseMirror tr:hover td) {
  background-color: #f9f9f9;
}
</style>
