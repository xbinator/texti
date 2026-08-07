/**
 * @file shell-run-events.test.ts
 * @description Shell UI 状态的原位快照、事件顺序和冻结语义测试。
 */
import { describe, expect, it } from 'vitest';
import { append } from '@/components/BChat/utils/messageHelper';
import type { Message } from '@/components/BChat/utils/types';

/**
 * 创建包含执行中 Shell tool part 的消息。
 * @returns 测试消息
 */
function createMessage(): Message {
  return {
    id: 'message-1',
    role: 'assistant',
    content: '',
    createdAt: 'now',
    parts: [{ id: 'part-1', type: 'tool', toolCallId: 'command-1', toolName: 'run_shell_command', status: 'executing', input: {} }]
  };
}

describe('Shell run event message state', (): void => {
  it('replaces terminal snapshots, records answers, and freezes on finished', (): void => {
    const message = createMessage();

    append.shellRunEventPart(message, { commandId: 'command-1', sequence: 1, createdAt: 'now', event: { type: 'terminal_update', content: 'first' } });
    append.shellRunEventPart(message, { commandId: 'command-1', sequence: 2, createdAt: 'now', event: { type: 'terminal_update', content: 'second' } });
    append.shellRunEventPart(message, { commandId: 'command-1', sequence: 3, createdAt: 'now', event: { type: 'auto_answer', count: 1 } });
    append.shellRunEventPart(message, {
      commandId: 'command-1',
      sequence: 4,
      createdAt: 'now',
      event: {
        type: 'finished',
        result: {
          commandId: 'command-1',
          shell: 'bash',
          command: 'echo',
          cwd: '/workspace',
          exitCode: 0,
          signal: null,
          durationMs: 1,
          timedOut: false,
          truncated: false,
          outputMode: 'pty',
          terminalOutput: 'second',
          termination: { kind: 'exit', exitCode: 0 }
        }
      }
    });
    append.shellRunEventPart(message, { commandId: 'command-1', sequence: 5, createdAt: 'now', event: { type: 'terminal_update', content: 'ignored' } });

    const part = message.parts[0];
    expect(part?.type === 'tool' ? part.shellRunState : undefined).toEqual({
      terminalContent: 'second',
      autoAnswers: [1],
      lastSequence: 4,
      finished: true
    });
  });

  it('drops events when the command part does not exist', (): void => {
    const message = createMessage();
    append.shellRunEventPart(message, { commandId: 'missing', sequence: 1, createdAt: 'now', event: { type: 'terminal_update', content: 'ignored' } });

    const part = message.parts[0];
    expect(part?.type === 'tool' ? part.shellRunState : undefined).toBeUndefined();
  });

  it('does not create an empty terminal state for an isolated finished event', (): void => {
    const message = createMessage();
    const part = message.parts[0];
    if (part?.type !== 'tool') throw new Error('测试消息必须包含 Shell tool part');
    part.shellOutput = [{ commandId: 'command-1', stream: 'stdout', text: 'raw fallback', sequence: 1, createdAt: 'now' }];

    append.shellRunEventPart(message, {
      commandId: 'command-1',
      sequence: 1,
      createdAt: 'now',
      event: {
        type: 'finished',
        result: {
          commandId: 'command-1',
          shell: 'bash',
          command: 'echo',
          cwd: '/workspace',
          exitCode: 0,
          signal: null,
          durationMs: 1,
          timedOut: false,
          truncated: false,
          outputMode: 'pipes',
          terminalOutput: 'raw fallback',
          termination: { kind: 'exit', exitCode: 0 }
        }
      }
    });

    expect(part.shellRunState).toBeUndefined();
    expect(part.shellOutput?.map((chunk): string => chunk.text).join('')).toBe('raw fallback');
  });
});
