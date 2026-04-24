/**
 * @file file-reference-insert.test.ts
 * @description 编辑器文件引用插入聊天输入框链路回归测试。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  CHAT_FILE_REFERENCE_INSERT_EVENT,
  getFileNameFromPath,
  getLineRangeFromTextBeforeSelection,
  isChatFileReferenceInsertPayload
} from '@/shared/chat/fileReference';

/**
 * 读取源码文件。
 * @param relativePath - 相对仓库根目录的源码路径
 */
function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf-8');
}

describe('chat file reference insert event utilities', () => {
  test('normalizes file names across slash styles', () => {
    expect(getFileNameFromPath('src/foo/file.ts')).toBe('file.ts');
    expect(getFileNameFromPath('/workspace\\src\\foo\\file.ts')).toBe('file.ts');
  });

  test('calculates single line and line range from selected text boundaries', () => {
    expect(getLineRangeFromTextBeforeSelection('first line', 'first line')).toBe('1');
    expect(getLineRangeFromTextBeforeSelection('first\nsecond', 'first\nsecond\nthird')).toBe('2-3');
  });

  test('validates file reference insert payloads', () => {
    expect(CHAT_FILE_REFERENCE_INSERT_EVENT).toBe('chat:file-reference:insert');
    expect(isChatFileReferenceInsertPayload({ filePath: 'src/foo/file.ts', fileName: 'file.ts', line: '12-14' })).toBe(true);
    expect(isChatFileReferenceInsertPayload({ filePath: null, fileName: '临时笔记', line: '3' })).toBe(true);
    expect(isChatFileReferenceInsertPayload({ filePath: 'src/foo/file.ts', fileName: 'file.ts', line: '' })).toBe(false);
  });
});

describe('chat file reference insert wiring', () => {
  test('wires editor selection toolbar to chat sidebar through BChat insert API', () => {
    const selectionToolbarSource = readSource('src/components/BEditor/components/SelectionToolbar.vue');
    const paneRichEditorSource = readSource('src/components/BEditor/components/PaneRichEditor.vue');
    const richEditorHostSource = readSource('src/components/BEditor/components/RichEditorHost.vue');
    const editorSource = readSource('src/components/BEditor/index.vue');
    const chatSource = readSource('src/components/BChat/index.vue');
    const sidebarSource = readSource('src/components/BChatSidebar/index.vue');

    expect(selectionToolbarSource).toContain('insertSelectionReferenceToChat');
    expect(selectionToolbarSource).toContain('emitChatFileReferenceInsert');
    expect(selectionToolbarSource).toContain('getLineRangeFromTextBeforeSelection');
    expect(selectionToolbarSource).toContain('fileName: props.fileName || getFileNameFromPath');
    expect(paneRichEditorSource).toContain(':file-path="props.filePath"');
    expect(paneRichEditorSource).toContain(':file-name="props.fileName"');
    expect(richEditorHostSource).toContain(':file-path="props.filePath"');
    expect(richEditorHostSource).toContain(':file-name="props.fileName"');
    expect(editorSource).toContain(':file-path="props.filePath"');
    expect(editorSource).toContain(':file-name="editorTitle"');
    expect(chatSource).toContain('function insertFileReference');
    expect(chatSource).toContain('const activeReferences = getActiveDraftReferences(content);');
    expect(chatSource).toContain('loadReferenceSnapshotMap');
    expect(chatSource).toContain('chatStorage.getReferenceSnapshots');
    expect(chatSource).toContain('buildModelReadyMessages(sourceMessages, snapshotsById)');
    expect(chatSource).toContain("content,");
    expect(chatSource).toContain("parts: [{ type: 'text', text: content }],");
    expect(chatSource).not.toContain('expandFileReferencesForModel');
    expect(chatSource).toContain('defineExpose({ focusInput, insertFileReference })');
    expect(sidebarSource).toContain('onChatFileReferenceInsert');
    expect(sidebarSource).toContain('type ChatFileReferenceInsertPayload');
    expect(sidebarSource).toContain('referenceId: nanoid()');
    expect(sidebarSource).toContain('documentId: toolContext?.document.id || reference.filePath || reference.fileName');
    expect(sidebarSource).toContain('async function persistReferenceSnapshots');
    expect(sidebarSource).toContain('chatStorage.upsertReferenceSnapshots([snapshot])');
    expect(sidebarSource).toContain('chatRef.value?.insertFileReference');
  });
});
