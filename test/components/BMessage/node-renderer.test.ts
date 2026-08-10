/**
 * @file node-renderer.test.ts
 * @description BMessage BlockNode / InlineNode 渲染测试。
 * @vitest-environment jsdom
 */
import { nextTick } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import MessageNodes from '@/components/BMessage/components/MessageNodes';
import BMessage from '@/components/BMessage/index.vue';

/**
 * BMessage 组件公开属性类型。
 */
type BMessagePublicProps = InstanceType<typeof BMessage>['$props'];

const navigateLinkMock = vi.hoisted(() =>
  vi.fn((event: MouseEvent) => {
    event.preventDefault();
  })
);
const previewImageMock = vi.hoisted(() => vi.fn());
const clipboardMock = vi.hoisted(() => vi.fn());
const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn().mockResolvedValue({ svg: '<svg class="mermaid-svg"></svg>' })
}));

vi.mock('@/hooks/useNavigate', () => ({
  useNavigate: () => ({
    onLink: navigateLinkMock
  })
}));

vi.mock('@/hooks/useImagePreview', () => ({
  useImagePreview: () => ({
    previewImage: previewImageMock
  })
}));

vi.mock('@/hooks/useClipboard', () => ({
  useClipboard: () => ({
    clipboard: clipboardMock
  })
}));

vi.mock('mermaid', () => ({
  default: mermaidMock
}));

/**
 * 等待一帧 rAF 渲染。
 */
async function waitMessageRender(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  await nextTick();
}

describe('BMessage node renderer', () => {
  it('renders markdown through a single lightweight node tree', async (): Promise<void> => {
    const wrapper = mount(BMessage, {
      props: {
        type: 'markdown',
        content: '# Title\n\nHello **bold** and `code`.'
      }
    });

    await waitMessageRender();

    expect(wrapper.findComponent({ name: 'MessageNodes' }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'BlockNode' }).exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'InlineNode' }).exists()).toBe(false);
    expect(wrapper.find('h1').text()).toBe('Title');
    expect(wrapper.find('strong').text()).toBe('bold');
    expect(wrapper.find('code').text()).toBe('code');
  });

  it('renders unsafe raw html as text rather than injected elements', async (): Promise<void> => {
    const wrapper = mount(BMessage, {
      props: {
        type: 'markdown',
        content: '<script data-raw-html="1">unsafe</script>'
      }
    });

    await waitMessageRender();

    expect(wrapper.find('[data-raw-html="1"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('<script data-raw-html="1">unsafe</script>');
  });

  it('renders extended markdown and safe inline html tags', async (): Promise<void> => {
    const wrapper = mount(BMessage, {
      props: {
        type: 'markdown',
        content: 'Use ==highlight==, X^2^, H~2~O, <u>under</u>, <kbd>Ctrl</kbd>, <abbr title="HyperText Markup Language">HTML</abbr>.'
      }
    });

    await waitMessageRender();

    expect(wrapper.find('mark').text()).toBe('highlight');
    expect(wrapper.find('sup').text()).toBe('2');
    expect(wrapper.find('sub').text()).toBe('2');
    expect(wrapper.find('u').text()).toBe('under');
    expect(wrapper.find('kbd').text()).toBe('Ctrl');
    expect(wrapper.find('abbr').attributes('title')).toBe('HyperText Markup Language');
  });

  it('renders inline formatting inside list items', async (): Promise<void> => {
    const wrapper = mount(BMessage, {
      props: {
        type: 'markdown',
        content: '- **粗体**\n- *斜体*\n- ~~删除线~~\n- ==高亮==\n- `行内代码`\n- X^2^ and H~2~O'
      }
    });

    await waitMessageRender();

    expect(wrapper.find('li strong').text()).toBe('粗体');
    expect(wrapper.find('li em').text()).toBe('斜体');
    expect(wrapper.find('li del').text()).toBe('删除线');
    expect(wrapper.find('li mark').text()).toBe('高亮');
    expect(wrapper.find('li code').text()).toBe('行内代码');
    expect(wrapper.find('li sup').text()).toBe('2');
    expect(wrapper.find('li sub').text()).toBe('2');
  });

  it('renders unordered and ordered list elements', async (): Promise<void> => {
    const wrapper = mount(BMessage, {
      props: {
        type: 'markdown',
        content: '- 项目一\n- 项目二\n\n1. 第一项\n2. 第二项'
      }
    });

    await waitMessageRender();

    expect(wrapper.find('ul').exists()).toBe(true);
    expect(wrapper.find('ol').exists()).toBe(true);
    expect(wrapper.findAll('ul > li')).toHaveLength(2);
    expect(wrapper.findAll('ol > li')).toHaveLength(2);
    expect(wrapper.find('ul > li').text()).toContain('项目一');
    expect(wrapper.find('ol > li').text()).toContain('第一项');
  });

  it('renders mixed nested list elements', async (): Promise<void> => {
    const wrapper = mount(BMessage, {
      props: {
        type: 'markdown',
        content: '1. 第一步\n   - 注意事项 A\n   - 注意事项 B\n2. 第二步\n   - 注意事项 C\n     1. 子步骤 i\n     2. 子步骤 ii'
      }
    });

    await waitMessageRender();

    const topOrderedItems = Array.from(wrapper.find('ol').element.children).filter((element) => element.tagName === 'LI');

    expect(wrapper.find('ol').exists()).toBe(true);
    expect(wrapper.find('ol ul').exists()).toBe(true);
    expect(wrapper.find('ol ul ol').exists()).toBe(true);
    expect(topOrderedItems).toHaveLength(2);
    expect(wrapper.findAll('ol ul > li').length).toBeGreaterThanOrEqual(3);
    expect(wrapper.find('ol ul ol > li').text()).toContain('子步骤 i');
  });

  it('renders task list checkboxes including nested task items', async (): Promise<void> => {
    const wrapper = mount(BMessage, {
      props: {
        type: 'markdown',
        content: '- [x] 已完成任务\n- [ ] 未完成任务\n  - [x] 嵌套已完成\n  - [ ] 嵌套未完成'
      }
    });

    await waitMessageRender();

    const checkboxes = wrapper.findAll('li > input[type="checkbox"]');

    expect(checkboxes).toHaveLength(4);
    expect((checkboxes[0].element as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[1].element as HTMLInputElement).checked).toBe(false);
    expect((checkboxes[2].element as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[3].element as HTMLInputElement).checked).toBe(false);
    expect(wrapper.text()).not.toContain('[x]');
    expect(wrapper.text()).not.toContain('[ ]');
  });

  it('renders blockquotes, tables and horizontal rules', async (): Promise<void> => {
    const wrapper = mount(BMessage, {
      props: {
        type: 'markdown',
        content: '> quoted\n\n| Name | Value |\n| --- | --- |\n| one | two |\n\n---'
      }
    });

    await waitMessageRender();

    expect(wrapper.find('blockquote').text()).toContain('quoted');
    expect(wrapper.find('table thead').text()).toContain('Name');
    expect(wrapper.find('table tbody').text()).toContain('two');
    expect(wrapper.find('hr').exists()).toBe(true);
  });

  it('wraps markdown tables in a bounded horizontal scroller', async (): Promise<void> => {
    const wrapper = mount(BMessage, {
      props: {
        type: 'markdown',
        content: '| 长列标题 | 另一个长列标题 |\n| --- | --- |\n| very-long-unbroken-content | value |'
      }
    });

    await waitMessageRender();

    const tableScroller = wrapper.find('.b-message__table-scroller');

    expect(tableScroller.exists()).toBe(true);
    expect(tableScroller.find('table').exists()).toBe(true);
    expect(wrapper.find('.b-message__markdown > table').exists()).toBe(false);
  });

  it('renders component placeholder nodes without recursive block components', (): void => {
    const wrapper = mount(MessageNodes, {
      props: {
        blocks: [
          {
            type: 'component',
            id: 'component-1',
            raw: '',
            componentName: 'WeatherCard'
          }
        ]
      }
    });

    expect(wrapper.find('.b-message__component-placeholder').text()).toBe('WeatherCard');
    expect(wrapper.findComponent({ name: 'BlockNode' }).exists()).toBe(false);
  });

  it('decodes markdown html entities when rendering text nodes', async (): Promise<void> => {
    const wrapper = mount(BMessage, {
      props: {
        type: 'markdown',
        content: 'Fish &amp; chips &lt;ok&gt; &#x26; more'
      }
    });

    await waitMessageRender();

    expect(wrapper.text()).toContain('Fish & chips <ok> & more');
    expect(wrapper.text()).not.toContain('&amp;');
  });

  it('renders fenced code blocks with syntax highlight classes', async (): Promise<void> => {
    const wrapper = mount(BMessage, {
      props: {
        type: 'markdown',
        content: '```ts\nconst answer: number = 42\n```'
      }
    });

    await waitMessageRender();

    expect(wrapper.find('.b-message__code-block').exists()).toBe(true);
    expect(wrapper.find('.b-message__code-language').text()).toBe('Ts');
    expect(wrapper.find('.hljs-keyword').exists()).toBe(true);
    expect(wrapper.find('code').text()).toContain('const answer');
    expect(wrapper.find('.b-message__code-content').element.textContent).toBe('const answer: number = 42');
  });

  it('falls back to plain text for unknown code block languages', async (): Promise<void> => {
    const wrapper = mount(BMessage, {
      props: {
        type: 'markdown',
        content: '```madeup\nplain text\n```'
      }
    });

    await waitMessageRender();

    expect(wrapper.find('.b-message__code-language').text()).toBe('Madeup');
    expect(wrapper.find('.hljs-keyword').exists()).toBe(false);
    expect(wrapper.find('code').text()).toBe('plain text');
  });

  it('renders inline and block math with KaTeX', async (): Promise<void> => {
    const wrapper = mount(BMessage, {
      props: {
        type: 'markdown',
        content: 'Inline $E=mc^2$ math.\n\n$$\na^2+b^2=c^2\n$$'
      }
    });

    await waitMessageRender();

    expect(wrapper.find('.b-message__math-inline .katex').exists()).toBe(true);
    expect(wrapper.find('.b-message__math-block .katex-display').exists()).toBe(true);
  });

  it('copies fenced code block text without rendered labels', async (): Promise<void> => {
    clipboardMock.mockResolvedValue(true);

    const wrapper = mount(BMessage, {
      props: {
        type: 'markdown',
        content: '```js\nconsole.log("copy me")\n```'
      }
    });

    await waitMessageRender();
    await wrapper.find('button[aria-label="复制代码"]').trigger('click');

    expect(clipboardMock).toHaveBeenCalledWith('console.log("copy me")', {
      successMessage: '代码已复制',
      trim: false
    });
  });

  it('renders mermaid fenced code blocks as diagrams while keeping source copy', async (): Promise<void> => {
    clipboardMock.mockResolvedValue(true);
    mermaidMock.render.mockResolvedValue({ svg: '<svg class="mermaid-svg"></svg>' });

    const wrapper = mount(BMessage, {
      props: {
        type: 'markdown',
        content: '```mermaid\ngraph TD\n  A --> B\n```'
      }
    });

    await waitMessageRender();
    await flushPromises();

    expect(wrapper.find('.b-message__mermaid-preview').exists()).toBe(true);
    expect(wrapper.find('.mermaid-svg').exists()).toBe(true);
    expect(mermaidMock.render).toHaveBeenCalledWith(expect.stringMatching(/^b-message-mermaid-/), 'graph TD\n  A --> B');

    await wrapper.find('button[aria-label="复制代码"]').trigger('click');

    expect(clipboardMock).toHaveBeenCalledWith('graph TD\n  A --> B', {
      successMessage: '代码已复制',
      trim: false
    });
  });

  it('renders Mermaid message previews before a loose closing fence and heading', async (): Promise<void> => {
    mermaidMock.render.mockClear();
    mermaidMock.render.mockResolvedValue({ svg: '<svg class="mermaid-svg"></svg>' });

    const wrapper = mount(BMessage, {
      props: {
        type: 'markdown',
        content: '```mermaid\ngraph TD\n  A8 --> S8``` ### 5\\.2 页面接口清单页面入口\n```'
      }
    });

    await waitMessageRender();
    await flushPromises();

    expect(wrapper.find('.b-message__mermaid-preview').exists()).toBe(true);
    expect(wrapper.find('.mermaid-svg').exists()).toBe(true);
    expect(mermaidMock.render).toHaveBeenCalledWith(expect.stringMatching(/^b-message-mermaid-/), 'graph TD\n  A8 --> S8');
  });

  it('renders streaming mermaid source as code until the closing fence arrives', async (): Promise<void> => {
    mermaidMock.render.mockClear();
    mermaidMock.render.mockResolvedValue({ svg: '<svg class="mermaid-svg"></svg>' });

    const wrapper = mount(BMessage, {
      props: {
        type: 'markdown',
        loading: true,
        content: '```mermaid\ngraph TD\n  A --> B'
      }
    });

    await waitMessageRender();
    await flushPromises();

    expect(wrapper.find('.b-message__mermaid-preview').exists()).toBe(false);
    expect(wrapper.find('.b-message__code-block code').text()).toContain('graph TD');
    expect(mermaidMock.render).not.toHaveBeenCalled();

    await wrapper.setProps({
      loading: false,
      content: '```mermaid\ngraph TD\n  A --> B\n```'
    } as Partial<BMessagePublicProps>);
    await waitMessageRender();
    await flushPromises();

    expect(wrapper.find('.b-message__mermaid-preview').exists()).toBe(true);
    expect(wrapper.find('.mermaid-svg').exists()).toBe(true);
    expect(mermaidMock.render).toHaveBeenCalledWith(expect.stringMatching(/^b-message-mermaid-/), 'graph TD\n  A --> B');
  });

  it('renders incomplete math delimiters as text instead of KaTeX while streaming', async (): Promise<void> => {
    const wrapper = mount(BMessage, {
      props: {
        type: 'markdown',
        loading: true,
        content: 'Inline $E=mc^2 and block:\n\n$$\na^2+b^2=c^2'
      }
    });

    await waitMessageRender();

    expect(wrapper.find('.b-message__math-inline .katex').exists()).toBe(false);
    expect(wrapper.find('.b-message__math-block .katex-display').exists()).toBe(false);
    expect(wrapper.text()).toContain('Inline $E=mc^2 and block:');
    expect(wrapper.text()).toContain('$$\na^2+b^2=c^2');
  });

  it('keeps inline code without a copy control', async (): Promise<void> => {
    const wrapper = mount(BMessage, {
      props: {
        type: 'markdown',
        content: 'Inline `const value = 1` only.'
      }
    });

    await waitMessageRender();

    expect(wrapper.find('p code').text()).toBe('const value = 1');
    expect(wrapper.find('button[aria-label="复制代码"]').exists()).toBe(false);
  });

  it('preserves plain text whitespace through the node path', async (): Promise<void> => {
    const wrapper = mount(BMessage, {
      props: {
        type: 'text',
        content: '**not bold**\n  indented',
        loading: true
      }
    });

    await waitMessageRender();

    expect(wrapper.findComponent({ name: 'MessageNodes' }).exists()).toBe(true);
    expect(wrapper.find('strong').exists()).toBe(false);
    expect(wrapper.find('.b-message__text').text()).toContain('**not bold**');
    expect(wrapper.find('.b-message__cursor').exists()).toBe(true);
  });

  it('routes link clicks through injected navigation', async (): Promise<void> => {
    const wrapper = mount(BMessage, {
      props: {
        type: 'markdown',
        content: '[Open](https://example.com)'
      }
    });

    await waitMessageRender();

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    wrapper.find('a').element.dispatchEvent(clickEvent);

    expect(navigateLinkMock).toHaveBeenCalledWith(clickEvent);
  });
});
