/**
 * @file stream.test.ts
 * @description AI 工具流式消息转换测试。
 */
import type { AIToolExecutor } from 'types/ai';
import { describe, expect, it, vi } from 'vitest';
import { createToolResultMessages, executeToolCall } from '@/ai/tools/stream';

describe('createToolResultMessages', (): void => {
  it('serializes tool results as JSON values before sending them to the model', (): void => {
    const messages = createToolResultMessages([
      {
        toolCallId: 'tool-call-json',
        toolName: 'json_tool',
        input: {},
        result: {
          toolName: 'json_tool',
          status: 'success',
          data: {
            kept: 'ok',
            dropped: undefined,
            nested: {
              dropped: undefined
            }
          }
        }
      }
    ]);

    expect(messages[0]).toStrictEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'tool-call-json',
          toolName: 'json_tool',
          output: {
            type: 'json',
            value: {
              toolName: 'json_tool',
              status: 'success',
              data: {
                kept: 'ok',
                nested: {}
              }
            }
          }
        }
      ]
    });
    const content = messages[0]?.content;
    if (!Array.isArray(content) || content[0]?.type !== 'tool-result' || content[0].output.type !== 'json') {
      throw new Error('Expected tool result model message');
    }
    const outputValue = content[0].output.value as { data: Record<string, unknown> };
    expect(Object.prototype.hasOwnProperty.call(outputValue.data, 'dropped')).toBe(false);
  });

  it('namespaces internal Shell command IDs by runtime', async (): Promise<void> => {
    const execute = vi.fn(async (input: unknown): Promise<{ toolName: string; status: 'success'; data: Record<string, never> }> => {
      expect(input).toEqual(expect.any(Object));
      return {
        toolName: 'run_shell_command',
        status: 'success',
        data: {}
      };
    });
    const tool: AIToolExecutor = {
      definition: {
        name: 'run_shell_command',
        description: 'test',
        parameters: { type: 'object', properties: {} },
        source: 'builtin',
        riskLevel: 'dangerous',
        requiresActiveDocument: false
      },
      execute
    };

    const controller = new AbortController();
    await executeToolCall({ toolCallId: 'same-call', toolName: 'run_shell_command', input: { shell: 'bash', command: 'echo ok' } }, [tool], undefined, {
      runtimeId: 'runtime-a',
      abortSignal: controller.signal
    });
    await executeToolCall({ toolCallId: 'same-call', toolName: 'run_shell_command', input: { shell: 'bash', command: 'echo ok' } }, [tool], undefined, {
      runtimeId: 'runtime-b'
    });

    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ commandId: '9:runtime-a:same-call', toolCallId: 'same-call' }),
      undefined,
      expect.objectContaining({ runtimeId: 'runtime-a', abortSignal: controller.signal })
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ commandId: '9:runtime-b:same-call', toolCallId: 'same-call' }),
      undefined,
      expect.objectContaining({ runtimeId: 'runtime-b' })
    );
    const runtimeInput = execute.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(runtimeInput).toMatchObject({ runtimeManaged: true, abortSignal: controller.signal });
    expect(Object.keys(runtimeInput ?? {})).not.toContain('runtimeManaged');
    expect(Object.keys(runtimeInput ?? {})).not.toContain('abortSignal');
  });

  it('forwards abort and activity metadata to renderer tools without a document context', async (): Promise<void> => {
    const execute = vi.fn(
      async (): Promise<{ toolName: string; status: 'success'; data: null }> => ({
        toolName: 'inspect_test_page',
        status: 'success',
        data: null
      })
    );
    const tool: AIToolExecutor = {
      definition: {
        name: 'inspect_test_page',
        description: 'Inspect a test page',
        parameters: { type: 'object', properties: {} },
        source: 'builtin',
        riskLevel: 'read',
        requiresActiveDocument: false
      },
      execute
    };
    const controller = new AbortController();
    const activity = { heartbeat: vi.fn(), progress: vi.fn(), waitUser: vi.fn(), waitExternal: vi.fn(), resume: vi.fn() };

    await executeToolCall({ toolCallId: 'page-call', toolName: 'inspect_test_page', input: {} }, [tool], undefined, {
      runtimeId: 'runtime-page',
      abortSignal: controller.signal,
      activity
    });

    expect(execute).toHaveBeenCalledWith({}, undefined, expect.objectContaining({ runtimeId: 'runtime-page', abortSignal: controller.signal, activity }));
  });
});
