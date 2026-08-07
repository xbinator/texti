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

  it('renders ordinary pipe output while the Shell tool is executing', (): void => {
    const part: ChatMessageToolPart = {
      id: 'part-pipe',
      type: 'tool',
      toolCallId: 'command-pipe',
      toolName: 'run_shell_command',
      status: 'executing',
      input: { command: 'npx skills add example' },
      shellOutput: [
        { commandId: 'command-pipe', stream: 'stdout', text: 'Resolving package\n', sequence: 1, createdAt: 'now' },
        { commandId: 'command-pipe', stream: 'stderr', text: 'Waiting for input', sequence: 2, createdAt: 'now' }
      ]
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

    const output = wrapper.find('.bubble-part-tool__shell-output');
    expect(output.text()).toContain('Resolving package');
    expect(output.text()).toContain('Waiting for input');
    expect(output.text().indexOf('Resolving package')).toBeLessThan(output.text().indexOf('Waiting for input'));
  });

  it('does not fall back to raw output when a projected screen is empty', (): void => {
    const part: ChatMessageToolPart = {
      id: 'part-empty-screen',
      type: 'tool',
      toolCallId: 'command-empty-screen',
      toolName: 'run_shell_command',
      status: 'executing',
      input: { command: 'printf output' },
      shellOutput: [{ commandId: 'command-empty-screen', stream: 'stdout', text: 'stale raw', sequence: 1, createdAt: 'now' }],
      shellRunState: { terminalContent: '', autoAnswers: [], lastSequence: 1, finished: false }
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

    expect(wrapper.text()).not.toContain('stale raw');
    expect(wrapper.find('.bubble-part-tool__shell-output').exists()).toBe(false);
  });

  it('keeps terminal output on a fixed character grid', (): void => {
    const source = readBubbleSource();
    const outputRule = source.match(/\.bubble-part-tool__shell-output\s*\{[^}]*\}/u)?.[0] ?? '';

    expect(outputRule).toContain('white-space: pre;');
    expect(outputRule).not.toContain('pre-wrap');
    expect(outputRule).toContain('overflow-wrap: normal;');
    expect(outputRule).toContain('word-break: normal;');
  });

  it('uses the final structured output after a Shell tool finishes', (): void => {
    const part: ChatMessageToolPart = {
      id: 'part-final',
      type: 'tool',
      toolCallId: 'command-final',
      toolName: 'run_shell_command',
      status: 'done',
      input: { command: 'printf final' },
      shellOutput: [{ commandId: 'command-final', stream: 'stdout', text: 'stale pipe', sequence: 1, createdAt: 'now' }],
      shellRunState: { terminalContent: 'stale pty', autoAnswers: [], lastSequence: 1, finished: true },
      result: {
        toolName: 'run_shell_command',
        status: 'success',
        data: { command: 'printf final', outputMode: 'pipes', stdout: 'final stdout', stderr: 'final stderr' }
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

    const output = wrapper.find('.bubble-part-tool__shell-output');
    expect(output.text()).toContain('final stdout');
    expect(output.text()).toContain('final stderr');
    expect(output.text()).not.toContain('stale pipe');
    expect(output.text()).not.toContain('stale pty');
  });

  it('does not restore stale live output when the final structured output is empty', (): void => {
    const part: ChatMessageToolPart = {
      id: 'part-empty-final',
      type: 'tool',
      toolCallId: 'command-empty-final',
      toolName: 'run_shell_command',
      status: 'done',
      input: { command: 'true' },
      shellOutput: [{ commandId: 'command-empty-final', stream: 'stdout', text: 'stale pipe', sequence: 1, createdAt: 'now' }],
      shellRunState: { terminalContent: 'stale pty', autoAnswers: [], lastSequence: 1, finished: true },
      result: {
        toolName: 'run_shell_command',
        status: 'success',
        data: { command: 'true', outputMode: 'pipes', stdout: '', stderr: '' }
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

    expect(wrapper.text()).not.toContain('stale pipe');
    expect(wrapper.text()).not.toContain('stale pty');
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
