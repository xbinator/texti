/**
 * @file file-reference-insert.test.ts
 * @description 编辑器文件引用插入聊天输入框链路回归测试。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { CHAT_FILE_REFERENCE_INSERT_EVENT, isChatFileReferenceInsertPayload } from '@/shared/chat/fileReference';

/**
 * 读取源码文件。
 * @param relativePath - 相对仓库根目录的源码路径
 */
function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf-8');
}

describe('chat file reference insert event utilities', () => {
  test('validates file reference insert payloads', () => {
    expect(CHAT_FILE_REFERENCE_INSERT_EVENT).toBe('chat:file-reference:insert');
    // 正常范围
    expect(
      isChatFileReferenceInsertPayload({
        filePath: 'src/foo/file.ts',
        fileName: 'file.ts',
        startLine: 12,
        endLine: 14,
        renderStartLine: 10,
        renderEndLine: 12
      })
    ).toBe(true);
    // 单行
    expect(
      isChatFileReferenceInsertPayload({
        filePath: null,
        fileName: '临时笔记',
        startLine: 3,
        endLine: 3,
        renderStartLine: 2,
        renderEndLine: 2
      })
    ).toBe(true);
    // 无行号场景允许 startLine === endLine === 0
    expect(
      isChatFileReferenceInsertPayload({
        filePath: null,
        fileName: '临时笔记',
        startLine: 0,
        endLine: 0,
        renderStartLine: 0,
        renderEndLine: 0
      })
    ).toBe(true);
    // startLine=0 但 endLine>0 歧义，拒绝
    expect(
      isChatFileReferenceInsertPayload({
        filePath: null,
        fileName: '临时笔记',
        startLine: 0,
        endLine: 5,
        renderStartLine: 0,
        renderEndLine: 5
      })
    ).toBe(false);
    // startLine > endLine 非法
    expect(
      isChatFileReferenceInsertPayload({
        filePath: 'src/foo/file.ts',
        fileName: 'file.ts',
        startLine: 5,
        endLine: 2,
        renderStartLine: 3,
        renderEndLine: 2
      })
    ).toBe(false);
    // 渲染行号缺失时拒绝
    expect(isChatFileReferenceInsertPayload({ filePath: 'src/foo/file.ts', fileName: 'file.ts', startLine: 5, endLine: 5 })).toBe(false);
  });
});

describe('chat file reference insert wiring', () => {
  test('wires editor selection toolbar to chat sidebar through BChat insert API', () => {
    const richEditorContentSource = readSource('src/components/BEditor/components/RichEditorContent.vue');
    const selectionToolbarSource = readSource('src/components/BEditor/components/SelectionToolbar.vue');
    const richToolbarHostSource = readSource('src/components/BEditor/components/SelectionToolbarRich.vue');
    const selectionAssistantSource = readSource('src/components/BEditor/hooks/useSelectionAssistant.ts');
    const richAdapterSource = readSource('src/components/BEditor/adapters/richSelectionAssistant.ts');
    const sourceAdapterSource = readSource('src/components/BEditor/adapters/sourceSelectionAssistant.ts');
    const sidebarSource = readSource('src/components/BChatSidebar/index.vue');
    const fileReferenceHookSource = readSource('src/components/BChatSidebar/hooks/useFileReference.ts');

    expect(selectionToolbarSource).toContain("$emit('reference')");
    expect(selectionToolbarSource).toContain('插入对话');
    expect(richToolbarHostSource).toContain('@reference="$emit(\'reference\')"');
    expect(richEditorContentSource).toContain('@reference="assistant.insertReference()"');
    expect(selectionAssistantSource).toContain('const payload = adapter.buildSelectionReference(range);');
    expect(selectionAssistantSource).toContain('emitChatFileReferenceInsert(payload);');
    expect(richAdapterSource).toContain('buildSelectionReference(range: SelectionAssistantRange): SelectionReferencePayload | null {');
    expect(sourceAdapterSource).toContain('buildSelectionReference(range: SelectionAssistantRange): SelectionReferencePayload {');
    expect(sidebarSource).toContain('insertTextAtCursor');
    expect(sidebarSource).toContain('useFileReference');
    expect(fileReferenceHookSource).toContain('handleFileReferenceInsert');
    expect(fileReferenceHookSource).toContain('onChatFileReferenceInsert');
    expect(fileReferenceHookSource).toContain('ChatFileReferenceInsertPayload');
    expect(fileReferenceHookSource).toContain('insertReference');
    expect(fileReferenceHookSource).toContain('renderStartLine');
    expect(fileReferenceHookSource).toContain('renderEndLine');
  });
});
