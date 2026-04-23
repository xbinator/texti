import type { AIToolContext, AIToolExecutor } from 'types/ai';
import { describe, expect, it } from 'vitest';
import { createAwaitingUserInputResult, createToolSuccessResult } from '@/ai/tools/results';
import { createToolResultMessages, executeToolCall, toTransportTools } from '@/ai/tools/stream';

function createContext(): AIToolContext {
  return {
    document: {
      id: 'doc-1',
      title: 'Note',
      path: null,
      getContent: () => 'content'
    },
    editor: {
      getSelection: () => null,
      insertAtCursor: async () => undefined,
      replaceSelection: async () => undefined,
      replaceDocument: async () => undefined
    }
  };
}

const echoTool: AIToolExecutor<{ value: string }, { value: string }> = {
  definition: {
    name: 'echo',
    description: 'Echo value',
    source: 'builtin',
    permission: 'read',
    parameters: {
      type: 'object',
      properties: {
        value: { type: 'string' }
      },
      required: ['value'],
      additionalProperties: false
    }
  },
  async execute(input) {
    return createToolSuccessResult('echo', { value: input.value });
  }
};

const contextFreeTool: AIToolExecutor<Record<string, never>, { applied: true }> = {
  definition: {
    name: 'context_free',
    description: 'Context free tool',
    source: 'builtin',
    permission: 'write',
    requiresActiveDocument: false,
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  },
  async execute() {
    return createToolSuccessResult('context_free', { applied: true });
  }
};

describe('AI tool stream helpers', () => {
  it('converts executors to transport tools', () => {
    expect(toTransportTools([echoTool])).toEqual([
      {
        name: 'echo',
        description: 'Echo value',
        parameters: {
          type: 'object',
          properties: {
            value: { type: 'string' }
          },
          required: ['value'],
          additionalProperties: false
        }
      }
    ]);
  });

  it('executes a registered tool', async () => {
    const result = await executeToolCall({ toolCallId: 'call-1', toolName: 'echo', input: { value: 'hi' } }, [echoTool], createContext());

    expect(result).toEqual({
      toolCallId: 'call-1',
      toolName: 'echo',
      input: { value: 'hi' },
      result: {
        toolName: 'echo',
        status: 'success',
        data: { value: 'hi' }
      }
    });
  });

  it('injects toolCallId into awaiting user input results', async () => {
    const awaitingTool: AIToolExecutor<Record<string, never>> = {
      definition: {
        name: 'ask_user_choice',
        description: 'Ask user choice',
        source: 'builtin',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      },
      async execute() {
        return createAwaitingUserInputResult('ask_user_choice', {
          questionId: 'question-1',
          toolCallId: '',
          mode: 'single',
          question: '请选择',
          options: [{ label: '官网', value: 'official' }],
          allowOther: false
        });
      }
    };

    const result = await executeToolCall({ toolCallId: 'tool-call-1', toolName: 'ask_user_choice', input: {} }, [awaitingTool], createContext());
    const messages = createToolResultMessages([result]);

    expect(result.result).toMatchObject({
      status: 'awaiting_user_input',
      data: {
        toolCallId: 'tool-call-1'
      }
    });
    expect(messages[0]).toMatchObject({ role: 'tool' });
  });

  it('returns a failure for unknown tools', async () => {
    const result = await executeToolCall({ toolCallId: 'call-2', toolName: 'missing', input: {} }, [echoTool], createContext());

    expect(result.result.status).toBe('failure');
    expect(result.result.error?.code).toBe('TOOL_NOT_FOUND');
  });

  it('returns a failure when no active context exists', async () => {
    const result = await executeToolCall({ toolCallId: 'call-3', toolName: 'echo', input: { value: 'hi' } }, [echoTool], undefined);

    expect(result.result.status).toBe('failure');
    expect(result.result.error?.code).toBe('NO_ACTIVE_DOCUMENT');
  });

  it('executes tools that do not require an active document without editor context', async () => {
    const result = await executeToolCall({ toolCallId: 'call-4', toolName: 'context_free', input: {} }, [contextFreeTool], undefined);

    expect(result.result).toEqual({
      toolName: 'context_free',
      status: 'success',
      data: { applied: true }
    });
  });

  it('creates tool-result model messages from executed tool calls', () => {
    const messages = createToolResultMessages([
      {
        toolCallId: 'call-1',
        toolName: 'echo',
        input: { value: 'hi' },
        result: createToolSuccessResult('echo', { value: 'hi' })
      }
    ]);

    expect(messages).toEqual([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'echo',
            output: {
              type: 'json',
              value: {
                toolName: 'echo',
                status: 'success',
                data: { value: 'hi' }
              }
            }
          }
        ]
      }
    ]);
  });
});
