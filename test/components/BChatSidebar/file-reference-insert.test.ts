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
    expect(getLineRangeFromTextBeforeSelection('first line', 'first line')).toEqual({ startLine: 1, endLine: 1 });
    expect(getLineRangeFromTextBeforeSelection('first\nsecond', 'first\nsecond\nthird')).toEqual({ startLine: 2, endLine: 3 });
    // 空字符串视为第 1 行开头
    expect(getLineRangeFromTextBeforeSelection('', '')).toEqual({ startLine: 1, endLine: 1 });
  });

  test('validates file reference insert payloads', () => {
    expect(CHAT_FILE_REFERENCE_INSERT_EVENT).toBe('chat:file-reference:insert');
    // 正常范围
    expect(isChatFileReferenceInsertPayload({ filePath: 'src/foo/file.ts', fileName: 'file.ts', startLine: 12, endLine: 14 })).toBe(true);
    // 单行
    expect(isChatFileReferenceInsertPayload({ filePath: null, fileName: '临时笔记', startLine: 3, endLine: 3 })).toBe(true);
    // 无行号场景允许 startLine === endLine === 0
    expect(isChatFileReferenceInsertPayload({ filePath: null, fileName: '临时笔记', startLine: 0, endLine: 0 })).toBe(true);
    // startLine=0 但 endLine>0 歧义，拒绝
    expect(isChatFileReferenceInsertPayload({ filePath: null, fileName: '临时笔记', startLine: 0, endLine: 5 })).toBe(false);
    // startLine > endLine 非法
    expect(isChatFileReferenceInsertPayload({ filePath: 'src/foo/file.ts', fileName: 'file.ts', startLine: 5, endLine: 2 })).toBe(false);
  });
});

describe('chat file reference insert wiring', () => {
  test('wires editor selection toolbar to chat sidebar through BChat insert API', () => {
    const selectionToolbarSource = readSource('src/components/BEditor/components/SelectionToolbar.vue');
    const richEditorContentSource = readSource('src/components/BEditor/components/RichEditorContent.vue');
    const paneRichEditoSource = readSource('src/components/BEditor/components/PaneRichEditor.vue');
    const editorSource = readSource('src/components/BEditor/index.vue');
    const sidebarSource = readSource('src/components/BChatSidebar/index.vue');

    expect(selectionToolbarSource).toContain('insertSelectionReferenceToChat');
    expect(selectionToolbarSource).toContain('emitChatFileReferenceInsert');
    expect(selectionToolbarSource).toContain('getLineRangeFromTextBeforeSelection');
    expect(selectionToolbarSource).toContain('fileName: props.fileName || getFileNameFromPath');
    expect(richEditorContentSource).toContain(':file-path="props.filePath"');
    expect(richEditorContentSource).toContain(':file-name="props.fileName"');
    expect(paneRichEditoSource).toContain(':file-path="props.filePath"');
    expect(paneRichEditoSource).toContain(':file-name="props.fileName"');
    expect(editorSource).toContain(':file-path="props.filePath"');
    expect(editorSource).toContain(':file-name="editorTitle"');
    expect(sidebarSource).toContain('handleChatInsertFileReference');
    expect(sidebarSource).toContain('handleFileReferenceInsert');
    expect(sidebarSource).toContain('insertTextAtCursor');
    expect(sidebarSource).toContain('startLine');
    expect(sidebarSource).toContain('endLine');
    expect(sidebarSource).toContain('0|0');
    expect(sidebarSource).toContain('onChatFileReferenceInsert');
    expect(sidebarSource).toContain('insertTextAtCursor');
    expect(sidebarSource).toContain('type ChatFileReferenceInsertPayload');
    expect(sidebarSource).toContain('referenceId: nanoid()');
    expect(sidebarSource).toContain('documentId: toolContext?.document.id || reference.filePath || reference.fileName');
    expect(sidebarSource).toContain('async function persistReferenceSnapshots');
    expect(sidebarSource).toContain('chatStorage.upsertReferenceSnapshots([snapshot])');
    expect(sidebarSource).toContain('getActiveDraftReferences');
    expect(sidebarSource).toContain('formatLineRange');
  });
});
