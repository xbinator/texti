/**
 * @file code-editor.test.ts
 * @description 验证 Widget JS 脚本当前页代码编辑器。
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineComponent, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetData, WidgetSchemaObject } from '@/components/BWidget/types';
import { createDefaultWidgetData } from '@/components/BWidget/utils/widgetData';
import { createDefaultWidgetExecuteMethod } from '@/components/BWidget/utils/widgetExecuteMethod';
import CodeEditor from '@/views/widget/components/CodeEditor.vue';

/** TypeScript 类型推导测试用最小基础类型声明。 */
const TYPESCRIPT_TEST_BASE_LIB = `
interface Boolean {}
interface Function {}
interface IArguments {}
interface Number {}
interface Object {}
interface RegExp {}
interface String {}
interface ThisType<T> {}
interface Array<T> {
  length: number
  [index: number]: T
}
interface Promise<T> {}
type Partial<T> = {
  [P in keyof T]?: T[P]
}
type Record<K extends string | number | symbol, T> = {
  [P in K]: T
}
`;

/** 已移除的旧根变量名。 */
const REMOVED_LEGACY_ROOT = ['last', 'Result'].join('');
/** Monaco 聚焦方法测试替身。 */
const focusEditorMock = vi.fn<() => void>();

/**
 * Monaco 测试替身属性。
 */
interface BMonacoStubProps {
  /** 编辑器语言 */
  language?: string;
  /** 类型提示声明 */
  extraLibs?: Array<{ content: string; filePath?: string }>;
  /** 编辑器配置 */
  options?: {
    /** 是否自动换行 */
    wordWrap?: boolean;
    /** 是否启用搜索 */
    search?: boolean;
    /** 是否启用粘性标题 */
    stickyScroll?: boolean;
    /** TypeScript 编译选项 */
    typescriptCompilerOptions?: {
      /** 语言库 */
      lib?: string[];
      /** 是否禁止隐式 this */
      noImplicitThis?: boolean;
    };
  };
  /** 当前代码文本 */
  value?: string;
}

/**
 * 判断对象自身是否存在指定 key。
 * @param value - 对象值
 * @param key - 字段名
 * @returns 是否存在自有字段
 */
function hasOwnKey<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * 使用 TypeScript 编译器检查内存中的源码。
 * @param files - 文件名到源码的映射
 * @returns 诊断信息
 */
function getTypeScriptDiagnostics(files: Record<string, string>): readonly ts.Diagnostic[] {
  const compilerOptions: ts.CompilerOptions = {
    noEmit: true,
    noImplicitThis: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2020,
    typeRoots: [],
    types: []
  };
  const compilerHost = ts.createCompilerHost(compilerOptions);

  compilerHost.getSourceFile = (fileName: string, languageVersion: ts.ScriptTarget): ts.SourceFile | undefined => {
    if (!hasOwnKey(files, fileName)) {
      return undefined;
    }

    return ts.createSourceFile(fileName, files[fileName], languageVersion, true, ts.ScriptKind.TS);
  };
  compilerHost.fileExists = (fileName: string): boolean => hasOwnKey(files, fileName);
  compilerHost.readFile = (fileName: string): string | undefined => files[fileName];
  compilerHost.writeFile = (): void => undefined;
  compilerHost.getDefaultLibFileName = (): string => 'lib.d.ts';

  return ts.getPreEmitDiagnostics(ts.createProgram(Object.keys(files), compilerOptions, compilerHost));
}

/**
 * 将 TypeScript 诊断格式化为便于断言的文本。
 * @param diagnostics - 诊断信息
 * @returns 诊断文本
 */
function formatTypeScriptDiagnostics(diagnostics: readonly ts.Diagnostic[]): string[] {
  return diagnostics.map((diagnostic: ts.Diagnostic): string => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

/**
 * 使用 TypeScript LanguageService 读取指定光标处的补全名称。
 * @param files - 文件名到源码的映射
 * @param targetFileName - 读取补全的目标文件名
 * @param cursorMarker - 源码中的光标占位标记
 * @returns 补全项名称列表
 */
function getTypeScriptCompletionNames(files: Record<string, string>, targetFileName: string, cursorMarker: string): string[] {
  const targetSource = files[targetFileName];

  if (targetSource === undefined) {
    throw new Error(`缺少 TypeScript 补全目标文件：${targetFileName}`);
  }

  const cursorPosition = targetSource.indexOf(cursorMarker);

  if (cursorPosition < 0) {
    throw new Error(`缺少 TypeScript 补全光标标记：${cursorMarker}`);
  }

  const serviceFiles: Record<string, string> = {
    ...files,
    [targetFileName]: targetSource.replace(cursorMarker, '')
  };
  const compilerOptions: ts.CompilerOptions = {
    noEmit: true,
    noImplicitThis: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2020,
    typeRoots: [],
    types: []
  };
  const scriptVersions = Object.fromEntries(Object.keys(serviceFiles).map((fileName: string): [string, string] => [fileName, '0']));
  const languageServiceHost: ts.LanguageServiceHost = {
    fileExists: (fileName: string): boolean => hasOwnKey(serviceFiles, fileName),
    getCompilationSettings: (): ts.CompilerOptions => compilerOptions,
    getCurrentDirectory: (): string => '',
    getDefaultLibFileName: (): string => 'lib.d.ts',
    getScriptFileNames: (): string[] => Object.keys(serviceFiles),
    getScriptSnapshot: (fileName: string): ts.IScriptSnapshot | undefined => {
      const fileContent = serviceFiles[fileName];

      return fileContent === undefined ? undefined : ts.ScriptSnapshot.fromString(fileContent);
    },
    getScriptVersion: (fileName: string): string => scriptVersions[fileName] ?? '0',
    readFile: (fileName: string): string | undefined => serviceFiles[fileName]
  };
  const completions = ts.createLanguageService(languageServiceHost).getCompletionsAtPosition(targetFileName, cursorPosition, {});

  return completions?.entries.map((entry: ts.CompletionEntry): string => entry.name) ?? [];
}

/**
 * 创建 BMonaco 测试替身。
 * @returns BMonaco 测试替身
 */
function createBMonacoStub(): ReturnType<typeof defineComponent> {
  return defineComponent({
    name: 'BMonacoStub',
    props: {
      editorState: {
        type: Object,
        default: (): Record<string, unknown> => ({})
      },
      extraLibs: {
        type: Array,
        default: (): unknown[] => []
      },
      language: {
        type: String,
        default: ''
      },
      options: {
        type: Object,
        default: (): Record<string, unknown> => ({})
      },
      value: {
        type: String,
        default: ''
      }
    },
    emits: ['update:value', 'save'],
    setup(_props, { emit, expose }) {
      /**
       * 将 textarea 输入转换为 Monaco value 更新。
       * @param event - 原生输入事件
       */
      function handleInput(event: Event): void {
        if (event.target instanceof HTMLTextAreaElement) {
          emit('update:value', event.target.value);
        }
      }

      /**
       * 模拟 Monaco 聚焦方法。
       */
      function focusEditor(): void {
        focusEditorMock();
      }

      /**
       * 模拟 Monaco 保存快捷键事件。
       */
      function handleSave(): void {
        emit('save');
      }

      expose({ focusEditor });

      return { handleInput, handleSave };
    },
    template: [
      '<div>',
      '<textarea class="widget-code-monaco-stub" :value="value" @input="handleInput"></textarea>',
      '<button class="widget-code-monaco-save-stub" @click="handleSave"></button>',
      '</div>'
    ].join('')
  });
}

/**
 * 创建测试用天气入参 schema。
 * @returns 天气入参 schema
 */
function createWeatherInputSchema(): WidgetSchemaObject {
  return {
    type: 'object',
    description: '查询天气入参',
    properties: {
      city: {
        type: 'string',
        description: '城市名称，例如上海'
      },
      date: {
        type: 'string',
        description: '查询日期，例如今天或明天'
      },
      unit: {
        type: 'string',
        description: '温度单位，celsius 或 fahrenheit'
      }
    },
    required: ['city']
  };
}

/**
 * 创建测试 Widget 数据。
 * @returns Widget 数据
 */
function createWidgetData(): WidgetData {
  return {
    ...createDefaultWidgetData(),
    execute: createDefaultWidgetExecuteMethod(),
    inputSchema: createWeatherInputSchema()
  };
}

/**
 * 挂载 Widget 代码编辑器。
 * @param value - Widget 数据
 * @returns 测试包装器
 */
function mountCodeEditor(value: WidgetData = createWidgetData(), active = true): VueWrapper {
  return mount(CodeEditor, {
    props: {
      active,
      value
    },
    global: {
      stubs: {
        BMonaco: createBMonacoStub(),
        Icon: true
      }
    }
  });
}

/**
 * 读取 Monaco 测试替身属性。
 * @param wrapper - 页面包装器
 * @returns Monaco 属性
 */
function readMonacoProps(wrapper: VueWrapper): BMonacoStubProps {
  return wrapper.findComponent({ name: 'BMonacoStub' }).props() as BMonacoStubProps;
}

/**
 * 读取 CodeEditor 源码。
 * @returns CodeEditor 源码文本
 */
function readCodeEditorSource(): string {
  return readFileSync(resolve(process.cwd(), 'src/views/widget/components/CodeEditor.vue'), 'utf8');
}

describe('CodeEditor', (): void => {
  beforeEach((): void => {
    focusEditorMock.mockClear();
  });

  it('loads current script and updates widget data through value model', async (): Promise<void> => {
    const initialCode = [
      'export default class Weather extends Widget {',
      '  ready = false',
      '',
      '  async onMounted() {',
      '    this.ready = true',
      '  }',
      '}'
    ].join('\n');
    const nextCode = [
      'export default class Weather extends Widget {',
      '  async confirm() {',
      "    await this.$sendMessage({ content: [{ type: 'text', text: '确认下单' }] })",
      '  }',
      '}'
    ].join('\n');
    const widgetData = {
      ...createWidgetData(),
      execute: {
        enabled: false,
        description: '已有脚本说明',
        code: initialCode
      }
    };
    const wrapper = mountCodeEditor(widgetData);

    expect(wrapper.find('.code-editor').exists()).toBe(true);
    expect(wrapper.find('.widget-code-page__toolbar').exists()).toBe(false);
    expect(readMonacoProps(wrapper).language).toBe('typescript');
    expect(readMonacoProps(wrapper).options?.wordWrap).toBe(true);
    expect(readMonacoProps(wrapper).options?.search).toBe(true);
    expect(readMonacoProps(wrapper).options?.stickyScroll).toBe(true);
    expect(readMonacoProps(wrapper).options?.typescriptCompilerOptions?.lib).toEqual(['es2020']);
    expect(readMonacoProps(wrapper).options?.typescriptCompilerOptions?.noImplicitThis).toBe(true);
    expect(readMonacoProps(wrapper).value).toBe(initialCode);

    await wrapper.find('.widget-code-monaco-stub').setValue(nextCode);
    await nextTick();

    expect(wrapper.emitted<WidgetData[]>('update:value')?.[0]?.[0].execute).toEqual({
      enabled: false,
      description: '已有脚本说明',
      code: nextCode
    });
    wrapper.unmount();
  });

  it('does not expose the removed overlay close action', (): void => {
    const wrapper = mountCodeEditor({
      ...createWidgetData(),
      execute: {
        code: 'export default class Weather extends Widget {}'
      }
    });

    expect(wrapper.find('.widget-code-page__actions').exists()).toBe(false);
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(wrapper.emitted('update:value')).toBeUndefined();
    wrapper.unmount();
  });

  it('emits save when Monaco requests save', async (): Promise<void> => {
    const wrapper = mountCodeEditor({
      ...createWidgetData(),
      execute: {
        code: 'export default class Weather extends Widget {}'
      }
    });

    await wrapper.find('.widget-code-monaco-save-stub').trigger('click');

    expect(wrapper.emitted('save')).toHaveLength(1);
    wrapper.unmount();
  });

  it('syncs draft from the latest model when activated again', async (): Promise<void> => {
    const initialCode = 'export default class Weather extends Widget { onMounted() {} }';
    const wrapper = mountCodeEditor(
      {
        ...createWidgetData(),
        execute: {
          code: initialCode
        }
      },
      true
    );
    const nextWidgetData = {
      ...createWidgetData(),
      execute: {
        code: 'export default class Weather extends Widget { latest() {} }'
      }
    };

    await wrapper.find('.widget-code-monaco-stub').setValue('export default class Weather extends Widget { draft() {} }');
    await wrapper.setProps({ active: false });
    await wrapper.setProps({ value: nextWidgetData });
    await nextTick();

    expect(readMonacoProps(wrapper).value).toBe('export default class Weather extends Widget { draft() {} }');

    await wrapper.setProps({ active: true });
    await nextTick();

    expect(readMonacoProps(wrapper).value).toBe(nextWidgetData.execute.code);
    wrapper.unmount();
  });

  it('focuses Monaco when mounted as the active sidebar editor', async (): Promise<void> => {
    const wrapper = mountCodeEditor(
      {
        ...createWidgetData(),
        execute: {
          code: 'export default class Weather extends Widget { onMounted() {} }'
        }
      },
      true
    );

    await nextTick();
    await nextTick();

    expect(focusEditorMock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('keeps an empty script when syncing from the latest model', async (): Promise<void> => {
    const wrapper = mountCodeEditor(
      {
        ...createWidgetData(),
        execute: {
          code: 'export default class Weather extends Widget { onMounted() {} }'
        }
      },
      false
    );
    const nextWidgetData = {
      ...createWidgetData(),
      execute: {
        code: ''
      }
    };

    await wrapper.setProps({ value: nextWidgetData });
    await wrapper.setProps({ active: true });
    await nextTick();

    expect(readMonacoProps(wrapper).value).toBe('');
    wrapper.unmount();
  });

  it('allows the nested Monaco editor to shrink with sidebar width changes', (): void => {
    const source = readCodeEditorSource();

    expect(source).toContain('.code-editor {');
    expect(source).toContain('min-width: 0;');
    expect(source).toContain('.code-editor :deep(.b-editor-monaco),');
    expect(source).toContain('.code-editor :deep(.b-editor-monaco__host),');
  });

  it('creates editor type hints for nested, array and non-identifier input schema fields', (): void => {
    const wrapper = mountCodeEditor({
      ...createWidgetData(),
      inputSchema: {
        type: 'object',
        properties: {
          weather: {
            type: 'object',
            description: '天气对象',
            properties: {
              alerts: {
                type: 'array',
                description: '天气预警',
                items: {
                  type: 'string'
                }
              }
            },
            required: ['alerts']
          },
          'temperature.celsius': {
            type: 'number',
            description: '摄氏温度'
          }
        },
        required: ['weather', 'temperature.celsius']
      }
    });
    const extraLibContent = readMonacoProps(wrapper).extraLibs?.[0]?.content ?? '';

    expect(extraLibContent).toContain('/** 天气对象 */\n  weather: {');
    expect(extraLibContent).toContain('/** 天气预警 */\n    alerts: Array<string>');
    expect(extraLibContent).toContain('/** 摄氏温度 */\n  "temperature.celsius": number');
    wrapper.unmount();
  });

  it('creates editor type hints for configured output schema fields', (): void => {
    const wrapper = mountCodeEditor({
      ...createWidgetData(),
      outputSchema: {
        type: 'object',
        description: '天气查询出参',
        properties: {
          summary: {
            type: 'string',
            description: '天气摘要'
          },
          alerts: {
            type: 'array',
            description: '预警列表',
            items: {
              type: 'string'
            }
          }
        },
        required: ['summary']
      }
    });
    const extraLibContent = readMonacoProps(wrapper).extraLibs?.[0]?.content ?? '';

    expect(extraLibContent).toContain('/** 天气查询出参 */\ndeclare interface WidgetOutput');
    expect(extraLibContent).toContain('/** 天气摘要 */\n  summary: string');
    expect(extraLibContent).toContain('/** 预警列表 */\n  alerts?: Array<string>');
    expect(extraLibContent).toContain('readonly $output: WidgetOutput | undefined');
    expect(
      formatTypeScriptDiagnostics(
        getTypeScriptDiagnostics({
          'lib.d.ts': TYPESCRIPT_TEST_BASE_LIB,
          'widget-env.d.ts': extraLibContent,
          'widget-test.ts': [
            'export default class Weather extends Widget {',
            '  onMounted() {',
            '    if (!this.$output) {',
            '      return',
            '    }',
            '    const summary: string = this.$output.summary',
            '    const firstAlert: string | undefined = this.$output.alerts?.[0]',
            '  }',
            '}'
          ].join('\n')
        })
      )
    ).toEqual([]);
    wrapper.unmount();
  });

  it('creates class-style this data and method type hints from the interaction script', (): void => {
    const wrapper = mountCodeEditor({
      ...createWidgetData(),
      execute: {
        code: [
          'export default class Weather extends Widget {',
          '  weather = {',
          '    temperature: 28',
          '  }',
          "  message = '等待用户操作'",
          '',
          '  sendText() {',
          '    this.message = this.$input.city',
          '  }',
          '}'
        ].join('\n')
      }
    });
    const extraLibContent = readMonacoProps(wrapper).extraLibs?.[0]?.content ?? '';

    expect(extraLibContent).toContain('declare interface WidgetData');
    expect(extraLibContent).toContain('weather?: {');
    expect(extraLibContent).toContain('temperature?: number');
    expect(extraLibContent).not.toContain('$data');
    expect(extraLibContent).not.toContain('$setData');
    expect(
      formatTypeScriptDiagnostics(
        getTypeScriptDiagnostics({
          'lib.d.ts': TYPESCRIPT_TEST_BASE_LIB,
          'widget-env.d.ts': extraLibContent,
          'widget-test.ts': [
            'export default class Weather extends Widget {',
            '  weather = {',
            '    temperature: 28',
            '  }',
            "  message = '等待用户操作'",
            '',
            '  onMounted() {',
            '    const city: string = this.$input.city',
            '    const temperature: number = this.weather.temperature',
            '    this.message = city',
            '    this.sendText()',
            '  }',
            '',
            '  sendText() {',
            '    const text: string = this.message',
            "    this.$sendMessage({ content: [{ type: 'text', text }] })",
            '  }',
            '}'
          ].join('\n')
        })
      )
    ).toEqual([]);
    const completionNames = getTypeScriptCompletionNames(
      {
        'lib.d.ts': TYPESCRIPT_TEST_BASE_LIB,
        'widget-env.d.ts': extraLibContent,
        'widget-completion.ts': [
          'export default class Weather extends Widget {',
          "  message = '等待用户操作'",
          '',
          '  onMounted() {',
          '    this./*cursor*/',
          '  }',
          '',
          '  sendText() {',
          '    this.message = this.$input.city',
          '  }',
          '}'
        ].join('\n')
      },
      'widget-completion.ts',
      '/*cursor*/'
    );

    expect(completionNames).toEqual(expect.arrayContaining(['message', 'sendText']));
    expect(extraLibContent).not.toContain(REMOVED_LEGACY_ROOT);
    wrapper.unmount();
  });

  it('updates data type hints from the interaction script draft before confirming', async (): Promise<void> => {
    const wrapper = mountCodeEditor({
      ...createWidgetData(),
      execute: {
        code: ['export default class Weather extends Widget {', '  async onMounted() {', '    // 暂无数据写入。', '  }', '}'].join('\n')
      }
    });

    expect(readMonacoProps(wrapper).extraLibs?.[0]?.content).not.toContain('draft?: {');

    await wrapper
      .find('.widget-code-monaco-stub')
      .setValue(
        [
          'export default class Weather extends Widget {',
          '  draft = {',
          "    city: ''",
          '  }',
          '',
          '  async onMounted() {',
          '    this.draft.city = this.$input.city',
          '  }',
          '}'
        ].join('\n')
      );
    await nextTick();

    const extraLibContent = readMonacoProps(wrapper).extraLibs?.[0]?.content ?? '';

    expect(extraLibContent).toContain('draft?: {');
    expect(extraLibContent).toContain('city?: string');
    expect(
      formatTypeScriptDiagnostics(
        getTypeScriptDiagnostics({
          'lib.d.ts': TYPESCRIPT_TEST_BASE_LIB,
          'widget-env.d.ts': extraLibContent,
          'widget-test.ts': "export default class Weather extends Widget { draft = { city: '' }; onMounted() { const city: string = this.draft.city } }"
        })
      )
    ).toEqual([]);
    wrapper.unmount();
  });
});
