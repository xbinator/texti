/**
 * @file bubble-part-tool-open-file.test.ts
 * @description 验证聊天工具结果中的文件摘要 chip 可点击打开。
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import type { VueWrapper } from '@vue/test-utils';
import type { ChatMessageToolPart } from 'types/chat';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BubblePartTool from '@/components/BChat/components/MessageBubble/BubblePartTool/index.vue';
import { toolContextRegistry } from '@/hooks/useChat/context/registry';

const openFileMock = vi.hoisted(() => vi.fn<(_options: { filePath?: string | null }) => Promise<void>>().mockResolvedValue(undefined));
/** 工具摘要组件源码。 */
const toolSummarySource = readFileSync('src/components/BChat/components/MessageBubble/BubblePartTool/ToolSummary.vue', 'utf8');

vi.mock('@/hooks/useNavigate', () => ({
  useNavigate: () => ({
    openFile: openFileMock
  })
}));

/**
 * 创建工具消息片段。
 * @param toolName - 工具名称
 * @param data - 工具成功结果数据
 * @returns 工具消息片段
 */
function createToolPart(toolName: string, data: Record<string, unknown>): ChatMessageToolPart {
  return {
    id: 'tool-part-open-file',
    type: 'tool',
    toolCallId: 'tool-call-1',
    toolName,
    status: 'done',
    input: {},
    result: {
      toolName,
      status: 'success',
      data
    }
  };
}

/**
 * 挂载工具气泡组件。
 * @param part - 工具消息片段
 * @returns 组件包装器
 */
function mountTool(part: ChatMessageToolPart): VueWrapper {
  return mount(BubblePartTool, {
    props: { part },
    global: {
      stubs: {
        BIcon: true,
        BTruncateText: {
          props: ['text'],
          template: '<span>{{ text }}</span>'
        },
        BMessage: {
          props: ['content'],
          template: '<pre>{{ content }}</pre>'
        }
      }
    }
  });
}

describe('BubblePartTool open file summary tag', (): void => {
  afterEach((): void => {
    openFileMock.mockClear();
    toolContextRegistry.clear();
  });

  it('opens the file when the write_file summary file tag is clicked', async (): Promise<void> => {
    const wrapper = mountTool(createToolPart('write_file', { path: '/workspace/docs/report.md', content: '# Report', created: true }));

    await wrapper.find('.bubble-part-tool__summary-tag--clickable').trigger('click');

    expect(openFileMock).toHaveBeenCalledWith({ filePath: '/workspace/docs/report.md' });
    wrapper.unmount();
  });

  it('keeps non-file resource summary tags static', (): void => {
    const wrapper = mountTool(createToolPart('open_resource', { resourceType: 'webview', path: 'https://example.com' }));

    expect(wrapper.find('button.bubble-part-tool__summary-tag--clickable').exists()).toBe(false);
    expect(wrapper.text()).toContain('https://example.com');
    wrapper.unmount();
  });

  it('preserves summary text line breaks for readable descriptions', (): void => {
    expect(toolSummarySource).toMatch(/\.bubble-part-tool__summary-text\s*\{[\s\S]*white-space:\s*pre-wrap;/);
  });

  it('uses page-registered presentation without a BChat tool-name mapping', (): void => {
    toolContextRegistry.register({
      binding: { providerId: 'future-page', resourceId: 'page-a' },
      getTools: () => [
        {
          definition: {
            name: 'future_page_tool',
            description: '读取未来页面',
            source: 'builtin',
            riskLevel: 'read',
            parameters: { type: 'object', properties: {} }
          },
          execute: () => ({ toolName: 'future_page_tool', status: 'success', data: { value: 'done' } }),
          presentation: {
            label: '读取未来页面',
            summarize: (): string => '已读取未来页面'
          },
          history: { mode: 'keep' }
        }
      ],
      hiddenToolNames: [],
      appBridgeHandlers: {}
    });
    const wrapper = mountTool(createToolPart('future_page_tool', { value: 'done' }));

    expect(wrapper.text()).toContain('读取未来页面');
    expect(wrapper.text()).toContain('已读取未来页面');
    wrapper.unmount();
  });

  it('falls back safely when page presentations disagree for the same tool name', (): void => {
    toolContextRegistry.register({
      binding: { providerId: 'future-page', resourceId: 'page-a' },
      getTools: () => [
        {
          definition: {
            name: 'ambiguous_page_tool',
            description: 'Inspect page A',
            source: 'builtin',
            riskLevel: 'read',
            parameters: { type: 'object', properties: {} }
          },
          execute: () => ({ toolName: 'ambiguous_page_tool', status: 'success', data: { value: 'a' } }),
          presentation: { label: '页面 A' }
        }
      ],
      hiddenToolNames: [],
      appBridgeHandlers: {}
    });
    const active = toolContextRegistry.register({
      binding: { providerId: 'other-page', resourceId: 'page-b' },
      getTools: () => [
        {
          definition: {
            name: 'ambiguous_page_tool',
            description: 'Inspect page B',
            source: 'builtin',
            riskLevel: 'read',
            parameters: { type: 'object', properties: {} }
          },
          execute: () => ({ toolName: 'ambiguous_page_tool', status: 'success', data: { value: 'b' } }),
          presentation: { label: '页面 B' }
        }
      ],
      hiddenToolNames: [],
      appBridgeHandlers: {}
    });
    active.activate();

    const wrapper = mountTool(createToolPart('ambiguous_page_tool', { value: 'done' }));

    expect(wrapper.text()).toContain('ambiguous_page_tool');
    expect(wrapper.text()).not.toContain('页面 A');
    expect(wrapper.text()).not.toContain('页面 B');
    wrapper.unmount();
  });

  it('falls back to raw output when a page result summarizer throws', (): void => {
    toolContextRegistry.register({
      binding: { providerId: 'future-page', resourceId: 'page-a' },
      getTools: () => [
        {
          definition: {
            name: 'throwing_page_tool',
            description: 'Inspect future page',
            source: 'builtin',
            riskLevel: 'read',
            parameters: { type: 'object', properties: {} }
          },
          execute: () => ({ toolName: 'throwing_page_tool', status: 'success', data: { value: 'done' } }),
          presentation: {
            label: '读取未来页面',
            summarize: (): string => {
              throw new Error('broken presentation');
            }
          }
        }
      ],
      hiddenToolNames: [],
      appBridgeHandlers: {}
    });

    const wrapper = mountTool(createToolPart('throwing_page_tool', { value: 'done' }));

    expect(wrapper.text()).toContain('读取未来页面');
    expect(wrapper.text()).toContain('done');
    wrapper.unmount();
  });
});
