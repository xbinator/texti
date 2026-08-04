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
        }
      }
    }
  });
}

describe('BubblePartTool open file summary tag', (): void => {
  afterEach((): void => {
    openFileMock.mockClear();
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
});
