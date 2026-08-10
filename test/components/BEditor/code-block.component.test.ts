/**
 * @file code-block.component.test.ts
 * @description BEditor 代码块 NodeView 交互测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file -- 测试文件内定义轻量组件替身。 */
import { defineComponent, nextTick } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CodeBlock from '@/components/BEditor/components/CodeBlock.vue';

const copyTextMock = vi.hoisted(() => vi.fn());
const copyImageMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const messageErrorMock = vi.hoisted(() => vi.fn());
const debouncedCancelMock = vi.hoisted(() => vi.fn<() => void>());
const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn().mockResolvedValue({
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" class="mermaid-svg"><rect width="120" height="80" /></svg>'
  })
}));

const MERMAID_SVG_SELECTOR = '.mermaid-svg';

vi.mock('@vueuse/core', () => ({
  useDebounceFn: (callback: () => Promise<void>) => Object.assign(callback, { cancel: debouncedCancelMock })
}));

vi.mock('@/hooks/useClipboard', () => ({
  useClipboard: () => ({
    clipboard: copyTextMock,
    copyImage: copyImageMock
  })
}));

vi.mock('ant-design-vue', () => ({
  message: {
    error: messageErrorMock,
    success: vi.fn()
  }
}));

vi.mock('mermaid', () => ({
  default: mermaidMock
}));

/**
 * 测试用代码块节点。
 */
interface TestCodeBlockNode {
  /** 节点属性 */
  attrs: {
    /** 代码语言 */
    language: string;
  };
  /** 代码文本内容 */
  textContent: string;
  /** ProseMirror 节点尺寸 */
  nodeSize: number;
}

/**
 * 测试用编辑器命令集合。
 */
interface TestCodeBlockEditorCommands {
  /** 按范围替换编辑器内容 */
  insertContentAt: ReturnType<typeof vi.fn>;
}

/**
 * 测试用编辑器实例。
 */
interface TestCodeBlockEditor {
  /** 编辑器命令集合 */
  commands: TestCodeBlockEditorCommands;
}

/**
 * 代码块挂载选项。
 */
interface CodeBlockMountOptions {
  /** 测试用编辑器实例 */
  editor?: TestCodeBlockEditor;
  /** 获取节点位置的函数 */
  getPos?: () => number | undefined;
}

/**
 * 代码块挂载结果。
 */
interface CodeBlockMountResult {
  /** Vue Test Utils 包装器 */
  wrapper: VueWrapper;
  /** 属性更新函数 */
  updateAttributes: ReturnType<typeof vi.fn>;
}

/**
 * 等待一帧 rAF 渲染。
 */
async function waitAnimationFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  await nextTick();
}

/**
 * 等待 Mermaid SVG 写入预览容器。
 * @param wrapper - 代码块包装器
 */
async function waitForMermaidSvg(wrapper: VueWrapper, remainingChecks = 6): Promise<void> {
  if (remainingChecks <= 0) return;

  await flushPromises();
  await waitAnimationFrame();

  if (wrapper.find(MERMAID_SVG_SELECTOR).exists()) return;

  await waitForMermaidSvg(wrapper, remainingChecks - 1);
}

/**
 * 创建测试用代码块节点。
 * @param language - 代码块语言
 * @param textContent - 代码内容
 * @returns 测试节点
 */
function createCodeBlockNode(language: string, textContent: string): TestCodeBlockNode {
  return {
    attrs: { language },
    textContent,
    nodeSize: textContent.length + 2
  };
}

/**
 * 创建测试用编辑器实例。
 * @param insertContentAt - 替换内容命令
 * @returns 测试编辑器实例
 */
function createCodeBlockEditor(insertContentAt: ReturnType<typeof vi.fn> = vi.fn().mockReturnValue(true)): TestCodeBlockEditor {
  return {
    commands: {
      insertContentAt
    }
  };
}

/**
 * 挂载代码块 NodeView。
 * @param node - 测试代码块节点
 * @param options - 挂载选项
 * @returns 挂载结果
 */
function mountCodeBlock(node: TestCodeBlockNode, options: CodeBlockMountOptions = {}): CodeBlockMountResult {
  const updateAttributes = vi.fn();
  const wrapper = mount(CodeBlock, {
    props: {
      node,
      updateAttributes,
      editor: options.editor ?? createCodeBlockEditor(),
      decorations: [],
      selected: false,
      extension: {},
      getPos: options.getPos ?? (() => undefined),
      deleteNode: vi.fn(),
      view: {},
      innerDecorations: {},
      HTMLAttributes: {}
    },
    global: {
      stubs: {
        BIcon: true,
        BJsonViewer: true,
        BSelect: true,
        BSuspense: defineComponent({
          name: 'BSuspense',
          props: {
            active: {
              type: Boolean,
              default: false
            }
          },
          template: '<div v-if="active"><slot /></div>'
        }),
        NodeViewContent: defineComponent({
          name: 'NodeViewContent',
          props: {
            as: {
              type: String,
              default: 'div'
            }
          },
          template: '<component :is="as"><slot /></component>'
        }),
        NodeViewWrapper: defineComponent({
          name: 'NodeViewWrapper',
          template: '<div><slot /></div>'
        })
      }
    }
  });

  return { wrapper, updateAttributes };
}

describe('CodeBlock', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    copyTextMock.mockResolvedValue(true);
    copyImageMock.mockResolvedValue(true);
    mermaidMock.render.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" class="mermaid-svg"><rect width="120" height="80" /></svg>'
    });
  });

  afterEach((): void => {
    vi.restoreAllMocks();
  });

  it('copies rendered Mermaid preview as an image when preview is visible', async (): Promise<void> => {
    const { wrapper } = mountCodeBlock(createCodeBlockNode('mermaid', 'graph TD\n  A --> B'));

    await waitForMermaidSvg(wrapper);

    expect(wrapper.find(MERMAID_SVG_SELECTOR).exists()).toBe(true);

    await wrapper.find('.b-markdown-codeblock__copy').trigger('click');
    await flushPromises();

    expect(messageErrorMock).not.toHaveBeenCalled();
    expect(copyImageMock).toHaveBeenCalledWith(wrapper.find(MERMAID_SVG_SELECTOR).element, {
      successMessage: '复制成功',
      errorMessage: '复制图片失败'
    });
    expect(copyTextMock).not.toHaveBeenCalled();
  });

  it('renders Mermaid preview from source before a loose closing fence and heading', async (): Promise<void> => {
    const { wrapper } = mountCodeBlock(createCodeBlockNode('mermaid', 'graph TD\n  A8 --> S8``` ### 5\\.2 页面接口清单页面入口'));

    await waitForMermaidSvg(wrapper);

    expect(wrapper.find(MERMAID_SVG_SELECTOR).exists()).toBe(true);
    expect(mermaidMock.render).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-/), 'graph TD\n  A8 --> S8');
  });

  it('renders Mermaid preview before an escaped loose closing fence', async (): Promise<void> => {
    const { wrapper } = mountCodeBlock(createCodeBlockNode('mermaid', 'graph TD\n  A8 --> S8\\`\\`\\`### 5\\.2 页面接口清单页面入口'));

    await waitForMermaidSvg(wrapper);

    expect(wrapper.find(MERMAID_SVG_SELECTOR).exists()).toBe(true);
    expect(mermaidMock.render).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-/), 'graph TD\n  A8 --> S8');
  });

  it('repairs a Mermaid code block that swallowed the following Markdown heading', async (): Promise<void> => {
    const node = createCodeBlockNode('mermaid', 'graph TD\n  A8 --> S8\\`\\`\\`### 5\\.2 页面接口清单页面入口');
    const insertContentAt = vi.fn().mockReturnValue(true);

    mountCodeBlock(node, {
      editor: createCodeBlockEditor(insertContentAt),
      getPos: () => 12
    });

    await nextTick();

    expect(insertContentAt).toHaveBeenCalledWith(
      { from: 12, to: 12 + node.nodeSize },
      '```mermaid\ngraph TD\n  A8 --> S8\n```\n\n### 5\\.2 页面接口清单页面入口',
      { contentType: 'markdown' }
    );
  });

  it('defers Mermaid repair until the Vue node view renderer is ready', async (): Promise<void> => {
    const node = createCodeBlockNode('mermaid', 'graph TD\n  A8 --> S8\\`\\`\\`### 5\\.2 页面接口清单页面入口');
    const insertContentAt = vi.fn().mockReturnValue(true);

    mountCodeBlock(node, {
      editor: createCodeBlockEditor(insertContentAt),
      getPos: () => 16
    });

    expect(insertContentAt).not.toHaveBeenCalled();

    await nextTick();

    expect(insertContentAt).toHaveBeenCalledWith(
      { from: 16, to: 16 + node.nodeSize },
      '```mermaid\ngraph TD\n  A8 --> S8\n```\n\n### 5\\.2 页面接口清单页面入口',
      { contentType: 'markdown' }
    );
  });

  it('repairs a Mermaid code block with a line-end closing fence that swallowed later Markdown', async (): Promise<void> => {
    const swallowedMarkdown = '### 5\\.2 页面接口清单\n\n|页面/入口|调用接口|\n|---|---|';
    const node = createCodeBlockNode('mermaid', `graph TD\n  A8 --> S8\`\`\`\n\n\n${swallowedMarkdown}`);
    const insertContentAt = vi.fn().mockReturnValue(true);

    mountCodeBlock(node, {
      editor: createCodeBlockEditor(insertContentAt),
      getPos: () => 18
    });

    await nextTick();

    expect(insertContentAt).toHaveBeenCalledWith({ from: 18, to: 18 + node.nodeSize }, `\`\`\`mermaid\ngraph TD\n  A8 --> S8\n\`\`\`\n\n${swallowedMarkdown}`, {
      contentType: 'markdown'
    });
  });

  it('renders Mermaid preview before a multi-escaped loose closing fence', async (): Promise<void> => {
    const { wrapper } = mountCodeBlock(createCodeBlockNode('mermaid', 'graph TD\n  A8 --> S8\\\\`\\\\`\\\\`### 5\\.2 页面接口清单页面入口'));

    await waitForMermaidSvg(wrapper);

    expect(wrapper.find(MERMAID_SVG_SELECTOR).exists()).toBe(true);
    expect(mermaidMock.render).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-/), 'graph TD\n  A8 --> S8');
  });

  it('renders Mermaid preview before any dangling Markdown fence text', async (): Promise<void> => {
    const { wrapper } = mountCodeBlock(createCodeBlockNode('mermaid', 'graph TD\n  A8 --> S8```后续内容'));

    await waitForMermaidSvg(wrapper);

    expect(wrapper.find(MERMAID_SVG_SELECTOR).exists()).toBe(true);
    expect(mermaidMock.render).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-/), 'graph TD\n  A8 --> S8');
  });

  it('keeps copying source text when no rendered preview image is visible', async (): Promise<void> => {
    const { wrapper } = mountCodeBlock(createCodeBlockNode('typescript', 'const value = 1;'));

    await wrapper.find('.b-markdown-codeblock__copy').trigger('click');
    await flushPromises();

    expect(copyTextMock).toHaveBeenCalledWith('const value = 1;', {
      successMessage: '复制成功',
      trim: false
    });
    expect(copyImageMock).not.toHaveBeenCalled();
  });

  it('cancels the pending Mermaid debounce when the node view unmounts', (): void => {
    const { wrapper } = mountCodeBlock(createCodeBlockNode('typescript', 'const value = 1;'));

    wrapper.unmount();

    expect(debouncedCancelMock).toHaveBeenCalledOnce();
  });
});
