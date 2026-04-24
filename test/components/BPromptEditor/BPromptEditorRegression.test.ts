// @vitest-environment jsdom
/**
 * @file BPromptEditorRegression.test.ts
 * @description BPromptEditor 回归测试，覆盖空态占位与文件引用 chip 行为。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { isPromptEditorEffectivelyEmpty, useVariableEncoder } from '@/components/BPromptEditor/hooks/useVariableEncoder';

/**
 * 读取组件源码。
 * @param relativePath - 相对仓库根目录的源码路径。
 * @returns 源码字符串。
 */
function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf-8');
}

describe('BPromptEditor placeholder state', () => {
  test('treats editor artifacts as empty content', () => {
    expect(isPromptEditorEffectivelyEmpty('')).toBe(true);
    expect(isPromptEditorEffectivelyEmpty('\n')).toBe(true);
    expect(isPromptEditorEffectivelyEmpty('\u00A0')).toBe(true);
    expect(isPromptEditorEffectivelyEmpty('\u200B')).toBe(true);
    expect(isPromptEditorEffectivelyEmpty('\n\u00A0\u200B')).toBe(true);
    expect(isPromptEditorEffectivelyEmpty('hello')).toBe(false);
    expect(isPromptEditorEffectivelyEmpty('{{ USER_NAME }}')).toBe(false);
  });

  test('uses an explicit empty-state attribute instead of relying on :empty', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');

    expect(source).toContain('data-empty="true"');
    expect(source).not.toContain('&:empty::before');
  });

  test('renders placeholder as a separate overlay instead of editor pseudo content', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');

    expect(source).toContain('class="b-prompt-editor__placeholder"');
    expect(source).not.toContain("&[data-empty='true']::before");
  });

  test('drives placeholder visibility from a reactive editor empty ref', () => {
    const indexSource = readSource('src/components/BPromptEditor/index.vue');
    const coreSource = readSource('src/components/BPromptEditor/hooks/useEditorCore.ts');

    expect(indexSource).toContain(
      'const { selectionHook, updateModelValue, normalizeInlineTokens, initializeEditor, cleanup, editorIsEmpty, undoHistory, redoHistory } = useEditorCore'
    );
    expect(indexSource).not.toContain("computed<boolean>(() => editorRef.value?.dataset.empty === 'true')");
    expect(coreSource).toContain('const editorIsEmpty = ref(true);');
    expect(coreSource).toContain('editorIsEmpty.value = isPromptEditorEffectivelyEmpty(resolvedContent);');
    expect(coreSource).toContain('editorIsEmpty');
  });

  test('wires custom undo and redo support for prompt editing', () => {
    const indexSource = readSource('src/components/BPromptEditor/index.vue');
    const coreSource = readSource('src/components/BPromptEditor/hooks/useEditorCore.ts');
    const keyboardSource = readSource('src/components/BPromptEditor/hooks/useEditorKeyboard.ts');

    expect(indexSource).toContain('undoHistory');
    expect(indexSource).toContain('redoHistory');
    expect(coreSource).toContain('interface EditorHistorySnapshot');
    expect(coreSource).toContain('function recordHistorySnapshot');
    expect(coreSource).toContain('function undoHistory');
    expect(coreSource).toContain('function redoHistory');
    expect(keyboardSource).toContain('onUndo: () => void;');
    expect(keyboardSource).toContain('onRedo: () => void;');
    expect(keyboardSource).toContain("if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'z')");
  });
});

describe('BPromptEditor DOM safety regressions', () => {
  test('restores zero-rect probing selection from the parent container', () => {
    const source = readSource('src/components/BPromptEditor/hooks/useEditorSelection.ts');

    expect(source).toContain('restored.setStart(parentNode, restoredOffset)');
    expect(source).not.toContain('setStartBefore(span)');
  });

  test('restores caret after variable deletion by parent offset', () => {
    const source = readSource('src/components/BPromptEditor/hooks/useEditorTrigger.ts');

    expect(source).toContain('const targetOffset = Math.min(variableIndex, parent.childNodes.length)');
    expect(source).toContain('newRange.setStart(parent, targetOffset)');
    expect(source).not.toContain('setStartBefore(nextNode)');
  });

  test('captures and restores focused selection snapshots across controlled updates', () => {
    const source = readSource('src/components/BPromptEditor/hooks/useEditorCore.ts');

    expect(source).toContain('function captureSelectionSnapshot');
    expect(source).toContain('function restoreSelectionSnapshot');
    expect(source).not.toContain('const newTextNode = editorRef.value.firstChild as Text | null;');
  });
});

describe('BPromptEditor file reference chips', () => {
  test('serializes file reference chips back to stable reference-id placeholders', () => {
    const { createFileReferenceSpan, decodeVariables } = useVariableEncoder({
      getVariableLabel: () => undefined
    });
    const reference = {
      referenceId: 'ref_123',
      documentId: 'doc_123',
      filePath: 'src/foo/file.ts',
      fileName: 'file.ts',
      line: '123-145'
    };
    const chip = createFileReferenceSpan(reference);

    expect(chip.getAttribute('data-reference-id')).toBe('ref_123');
    expect(chip.getAttribute('data-document-id')).toBe('doc_123');
    expect(decodeVariables(`请看 ${chip.outerHTML}`)).toBe('请看 {{file-ref:ref_123}}');
  });

  test('renders file reference placeholders as non-editable inline chips', () => {
    const { createFileReferenceSpan, encodeVariables } = useVariableEncoder({
      getVariableLabel: () => undefined
    });
    createFileReferenceSpan({
      referenceId: 'ref_123',
      documentId: 'doc_123',
      filePath: 'src/foo/file.ts',
      fileName: 'file.ts',
      line: '123-145'
    });

    const encoded = encodeVariables('定位 {{file-ref:ref_123}}');
    const container = document.createElement('div');
    container.innerHTML = encoded;
    const chip = container.querySelector('[data-value="file-reference"]');

    expect(chip?.getAttribute('contenteditable')).toBe('false');
    expect(chip?.getAttribute('data-reference-id')).toBe('ref_123');
    expect(chip?.getAttribute('data-document-id')).toBe('doc_123');
    expect(chip?.textContent).toBe('file.ts:123-145');
  });

  test('renders unsaved file reference placeholders as non-editable inline chips', () => {
    const { createFileReferenceSpan, encodeVariables, decodeVariables } = useVariableEncoder({
      getVariableLabel: () => undefined
    });
    createFileReferenceSpan({
      referenceId: 'ref_temp',
      documentId: 'doc_temp',
      filePath: null,
      fileName: '临时笔记',
      line: '3'
    });

    const encoded = encodeVariables('定位 {{file-ref:ref_temp}}');
    const container = document.createElement('div');
    container.innerHTML = encoded;
    const chip = container.querySelector('[data-value="file-reference"]');

    expect(chip?.getAttribute('contenteditable')).toBe('false');
    expect(chip?.getAttribute('data-reference-id')).toBe('ref_temp');
    expect(chip?.getAttribute('data-document-id')).toBe('doc_temp');
    expect(chip?.textContent).toBe('临时笔记:3');
    expect(decodeVariables(encoded)).toBe('定位 {{file-ref:ref_temp}}');
  });

  test('keeps file reference chip support wired through the prompt editor insert API and deletion path', () => {
    const indexSource = readSource('src/components/BPromptEditor/index.vue');
    const triggerSource = readSource('src/components/BPromptEditor/hooks/useEditorTrigger.ts');

    expect(indexSource).toContain('function insertFileReference');
    expect(indexSource).toContain('defineExpose({ focus, insertFileReference })');
    expect(triggerSource).toContain('createFileReferenceSpan');
    expect(triggerSource).toContain('insertFileReference');
    expect(triggerSource).toContain('isChipElement');
  });
});
