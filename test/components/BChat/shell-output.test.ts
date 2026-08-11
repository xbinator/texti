/**
 * @file shell-output.test.ts
 * @description Shell 普通管道实时输出的消息状态顺序、隔离和容量边界测试。
 */
import type { ChatMessageShellOutputChunk } from 'types/chat';
import type { ElectronShellCommandOutputChunk } from 'types/electron-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { append } from '@/components/BChat/utils/messageHelper';
import type { Message } from '@/components/BChat/utils/types';
import { createShellOutputCoalescer } from '@/hooks/useChat/shellOutputCoalescer';

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
  afterEach((): void => {
    vi.useRealTimers();
  });

  it('coalesces adjacent streams after 16ms while preserving cross-stream order', async (): Promise<void> => {
    vi.useFakeTimers();
    const emit = vi.fn<(chunks: ElectronShellCommandOutputChunk[]) => void>();
    const coalescer = createShellOutputCoalescer(emit);
    coalescer.push(createChunk({ text: 'a', sequence: 1 }) as ElectronShellCommandOutputChunk);
    coalescer.push(createChunk({ text: 'b', sequence: 2 }) as ElectronShellCommandOutputChunk);
    coalescer.push(createChunk({ stream: 'stderr', text: 'c', sequence: 3 }) as ElectronShellCommandOutputChunk);

    await vi.advanceTimersByTimeAsync(15);
    expect(emit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(emit).toHaveBeenCalledWith([
      expect.objectContaining({ stream: 'stdout', text: 'ab', sequence: 2 }),
      expect.objectContaining({ stream: 'stderr', text: 'c', sequence: 3 })
    ]);
  });

  it('flushes a continuously growing output batch no later than 50ms', async (): Promise<void> => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const coalescer = createShellOutputCoalescer(emit);

    for (let sequence = 1; sequence <= 6; sequence += 1) {
      coalescer.push(createChunk({ text: String(sequence), sequence }) as ElectronShellCommandOutputChunk);
      // 按真实时间顺序推进连续输入，验证 maxWait 而不是并行定时器。
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(10);
    }

    expect(emit).toHaveBeenCalled();
  });

  it('bounds a synchronous batch when stdout and stderr keep alternating', (): void => {
    vi.useFakeTimers();
    const emit = vi.fn<(chunks: ElectronShellCommandOutputChunk[]) => void>();
    const coalescer = createShellOutputCoalescer(emit);

    for (let sequence = 1; sequence <= 1_000; sequence += 1) {
      coalescer.push(createChunk({ stream: sequence % 2 === 0 ? 'stderr' : 'stdout', text: 'x', sequence }) as ElectronShellCommandOutputChunk);
    }
    coalescer.flush();

    expect(emit.mock.calls.length).toBeGreaterThan(1);
    expect(emit.mock.calls.every(([chunks]): boolean => chunks.length <= 512)).toBe(true);
    expect(emit.mock.calls.flatMap(([chunks]): number[] => chunks.map((chunk: ElectronShellCommandOutputChunk): number => chunk.sequence))).toEqual(
      Array.from({ length: 1_000 }, (_, index: number): number => index + 1)
    );
  });

  it('flushes explicitly and cancels without leaving timers', (): void => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const coalescer = createShellOutputCoalescer(emit);
    coalescer.push(createChunk({ text: 'flush' }) as ElectronShellCommandOutputChunk);
    coalescer.flush();
    coalescer.push(createChunk({ text: 'cancelled', sequence: 2 }) as ElectronShellCommandOutputChunk);
    coalescer.cancel();

    expect(emit).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

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
