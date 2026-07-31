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
    const execute = vi.fn(
      async (): Promise<{ toolName: string; status: 'success'; data: Record<string, never> }> => ({
        toolName: 'run_shell_command',
        status: 'success',
        data: {}
      })
    );
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

    await executeToolCall({ toolCallId: 'same-call', toolName: 'run_shell_command', input: { shell: 'bash', command: 'echo ok' } }, [tool], undefined, {
      runtimeId: 'runtime-a'
    });
    await executeToolCall({ toolCallId: 'same-call', toolName: 'run_shell_command', input: { shell: 'bash', command: 'echo ok' } }, [tool], undefined, {
      runtimeId: 'runtime-b'
    });

    expect(execute).toHaveBeenNthCalledWith(1, expect.objectContaining({ commandId: '9:runtime-a:same-call', toolCallId: 'same-call' }), undefined);
    expect(execute).toHaveBeenNthCalledWith(2, expect.objectContaining({ commandId: '9:runtime-b:same-call', toolCallId: 'same-call' }), undefined);
  });
});
