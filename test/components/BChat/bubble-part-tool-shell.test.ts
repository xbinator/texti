/**
 * @file bubble-part-tool-shell.test.ts
 * @description Shell tool 气泡的实时 Screen Snapshot 和结构化失败恢复测试。
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import type { ChatMessageToolPart } from 'types/chat';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import BubblePartTool from '@/components/BChat/components/MessageBubble/BubblePartTool/index.vue';

vi.mock('@/hooks/useNavigate', () => ({ useNavigate: () => ({ openFile: vi.fn() }) }));

/**
 * 读取 Shell 工具气泡组件源码，用于验证样式回归。
 * @returns Shell 工具气泡组件源码
 */
function readBubbleSource(): string {
  return readFileSync(resolvePath(process.cwd(), 'src/components/BChat/components/MessageBubble/BubblePartTool/ToolShellDisplay.vue'), 'utf8');
}

describe('BubblePartTool Shell display', (): void => {
  it('keeps the shell command text at the terminal default color', (): void => {
    const source = readBubbleSource();
    // 命令文本颜色沿用终端区域默认色；任何作用于 Shell 命令容器及其相邻布局的样式规则
    // 都不得将其弱化为 tertiary 色（组件未为命令单独定义样式块，颜色通过继承保持默认）。
    const commandRules = source.match(/\.bubble-part-tool__shell-command[^{]*\{[^}]*\}/gu) ?? [];

    for (const rule of commandRules) {
      expect(rule).not.toContain('color: var(--text-tertiary)');
    }
  });

  it('renders command input before output in one terminal region', (): void => {
    const part: ChatMessageToolPart = {
      id: 'part-1',
      type: 'tool',
      toolCallId: 'command-1',
      toolName: 'run_shell_command',
      status: 'executing',
      input: { command: 'interactive' },
      shellRunState: {
        terminalContent: 'Installing package...\n\nContinue?',
        autoAnswers: [1, 2, 3],
        lastSequence: 4,
        finished: false
      }
    };
    const wrapper = mount(BubblePartTool, {
      props: { part },
      global: {
        stubs: {
          BIcon: true,
          BTruncateText: { props: ['text'], template: '<span>{{ text }}</span>' }
        }
      }
    });

    const terminal = wrapper.find('.bubble-part-tool__shell-terminal');
    const command = terminal.find('.bubble-part-tool__shell-command');
    const output = terminal.find('.bubble-part-tool__shell-output');

    expect(command.text()).toBe('$ interactive');
    expect(output.text()).toContain('Continue?');
    expect(terminal.text().indexOf('$ interactive')).toBeLessThan(terminal.text().indexOf('Installing package...'));
    expect(wrapper.find('.bubble-part-tool__shell-auto-answer').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Automatically selected default option');
    expect(wrapper.findComponent({ name: 'ConfirmationSheet' }).exists()).toBe(false);
  });

  it('does not repeat a successful command as a finished summary', (): void => {
    const part: ChatMessageToolPart = {
      id: 'part-success',
      type: 'tool',
      toolCallId: 'command-success',
      toolName: 'run_shell_command',
      status: 'done',
      input: {},
      result: {
        toolName: 'run_shell_command',
        status: 'success',
        data: {
          command: 'printf done',
          outputMode: 'pty',
          terminalOutput: 'done',
          termination: { kind: 'exit', exitCode: 0 },
          durationMs: 10
        }
      }
    };
    const wrapper = mount(BubblePartTool, {
      props: { part },
      global: {
        stubs: {
          BIcon: true,
          BTruncateText: { props: ['text'], template: '<span>{{ text }}</span>' }
        }
      }
    });

    const terminal = wrapper.find('.bubble-part-tool__shell-terminal');
    expect(terminal.find('.bubble-part-tool__shell-command').text()).toBe('$ printf done');
    expect(terminal.find('.bubble-part-tool__shell-output').text()).toBe('done');
    expect(wrapper.text().match(/printf done/g)).toHaveLength(1);
    expect(wrapper.find('.bubble-part-tool__shell-finished').exists()).toBe(false);
  });

  it('restores terminal metadata from a persisted structured failure', (): void => {
    const part: ChatMessageToolPart = {
      id: 'part-failure',
      type: 'tool',
      toolCallId: 'command-failure',
      toolName: 'run_shell_command',
      status: 'done',
      input: { command: 'interactive' },
      result: {
        toolName: 'run_shell_command',
        status: 'failure',
        error: {
          code: 'INTERACTION_TIMEOUT',
          message: 'interaction timeout',
          details: { terminalOutput: 'Choose action?', autoInteraction: { enabled: true, answerCount: 2 } }
        }
      }
    };
    const wrapper = mount(BubblePartTool, {
      props: { part },
      global: {
        stubs: {
          BIcon: true,
          BTruncateText: { props: ['text'], template: '<span>{{ text }}</span>' }
        }
      }
    });

    const terminal = wrapper.find('.bubble-part-tool__shell-terminal');
    expect(terminal.find('.bubble-part-tool__shell-command').text()).toBe('$ interactive');
    expect(terminal.find('.bubble-part-tool__shell-output').text()).toContain('Choose action?');
    expect(wrapper.find('.bubble-part-tool__shell-finished').text()).toBe('interaction timeout');
    expect(wrapper.find('.bubble-part-tool__shell-finished').classes()).toContain('bubble-part-tool__shell-finished--failure');
    expect(wrapper.find('.bubble-part-tool__shell-auto-answer').exists()).toBe(false);
  });

  it('keeps a cancelled summary visually neutral', (): void => {
    const part: ChatMessageToolPart = {
      id: 'part-cancelled',
      type: 'tool',
      toolCallId: 'command-cancelled',
      toolName: 'run_shell_command',
      status: 'done',
      input: { command: 'npm install' },
      result: {
        toolName: 'run_shell_command',
        status: 'cancelled',
        error: { code: 'USER_CANCELLED', message: 'cancelled' }
      }
    };
    const wrapper = mount(BubblePartTool, {
      props: { part },
      global: {
        stubs: {
          BIcon: true,
          BTruncateText: { props: ['text'], template: '<span>{{ text }}</span>' }
        }
      }
    });

    const attention = wrapper.find('.bubble-part-tool__shell-finished');
    expect(attention.text()).toBe('用户已取消');
    expect(attention.classes()).not.toContain('bubble-part-tool__shell-finished--failure');
  });
});
