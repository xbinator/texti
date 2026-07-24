/**
 * @file createMonacoEditor.ts
 * @description Monaco 编辑器实例创建适配层，统一封装懒加载、worker 与资源释放责任。
 */

import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.main.js';
import { noop } from 'lodash-es';
import { getResolvedTokens, toMonacoColors } from '@/theme';

/**
 * Monaco 编辑器主题名称。
 */
export type MonacoThemeName = string;

/**
 * Monaco 额外类型声明。
 */
export interface MonacoExtraLib {
  /** 声明文件内容 */
  content: string;
  /** 虚拟声明文件路径 */
  filePath?: string;
}

/**
 * Monaco TypeScript 编译配置。
 */
export type MonacoCompilerOptions = Monaco.typescript.CompilerOptions;

/**
 * Monaco 编辑器创建参数。
 */
export interface CreateMonacoEditorOptions {
  /** 宿主容器。 */
  container: HTMLElement;
  /** 初始文本。 */
  value: string;
  /** 语言标识。 */
  language: string;
  /** 是否只读。 */
  readOnly: boolean;
  /** 当前主题名。 */
  theme: MonacoThemeName;
  /** 主题预设 ID，用于动态注册 Monaco 主题 */
  presetId?: string;
  /** 明暗模式 */
  mode?: 'light' | 'dark';
  /** 是否自动换行 */
  wordWrap?: boolean;
  /** 是否启用内置搜索（Ctrl+F/Cmd+F），默认 true */
  search?: boolean;
  /** 额外类型声明，用于 TypeScript/JavaScript 语言服务提示 */
  extraLibs?: MonacoExtraLib[];
  /** TypeScript/JavaScript 语言服务编译配置 */
  typescriptCompilerOptions?: MonacoCompilerOptions;
  /** 保存快捷键回调，用于接入外层文件保存链路 */
  onSaveShortcut?: () => void;
  /** 是否启用格式校验（如 JSON 语法校验），默认 true */
  validation?: boolean;
  /** 是否只显示滚动条，隐藏其他装饰（glyph margin、折叠等），默认 false */
  scrollbarOnly?: boolean;
  /** 是否启用粘性标题（函数名、类名固定在顶部），默认 false */
  stickyScroll?: boolean;
}

/**
 * 组件侧可消费的 Monaco 适配实例。
 */
export interface MonacoEditorHandle {
  /** 获取当前文本。 */
  getValue: () => string;
  /** 整体替换文本。 */
  setValue: (value: string) => void;
  /** 更新编辑器配置。 */
  updateOptions: (options: {
    readOnly?: boolean;
    wordWrap?: 'on' | 'off';
    find?: Monaco.editor.IEditorFindOptions;
    stickyScroll?: { enabled: boolean };
  }) => void;
  /** 更新 TypeScript/JavaScript 额外类型声明。 */
  updateExtraLibs: (extraLibs?: MonacoExtraLib[]) => void;
  /** 聚焦编辑器。 */
  focus: () => void;
  /** 读取底层编辑器实例。 */
  getEditor: () => Monaco.editor.IStandaloneCodeEditor;
  /** 读取底层文本模型。 */
  getModel: () => Monaco.editor.ITextModel;
  /** 销毁编辑器与模型。 */
  dispose: () => void;
}

/**
 * MonacoEnvironment 全局声明。
 */
interface MonacoEnvironmentHost {
  MonacoEnvironment?: {
    getWorker: (_moduleId: string, label: string) => Worker;
  };
}

/**
 * Monaco worker 构造器模块。
 */
interface MonacoWorkerModule {
  /** worker 默认导出构造器。 */
  default: new () => Worker;
}

/**
 * Monaco worker 类型。
 */
export type MonacoWorkerKind = 'editor' | 'json' | 'typescript' | 'css' | 'html';

let cachedMonaco: typeof Monaco | null = null;
let monacoEnvironmentReady = false;
let jsonDefaultsReady = false;
let editorWorkerConstructor: MonacoWorkerModule['default'] | null = null;
let jsonWorkerConstructor: MonacoWorkerModule['default'] | null = null;
let typescriptWorkerConstructor: MonacoWorkerModule['default'] | null = null;
let cssWorkerConstructor: MonacoWorkerModule['default'] | null = null;
let htmlWorkerConstructor: MonacoWorkerModule['default'] | null = null;

/**
 * 根据 Monaco 语言服务 label 解析对应 worker 类型。
 * @param label - Monaco 请求的语言服务标签
 * @returns worker 类型
 */
export function resolveMonacoWorkerKind(label: string): MonacoWorkerKind {
  switch (label) {
    case 'json':
      return 'json';
    case 'typescript':
    case 'javascript':
      return 'typescript';
    case 'css':
    case 'less':
    case 'scss':
      return 'css';
    case 'html':
    case 'handlebars':
    case 'razor':
      return 'html';
    default:
      return 'editor';
  }
}

/**
 * 创建已加载的 Monaco worker。
 * @param WorkerConstructor - worker 构造器
 * @param errorMessage - worker 未准备好时的错误信息
 * @returns worker 实例
 */
function createMonacoWorker(WorkerConstructor: MonacoWorkerModule['default'] | null, errorMessage: string): Worker {
  if (!WorkerConstructor) {
    throw new Error(errorMessage);
  }

  return new WorkerConstructor();
}

/**
 * 懒加载 Monaco worker 构造器。
 */
async function ensureWorkerConstructors(): Promise<void> {
  if (editorWorkerConstructor && jsonWorkerConstructor && typescriptWorkerConstructor && cssWorkerConstructor && htmlWorkerConstructor) {
    return;
  }

  const [editorWorkerModule, jsonWorkerModule, typescriptWorkerModule, cssWorkerModule, htmlWorkerModule] = await Promise.all([
    import('monaco-editor/esm/vs/editor/editor.worker?worker') as Promise<MonacoWorkerModule>,
    import('monaco-editor/esm/vs/language/json/json.worker?worker') as Promise<MonacoWorkerModule>,
    import('monaco-editor/esm/vs/language/typescript/ts.worker?worker') as Promise<MonacoWorkerModule>,
    import('monaco-editor/esm/vs/language/css/css.worker?worker') as Promise<MonacoWorkerModule>,
    import('monaco-editor/esm/vs/language/html/html.worker?worker') as Promise<MonacoWorkerModule>
  ]);

  editorWorkerConstructor = editorWorkerModule.default;
  jsonWorkerConstructor = jsonWorkerModule.default;
  typescriptWorkerConstructor = typescriptWorkerModule.default;
  cssWorkerConstructor = cssWorkerModule.default;
  htmlWorkerConstructor = htmlWorkerModule.default;
}

/**
 * 初始化 Monaco worker 环境。
 */
async function ensureMonacoEnvironment(): Promise<void> {
  if (monacoEnvironmentReady) {
    return;
  }

  await ensureWorkerConstructors();

  const environmentHost = globalThis as typeof globalThis & MonacoEnvironmentHost;
  environmentHost.MonacoEnvironment = {
    getWorker(_moduleId: string, label: string): Worker {
      switch (resolveMonacoWorkerKind(label)) {
        case 'json':
          return createMonacoWorker(jsonWorkerConstructor, 'Monaco JSON worker is not ready');
        case 'typescript':
          return createMonacoWorker(typescriptWorkerConstructor, 'Monaco TypeScript worker is not ready');
        case 'css':
          return createMonacoWorker(cssWorkerConstructor, 'Monaco CSS worker is not ready');
        case 'html':
          return createMonacoWorker(htmlWorkerConstructor, 'Monaco HTML worker is not ready');
        default:
          return createMonacoWorker(editorWorkerConstructor, 'Monaco editor worker is not ready');
      }
    }
  };

  monacoEnvironmentReady = true;
}

/**
 * 懒加载 Monaco 主模块。
 * @returns Monaco API
 */
async function loadMonaco(): Promise<typeof Monaco> {
  if (cachedMonaco) {
    return cachedMonaco;
  }

  await Promise.all([
    import('monaco-editor/esm/vs/language/json/monaco.contribution.js'),
    import('monaco-editor/esm/vs/language/typescript/monaco.contribution.js'),
    import('monaco-editor/esm/vs/language/css/monaco.contribution.js'),
    import('monaco-editor/esm/vs/language/html/monaco.contribution.js')
  ]);
  cachedMonaco = await import('monaco-editor/esm/vs/editor/editor.main.js');
  return cachedMonaco;
}

/**
 * 初始化 JSON 语言服务默认配置，关闭 schema 相关提示与请求。
 * @param monaco - Monaco API
 */
async function ensureJsonDefaults(monaco: typeof Monaco): Promise<void> {
  if (jsonDefaultsReady) {
    return;
  }

  monaco.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: true,
    schemas: [],
    enableSchemaRequest: false,
    schemaRequest: 'ignore',
    schemaValidation: 'ignore',
    trailingCommas: 'error',
    comments: 'error'
  });

  jsonDefaultsReady = true;
}

/**
 * 判断当前语言是否使用 TypeScript 语言服务。
 * @param language - 当前语言
 * @returns 是否为 TypeScript 语言服务语言
 */
function isTypeScriptServiceLanguage(language: string): language is 'typescript' | 'javascript' {
  return language === 'typescript' || language === 'javascript';
}

/**
 * 读取指定语言的 TypeScript 默认服务配置。
 * @param monaco - Monaco API
 * @param language - 当前语言
 * @returns TypeScript 语言服务默认配置
 */
function getTypeScriptLanguageDefaults(monaco: typeof Monaco, language: 'typescript' | 'javascript'): Monaco.typescript.LanguageServiceDefaults {
  return language === 'typescript' ? monaco.typescript.typescriptDefaults : monaco.typescript.javascriptDefaults;
}

/**
 * 临时应用当前编辑器需要的 TypeScript 编译配置。
 * @param monaco - Monaco API
 * @param language - 当前语言
 * @param compilerOptions - 编译配置
 * @returns 配置释放器
 */
function registerTypeScriptCompilerOptions(monaco: typeof Monaco, language: string, compilerOptions?: MonacoCompilerOptions): Monaco.IDisposable {
  if (!compilerOptions || !isTypeScriptServiceLanguage(language)) {
    return { dispose: noop };
  }

  const defaults = getTypeScriptLanguageDefaults(monaco, language);
  const previousOptions = defaults.getCompilerOptions();
  defaults.setCompilerOptions({
    ...previousOptions,
    ...compilerOptions
  });

  return {
    dispose: (): void => {
      defaults.setCompilerOptions(previousOptions);
    }
  };
}

/**
 * 注册当前编辑器需要的额外类型声明。
 * @param monaco - Monaco API
 * @param language - 当前语言
 * @param extraLibs - 类型声明列表
 * @returns 声明释放器
 */
function registerExtraLibs(monaco: typeof Monaco, language: string, extraLibs: MonacoExtraLib[] = []): Monaco.IDisposable[] {
  if (!isTypeScriptServiceLanguage(language)) {
    return [];
  }

  const defaults = getTypeScriptLanguageDefaults(monaco, language);

  return extraLibs.map((extraLib: MonacoExtraLib): Monaco.IDisposable => defaults.addExtraLib(extraLib.content, extraLib.filePath));
}

/**
 * 生成 Monaco 主题名称。
 * @param presetId - 主题预设 ID
 * @param mode - 明暗模式
 * @returns Monaco 主题名称，格式为 tibis-{presetId}-{mode}
 */
export function getMonacoThemeName(presetId: string, mode: 'light' | 'dark'): string {
  return `tibis-${presetId}-${mode}`;
}

/**
 * 注册指定预设和模式的 Monaco 主题。
 * 同名主题也需要重新定义，确保开发热更新或 token 派生规则变更后能刷新 Monaco 颜色。
 * @param monaco - Monaco API
 * @param presetId - 主题预设 ID
 * @param mode - 明暗模式
 * @returns 注册后的主题名称
 */
export function ensureTheme(monaco: typeof Monaco, presetId: string, mode: 'light' | 'dark'): string {
  const themeName = getMonacoThemeName(presetId, mode);
  const tokens = getResolvedTokens(presetId, mode);
  monaco.editor.defineTheme(themeName, {
    base: mode === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: toMonacoColors(tokens)
  });

  return themeName;
}

/**
 * 创建 Monaco 编辑器实例。
 * @param options - 创建参数
 * @returns 适配后的编辑器句柄
 */
export async function createMonacoEditor(options: CreateMonacoEditorOptions): Promise<MonacoEditorHandle> {
  await ensureMonacoEnvironment();

  const monaco = await loadMonaco();
  if (options.language === 'json') {
    await ensureJsonDefaults(monaco);
  }

  // 如果提供了 presetId 和 mode，使用动态主题注册
  let themeName = options.theme;
  if (options.presetId && options.mode) {
    themeName = ensureTheme(monaco, options.presetId, options.mode);
  }

  monaco.editor.setTheme(themeName);

  const compilerOptionsDisposable = registerTypeScriptCompilerOptions(monaco, options.language, options.typescriptCompilerOptions);
  const model = monaco.editor.createModel(options.value, options.language);
  let extraLibDisposables = registerExtraLibs(monaco, options.language, options.extraLibs);

  const hasSearch = options.search !== false;

  const editor = monaco.editor.create(options.container, {
    model,
    // 关闭自动布局，避免内容超出容器。
    automaticLayout: true,
    // 关闭行号。
    lineNumbers: 'off',
    // 开启平滑光标动画。
    cursorSmoothCaretAnimation: 'on',
    fontFamily: '"JetBrains Mono", "SFMono-Regular", "Consolas", "Liberation Mono", monospace',
    // 开启字体连atures，显示连字。
    fontLigatures: true,
    fontSize: 15,
    lineHeight: 24,
    minimap: { enabled: false },
    // 关闭滚动时顶部的阴影。
    scrollbar: { useShadows: false },
    readOnly: options.readOnly,
    padding: {
      top: 18,
      bottom: 18
    },
    scrollBeyondLastLine: false,
    tabSize: 2,
    wordWrap: options.wordWrap ? 'on' : 'off',
    stickyScroll: {
      enabled: options.stickyScroll === true
    },
    // 提示、hover 等浮层需要避开弹窗 overflow 裁剪。
    fixedOverflowWidgets: true,
    contextmenu: false,
    // 关闭同词 selection 高亮，避免选中一个字段时其它相同字段被误认为真实选区。
    selectionHighlight: false,
    ...(hasSearch
      ? {
          find: {
            addExtraSpaceOnTop: false,
            autoFindInSelection: 'never',
            seedSearchStringFromSelection: 'always',
            loop: true
          }
        }
      : {})
  });

  // 禁用内置搜索快捷键
  if (!hasSearch) {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, noop);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, noop);
  }
  // 接管保存快捷键，避免浏览器对话框并把动作交还给外层页面。
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, (): void => {
    options.onSaveShortcut?.();
  });

  return {
    getValue: () => model.getValue(),
    setValue: (value: string) => model.setValue(value),
    updateOptions: (nextOptions) => editor.updateOptions(nextOptions),
    updateExtraLibs: (nextExtraLibs?: MonacoExtraLib[]): void => {
      extraLibDisposables.forEach((disposable: Monaco.IDisposable): void => disposable.dispose());
      extraLibDisposables = registerExtraLibs(monaco, options.language, nextExtraLibs);
    },
    focus: () => editor.focus(),
    getEditor: () => editor,
    getModel: () => model,
    dispose: () => {
      extraLibDisposables.forEach((disposable: Monaco.IDisposable): void => disposable.dispose());
      compilerOptionsDisposable.dispose();
      editor.dispose();
      model.dispose();
    }
  };
}
