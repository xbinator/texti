// @vitest-environment jsdom
/**
 * @file BPromptEditorRegression.test.ts
 * @description BPromptEditor 回归测试，覆盖空态占位与文件引用 chip 行为 (CodeMirror 6).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EditorState } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import { describe, expect, test, vi } from 'vitest';
import { editableCompartment, readOnlyCompartment, themeCompartment } from '@/components/BPromptEditor/extensions/base';
import { createPasteHandlerExtension } from '@/components/BPromptEditor/extensions/pasteHandler';
import { createPlaceholderExtension } from '@/components/BPromptEditor/extensions/placeholder';
import { triggerStateField, setTriggerActiveIndex, closeTrigger } from '@/components/BPromptEditor/extensions/triggerState';
import { variableChipField } from '@/components/BPromptEditor/extensions/variableChip';
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

  test('uses v-show with editorIsEmpty ref for placeholder visibility', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');

    // CodeMirror 6 implementation uses v-show with editorIsEmpty ref
    expect(source).toContain('v-show="editorIsEmpty"');
    expect(source).toContain('const editorIsEmpty = ref(true)');
    expect(source).not.toContain('data-empty="true"');
  });

  test('renders placeholder as a separate overlay instead of editor pseudo content', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');

    expect(source).toContain('class="b-prompt-editor__placeholder"');
    expect(source).not.toContain("&[data-empty='true']::before");
  });

  test('drives placeholder visibility from a reactive editor empty ref in index.vue', () => {
    const indexSource = readSource('src/components/BPromptEditor/index.vue');

    // editorIsEmpty is defined locally in index.vue for CodeMirror 6
    expect(indexSource).toContain('const editorIsEmpty = ref(true)');
    expect(indexSource).toContain('editorIsEmpty.value = newValue.trim().length === 0');
    // useEditorCore.ts no longer exists in CodeMirror 6 migration
  });

  test('uses CodeMirror built-in undo/redo without custom history hooks', () => {
    const indexSource = readSource('src/components/BPromptEditor/index.vue');

    // CodeMirror 6 has built-in undo/redo via EditorView.undo/redo
    // No custom undoHistory/redoHistory refs needed
    expect(indexSource).not.toContain('undoHistory');
    expect(indexSource).not.toContain('redoHistory');
    // useEditorCore.ts and useEditorKeyboard.ts no longer exist
  });
});

describe('BPromptEditor DOM safety regressions', () => {
  test('captures and restores selection using CodeMirror selection model', () => {
    const indexSource = readSource('src/components/BPromptEditor/index.vue');

    // CodeMirror 6 uses its own selection model
    expect(indexSource).toContain('lastSelection');
    expect(indexSource).toContain('captureCursorPosition');
    expect(indexSource).toContain('view.value.state.selection');
    // useEditorCore.ts and useEditorSelection.ts no longer exist in CodeMirror 6 migration
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

  test('keeps file reference chip support wired through the prompt editor insert API', () => {
    const indexSource = readSource('src/components/BPromptEditor/index.vue');
    const encoderSource = readSource('src/components/BPromptEditor/hooks/useVariableEncoder.ts');

    // insertFileReference is exposed via defineExpose in CodeMirror 6
    expect(indexSource).toContain('insertFileReference');
    expect(indexSource).toContain('captureCursorPosition');
    expect(indexSource).toContain('defineExpose');
    // createFileReferenceSpan and isChipElement are in useVariableEncoder.ts
    expect(encoderSource).toContain('createFileReferenceSpan');
    expect(encoderSource).toContain('isChipElement');
    // useEditorTrigger.ts no longer exists in CodeMirror 6 migration
  });
});

describe('BPromptEditor variableChip extension', () => {
  // Use the actual variableChipField to test buildDecorations behavior
  function getDecorations(doc: string) {
    const state = EditorState.create({ doc, extensions: [variableChipField] });
    return state.field(variableChipField);
  }

  function iterMarks(deco: any): Array<{ from: number; to: number; class: string }> {
    const results: Array<{ from: number; to: number; class: string }> = [];
    if (!deco) return results;
    for (let iter = deco.iter(); iter.value; iter.next()) {
      results.push({
        from: iter.from,
        to: iter.to,
        class: iter.value.spec.class
      });
    }
    return results;
  }

  test('renders {{variable}} as b-prompt-chip mark', () => {
    const deco = getDecorations('hello {{USER}} world');
    const marks = iterMarks(deco);
    expect(marks).toHaveLength(1);
    expect(marks[0].class).toBe('b-prompt-chip');
  });

  test('renders {{file-ref:path|name}} as b-prompt-chip--file mark', () => {
    const deco = getDecorations('{{file-ref:src%2Ffoo%2Fbar.ts|bar.ts}}');
    const marks = iterMarks(deco);
    expect(marks).toHaveLength(1);
    expect(marks[0].class).toBe('b-prompt-chip b-prompt-chip--file');
  });

  test('does not render incomplete {{variable without }}', () => {
    const deco = getDecorations('hello {{incomplete');
    const marks = iterMarks(deco);
    expect(marks).toHaveLength(0);
  });

  test('renders multiple chips in one document', () => {
    const deco = getDecorations('{{var1}} and {{var2}} and {{file-ref:path|name}}');
    const marks = iterMarks(deco);
    expect(marks).toHaveLength(3);
    expect(marks[0].class).toBe('b-prompt-chip');
    expect(marks[1].class).toBe('b-prompt-chip');
    expect(marks[2].class).toBe('b-prompt-chip b-prompt-chip--file');
  });

  test('does not render chip with newline inside', () => {
    const deco = getDecorations('{{var\n}}');
    const marks = iterMarks(deco);
    expect(marks).toHaveLength(0);
  });
});

describe('BPromptEditor triggerState extension', () => {
  test('exports setTriggerActiveIndex and closeTrigger StateEffects', () => {
    expect(setTriggerActiveIndex).toBeDefined();
    expect(closeTrigger).toBeDefined();
    // StateEffect instances have .of() method
    expect(typeof setTriggerActiveIndex.of).toBe('function');
    expect(typeof closeTrigger.of).toBe('function');
  });

  test('exports triggerStateField StateField', () => {
    expect(triggerStateField).toBeDefined();
    expect(typeof triggerStateField).toBe('object');
  });

  test('source code contains correct getTriggerContext logic', () => {
    const source = readSource('src/components/BPromptEditor/extensions/triggerState.ts');
    // Should check for {{ lastIndex
    expect(source).toContain("lastIndexOf('{{')");
    // Should reject if afterOpen includes }}
    expect(source).toContain("includes('}}')");
    // Should reject if non-empty selection (using optional chaining)
    expect(source).toContain('selection?.main.empty');
    // Should reject } and \n
    expect(source).toContain('[{}\\n]');
  });

  test('StateField update handles setTriggerActiveIndex and closeTrigger effects', () => {
    const source = readSource('src/components/BPromptEditor/extensions/triggerState.ts');
    // Should have effect handling
    expect(source).toContain('tr.effects');
    expect(source).toContain('setTriggerActiveIndex');
    expect(source).toContain('closeTrigger');
  });

  test('triggerStateField is used in index.vue', () => {
    const indexSource = readSource('src/components/BPromptEditor/index.vue');
    expect(indexSource).toContain('triggerStateField');
    expect(indexSource).toContain('createTriggerPlugin');
    expect(indexSource).toContain('setTriggerActiveIndex');
    expect(indexSource).toContain('closeTrigger');
  });
});

describe('BPromptEditor base extension exports', () => {
  test('exports editableCompartment, readOnlyCompartment, themeCompartment', () => {
    expect(editableCompartment).toBeDefined();
    expect(readOnlyCompartment).toBeDefined();
    expect(themeCompartment).toBeDefined();
  });
});

describe('BPromptEditor placeholder extension', () => {
  test('createPlaceholderExtension returns an Extension', () => {
    const ext = createPlaceholderExtension('请输入内容...');
    expect(ext).toBeDefined();
    expect(typeof ext).toBe('object');
  });
});

describe('BPromptEditor pasteHandler extension', () => {
  test('createPasteHandlerExtension returns an Extension', () => {
    const ext = createPasteHandlerExtension();
    expect(ext).toBeDefined();
    expect(typeof ext).toBe('object');
  });
});

describe('BPromptEditor index.vue integration', () => {
  test('uses defineModel for v-model:value', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');
    expect(source).toContain("defineModel<string>('value'");
  });

  test('emits change event', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');
    expect(source).toContain("emit('change'");
  });

  test('emits submit event', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');
    expect(source).toContain("emit('submit'");
  });

  test('exposes focus, captureCursorPosition, insertFileReference', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');
    expect(source).toContain('defineExpose');
    expect(source).toContain('focus');
    expect(source).toContain('captureCursorPosition');
    expect(source).toContain('insertFileReference');
  });

  test('has VariableSelect integration', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');
    expect(source).toContain('VariableSelect');
    expect(source).toContain('@select');
    expect(source).toContain('@update:active-index');
  });

  test('uses triggerVisible, triggerPosition, triggerActiveIndex, triggerQuery refs', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');
    expect(source).toContain('triggerVisible');
    expect(source).toContain('triggerPosition');
    expect(source).toContain('triggerActiveIndex');
    expect(source).toContain('triggerQuery');
  });

  test('watches disabled and maxHeight changes', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');
    expect(source).toContain('props.disabled');
    expect(source).toContain('editableCompartment.reconfigure');
    expect(source).toContain('readOnlyCompartment.reconfigure');
    expect(source).toContain('resolvedMaxHeight');
    expect(source).toContain('themeCompartment.reconfigure');
  });

  test('destroys EditorView on unmount', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');
    expect(source).toContain('onBeforeUnmount');
    expect(source).toContain('view.value?.destroy()');
  });

  test('uses Annotation.define to prevent circular updates', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');
    expect(source).toContain('Annotation.define');
    expect(source).toContain('externalUpdate');
  });

  test('watches modelValue for external sync', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');
    expect(source).toContain('watch(');
    expect(source).toContain('modelValue.value');
  });

  test('filteredVariables computed respects triggerQuery', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');
    expect(source).toContain('triggerQuery.value');
    expect(source).toContain('filteredVariables');
  });

  test('props have correct defaults', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');
    expect(source).toContain("placeholder: '请输入内容...'");
    expect(source).toContain('disabled: false');
    expect(source).toContain('submitOnEnter: false');
    expect(source).toContain('maxHeight: undefined');
  });

  test('keymap Enter handler emits submit when submitOnEnter is true', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');
    expect(source).toContain('props.submitOnEnter');
    expect(source).toContain("emit('submit')");
  });

  test('insertFileReference uses lastSelection or current selection', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');
    expect(source).toContain('lastSelection.value ?? view.value.state.selection');
  });

  test('handleVariableSelect replaces from-to range with variable token', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');
    expect(source).toContain('triggerState.from');
    expect(source).toContain('triggerState.to');
    expect(source).toContain('{{${variable.value}}');
  });

  test('closeTrigger effect is dispatched on variable select', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');
    expect(source).toContain('closeTrigger.of');
  });

  test('setTriggerActiveIndex effect is dispatched on index change', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');
    expect(source).toContain('setTriggerActiveIndex.of');
  });

  test('CSS has b-prompt-chip and b-prompt-chip--file styles', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');
    expect(source).toContain('.b-prompt-chip');
    expect(source).toContain('.b-prompt-chip--file');
  });
});
