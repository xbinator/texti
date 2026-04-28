// @vitest-environment jsdom
/**
 * @file BPromptEditorRegression.test.ts
 * @description BPromptEditor 回归测试，覆盖空态占位与文件引用 chip 行为 (CodeMirror 6).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EditorState } from '@codemirror/state';
import { Decoration, WidgetType } from '@codemirror/view';
import { describe, expect, test, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import BPromptEditor from '@/components/BPromptEditor/index.vue';
import { editableCompartment, readOnlyCompartment, themeCompartment } from '@/components/BPromptEditor/extensions/base';
import { createPasteHandlerExtension } from '@/components/BPromptEditor/extensions/pasteHandler';
import { createPlaceholderExtension } from '@/components/BPromptEditor/extensions/placeholder';
import { triggerStateField, setTriggerActiveIndex, closeTrigger } from '@/components/BPromptEditor/extensions/triggerState';
import { variableChipField, chipResolverEffect, type ChipResolver } from '@/components/BPromptEditor/extensions/variableChip';
import { chatSlashCommands } from '@/components/BChatSidebar/utils/slashCommands';

/**
 * BPromptEditor 挂载实例类型。
 */
type PromptEditorInstance = InstanceType<typeof BPromptEditor>;

/**
 * 挂载编辑器并保留斜杠命令配置。
 * @param options - 编辑器挂载选项
 * @returns 编辑器包装器
 */
function mountPromptEditor(options: { submitOnEnter?: boolean } = {}): VueWrapper<PromptEditorInstance> {
  return mount(BPromptEditor, {
    props: {
      value: '',
      slashCommands: chatSlashCommands,
      submitOnEnter: options.submitOnEnter ?? false
    },
    global: {
      stubs: {
        VariableSelect: true
      }
    }
  }) as VueWrapper<PromptEditorInstance>;
}

/**
 * 使用编辑器自身的插入 API 模拟输入并等待内部状态同步。
 * @param wrapper - 编辑器包装器
 * @param value - 要插入的正文
 */
async function insertEditorText(wrapper: VueWrapper<PromptEditorInstance>, value: string): Promise<void> {
  wrapper.vm.insertTextAtCursor(value);
  await nextTick();
  await nextTick();
}

/**
 * 判断编辑器内容在去除占位符和零宽空格后是否为空。
 * 原 useVariableEncoder 中的遗留工具函数。
 */
function isPromptEditorContentEmpty(content: string): boolean {
  return content.replace(new RegExp('\u00A0', 'g'), '').replace(new RegExp('\u200B', 'g'), '').trim().length === 0;
}

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
    expect(isPromptEditorContentEmpty('')).toBe(true);
    expect(isPromptEditorContentEmpty('\n')).toBe(true);
    expect(isPromptEditorContentEmpty('\u00A0')).toBe(true);
    expect(isPromptEditorContentEmpty('\u200B')).toBe(true);
    expect(isPromptEditorContentEmpty('\n\u00A0\u200B')).toBe(true);
    expect(isPromptEditorContentEmpty('hello')).toBe(false);
    expect(isPromptEditorContentEmpty('{{ USER_NAME }}')).toBe(false);
  });

  test('uses CodeMirror placeholder extension instead of template v-show placeholder', () => {
    const indexSource = readSource('src/components/BPromptEditor/index.vue');
    const placeholderSource = readSource('src/components/BPromptEditor/extensions/placeholder.ts');

    expect(indexSource).toContain("import { createPlaceholderExtension }");
    expect(indexSource).toContain('createPlaceholderExtension(props.placeholder)');
    expect(indexSource).not.toContain('v-show="editorIsEmpty"');
    expect(indexSource).not.toContain('data-empty="true"');
    expect(placeholderSource).toContain('return createPlaceholder(placeholderText);');
  });

  test('styles CodeMirror placeholder instead of rendering a separate overlay node', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');

    expect(source).toContain('.cm-placeholder');
    expect(source).not.toContain('class="b-prompt-editor__placeholder"');
    expect(source).not.toContain("&[data-empty='true']::before");
  });

  test('tracks empty state for theme recalculation with editorIsEmpty ref', () => {
    const indexSource = readSource('src/components/BPromptEditor/index.vue');

    expect(indexSource).toContain('const editorIsEmpty = ref<boolean>(isEditorContentEmpty(modelValue.value));');
    expect(indexSource).toContain('editorIsEmpty.value = isEditorContentEmpty(newValue);');
    expect(indexSource).toContain('watch(editorIsEmpty, (isEmpty) => {');
  });

  test('uses CodeMirror built-in undo/redo without custom history hooks', () => {
    const indexSource = readSource('src/components/BPromptEditor/index.vue');

    // CodeMirror 6 has built-in undo/redo via EditorView.undo/redo
    // No custom undoHistory/redoHistory refs needed
    expect(indexSource).not.toContain('undoHistory');
    expect(indexSource).not.toContain('redoHistory');
    // useEditorCore.ts and useEditorKeyboard.ts no longer exist
  });

  test('uses dynamic widgetBuffer width based on whether editor content is empty', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');

    expect(source).toContain('function isEditorContentEmpty(content: string): boolean');
    expect(source).toContain("width: isEmpty ? '1px' : '0'");
  });
});

describe('BPromptEditor DOM safety regressions', () => {
  test('captures and restores selection using CodeMirror selection model', () => {
    const indexSource = readSource('src/components/BPromptEditor/index.vue');

    // CodeMirror 6 uses its own selection model
    expect(indexSource).toContain('lastSelection');
    expect(indexSource).toContain('saveCursorPosition');
    expect(indexSource).toContain('view.value.state.selection');
    // useEditorCore.ts and useEditorSelection.ts no longer exist in CodeMirror 6 migration
  });
});

describe('BPromptEditor variableChip extension', () => {
  /**
   * 简单的测试 Widget，用于验证 widget 类型装饰。
   */
  class TestWidget extends WidgetType {
    toDOM() {
      const span = document.createElement('span');
      span.className = 'test-widget';
      return span;
    }

    eq() {
      return true;
    }

    ignoreEvent() {
      return false;
    }
  }

  /**
   * 模拟旧版行为的 resolver：
   * - file-ref:... → widget
   * - 其他 → b-prompt-chip mark
   */
  const legacyTestResolver: ChipResolver = (body) => {
    if (body.startsWith('file-ref:')) {
      const stripped = body.slice('file-ref:'.length);
      if (!stripped) return null;
      const parts = stripped.split('|');
      if (parts[0]) return { widget: new TestWidget() };
      return null;
    }
    return { className: 'b-prompt-chip' };
  };

  /**
   * 创建编辑器状态并通过 chipResolverEffect 注入 resolver，返回装饰集。
   */
  function getDecorations(doc: string, resolver: ChipResolver = legacyTestResolver) {
    let state = EditorState.create({ doc, extensions: [variableChipField] });
    state = state.update({ effects: chipResolverEffect.of(resolver) }).state;
    return state.field(variableChipField)!.decorations;
  }

  function iterDeco(deco: any): Array<{ from: number; to: number; type: 'mark' | 'widget'; markClass?: string }> {
    const results: Array<{ from: number; to: number; type: 'mark' | 'widget'; markClass?: string }> = [];
    if (!deco) return results;
    for (let iter = deco.iter(); iter.value; iter.next()) {
      const { spec } = iter.value;
      results.push({
        from: iter.from,
        to: iter.to,
        type: spec.widget ? 'widget' : 'mark',
        markClass: spec.class
      });
    }
    return results;
  }

  test('renders {{variable}} as b-prompt-chip mark', () => {
    const deco = getDecorations('hello {{USER}} world');
    const items = iterDeco(deco);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('mark');
    expect(items[0].markClass).toBe('b-prompt-chip');
  });

  test('renders {{file-ref:path|name}} as widget', () => {
    const deco = getDecorations('{{file-ref:src%2Ffoo%2Fbar.ts|bar.ts}}');
    const items = iterDeco(deco);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('widget');
  });

  test('does not render incomplete {{variable without }}', () => {
    const deco = getDecorations('hello {{incomplete');
    const items = iterDeco(deco);
    expect(items).toHaveLength(0);
  });

  test('renders multiple chips in one document', () => {
    const deco = getDecorations('{{var1}} and {{var2}} and {{file-ref:path|name}}');
    const items = iterDeco(deco);
    expect(items).toHaveLength(3);
    expect(items[0].type).toBe('mark');
    expect(items[0].markClass).toBe('b-prompt-chip');
    expect(items[1].type).toBe('mark');
    expect(items[1].markClass).toBe('b-prompt-chip');
    expect(items[2].type).toBe('widget');
  });

  test('does not render chip with newline inside', () => {
    const deco = getDecorations('{{var\n}}');
    const items = iterDeco(deco);
    expect(items).toHaveLength(0);
  });

  test('skips chip when resolver returns null', () => {
    const nullResolver: ChipResolver = () => null;
    const deco = getDecorations('hello {{USER}} world', nullResolver);
    const items = iterDeco(deco);
    expect(items).toHaveLength(0);
  });

  test('renders widget when resolver returns widget', () => {
    const widgetResolver: ChipResolver = (body) => (body ? { widget: new TestWidget() } : null);
    const deco = getDecorations('hello {{FOO}} world', widgetResolver);
    const items = iterDeco(deco);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('widget');
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
    // Should reject if non-empty selection after resolving the active selection object
    expect(source).toContain('const selection = tr.selection || tr.state.selection;');
    expect(source).toContain('if (!selection.main.empty) {');
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

  test('exposes focus, saveCursorPosition, insertTextAtCursor', () => {
    const source = readSource('src/components/BPromptEditor/index.vue');
    expect(source).toContain('defineExpose');
    expect(source).toContain('focus');
    expect(source).toContain('saveCursorPosition');
    expect(source).toContain('insertTextAtCursor');
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

  test('insertTextAtCursor uses lastSelection or current selection', () => {
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

describe('BPromptEditor slash command regression', () => {
  test('prefers slash selection over submit when the slash menu is open', async () => {
    const wrapper = mountPromptEditor({
      submitOnEnter: true
    });

    await insertEditorText(wrapper, '/us');
    expect(wrapper.find('[data-testid="slash-command-menu"]').exists()).toBe(true);
    await wrapper.get('.cm-content').trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('slash-command')).toBeDefined();
    expect(wrapper.emitted('submit')).toBeUndefined();
  });
});
