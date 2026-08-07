/**
 * @file shell-output.test.ts
 * @description Shell 普通管道实时输出的消息状态顺序、隔离和容量边界测试。
 */
import type { ChatMessageShellOutputChunk } from 'types/chat';
import { describe, expect, it } from 'vitest';
import { append } from '@/components/BChat/utils/messageHelper';
import type { Message } from '@/components/BChat/utils/types';

/**
 * 创建包含执行中 Shell tool part 的消息。
 * @param toolName - 工具名称
 * @returns 测试消息
 */
function createMessage(toolName = 'run_shell_command'): Message {
  return {
    id: 'message-1',
    role: 'assistant',
    content: '',
    createdAt: 'now',
    parts: [{ id: 'part-1', type: 'tool', toolCallId: 'command-1', toolName, status: 'executing', input: {} }]
  };
}

/**
 * 创建 Shell 输出片段。
 * @param overrides - 需要覆盖的片段字段
 * @returns Shell 输出片段
 */
function createChunk(overrides: Partial<ChatMessageShellOutputChunk> = {}): ChatMessageShellOutputChunk {
  return {
    commandId: 'command-1',
    stream: 'stdout',
    text: 'output',
    sequence: 1,
    createdAt: 'now',
    ...overrides
  };
}

/**
 * 读取测试消息中的 Shell 输出。
 * @param message - 测试消息
 * @returns Shell 输出片段
 */
function readShellOutput(message: Message): ChatMessageShellOutputChunk[] | undefined {
  const part = message.parts[0];
  return part?.type === 'tool' ? part.shellOutput : undefined;
}

describe('Shell pipe output message state', (): void => {
  it('appends stdout and stderr chunks in receive order', (): void => {
    const message = createMessage();
    const stdout = createChunk({ text: 'stdout', sequence: 1 });
    const stderr = createChunk({ stream: 'stderr', text: 'stderr', sequence: 2 });

    append.shellOutputPart(message, stdout.commandId, stdout);
    append.shellOutputPart(message, stderr.commandId, stderr);

    expect(readShellOutput(message)).toEqual([stdout, stderr]);
  });

  it('ignores mismatched command ids and non-Shell tool parts', (): void => {
    const shellMessage = createMessage();
    const otherToolMessage = createMessage('read_file');
    const missingChunk = createChunk({ commandId: 'missing' });
    const matchingChunk = createChunk();

    append.shellOutputPart(shellMessage, missingChunk.commandId, missingChunk);
    append.shellOutputPart(otherToolMessage, matchingChunk.commandId, matchingChunk);

    expect(readShellOutput(shellMessage)).toBeUndefined();
    expect(readShellOutput(otherToolMessage)).toBeUndefined();
  });

  it('retains only the newest 80 chunks', (): void => {
    const message = createMessage();

    for (let sequence = 1; sequence <= 81; sequence += 1) {
      const chunk = createChunk({ text: String(sequence), sequence });
      append.shellOutputPart(message, chunk.commandId, chunk);
    }

    const output = readShellOutput(message);
    expect(output).toHaveLength(80);
    expect(output?.[0]?.text).toBe('2');
    expect(output?.at(-1)?.text).toBe('81');
  });

  it('retains only the newest 12000 characters while preserving chunk metadata', (): void => {
    const message = createMessage();
    const first = createChunk({ stream: 'stderr', text: 'a'.repeat(8_000), sequence: 1, createdAt: 'first' });
    const second = createChunk({ text: 'b'.repeat(8_000), sequence: 2, createdAt: 'second' });

    append.shellOutputPart(message, first.commandId, first);
    append.shellOutputPart(message, second.commandId, second);

    const output = readShellOutput(message);
    expect(output?.map((chunk: ChatMessageShellOutputChunk): string => chunk.text).join('')).toBe(`${'a'.repeat(4_000)}${'b'.repeat(8_000)}`);
    expect(output?.[0]).toMatchObject({ commandId: 'command-1', stream: 'stderr', sequence: 1, createdAt: 'first' });
    expect(output?.[1]).toBe(second);
  });

  it('keeps raw pipe chunks separate from terminal screen state', (): void => {
    const message = createMessage();
    append.shellRunEventPart(message, { commandId: 'command-1', sequence: 1, createdAt: 'now', event: { type: 'terminal_update', content: 'stable screen' } });
    const chunk = createChunk({ sequence: 1, text: 'raw output' });

    append.shellOutputPart(message, chunk.commandId, chunk);

    const part = message.parts[0];
    expect(part?.type === 'tool' ? part.shellRunState?.terminalContent : undefined).toBe('stable screen');
    expect(readShellOutput(message)).toEqual([chunk]);
  });
});
