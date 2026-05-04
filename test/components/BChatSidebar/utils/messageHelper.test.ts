/**
 * @file messageHelper.test.ts
 * @description 消息创建、转换与持久化过滤工具测试
 */
import type { ChatMessagePart } from 'types/chat';
import { describe, expect, it } from 'vitest';
import { is, append, create, userChoice, convert } from '@/components/BChatSidebar/utils/messageHelper';
import type { Message } from '@/components/BChatSidebar/utils/types';

describe('is.modelMessage', () => {
  it('returns true for user message', () => {
    const message: Message = {
      id: 'test-id',
      role: 'user',
      content: 'test content',
      parts: [],
      loading: false,
      createdAt: new Date().toISOString()
    };
    expect(is.modelMessage(message)).toBe(true);
  });

  it('returns true for assistant message', () => {
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: 'test content',
      parts: [],
      loading: false,
      createdAt: new Date().toISOString()
    };
    expect(is.modelMessage(message)).toBe(true);
  });

  it('returns false for system message', () => {
    const message: Message = {
      id: 'test-id',
      role: 'system',
      content: 'test content',
      parts: [],
      loading: false,
      createdAt: new Date().toISOString()
    };
    expect(is.modelMessage(message)).toBe(false);
  });

  it('returns false for error message', () => {
    const message: Message = {
      id: 'test-id',
      role: 'error',
      content: 'test content',
      parts: [],
      loading: false,
      createdAt: new Date().toISOString()
    };
    expect(is.modelMessage(message)).toBe(false);
  });
});

describe('is.persistableMessage', () => {
  it('returns true for user message', () => {
    const message: Message = {
      id: 'test-id',
      role: 'user',
      content: 'test content',
      parts: [],
      loading: false,
      createdAt: new Date().toISOString()
    };
    expect(is.persistableMessage(message)).toBe(true);
  });

  it('returns true for assistant message', () => {
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: 'test content',
      parts: [],
      loading: false,
      createdAt: new Date().toISOString()
    };
    expect(is.persistableMessage(message)).toBe(true);
  });

  it('returns true for error message', () => {
    const message: Message = {
      id: 'test-id',
      role: 'error',
      content: 'test content',
      parts: [],
      loading: false,
      createdAt: new Date().toISOString()
    };
    expect(is.persistableMessage(message)).toBe(true);
  });

  it('returns false for system message', () => {
    const message: Message = {
      id: 'test-id',
      role: 'system',
      content: 'test content',
      parts: [],
      loading: false,
      createdAt: new Date().toISOString()
    };
    expect(is.persistableMessage(message)).toBe(false);
  });
});

describe('is.removableAssistantPlaceholder', () => {
  it('returns true for empty assistant placeholder', () => {
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: '',
      parts: [],
      loading: true,
      createdAt: ''
    };
    expect(is.removableAssistantPlaceholder(message)).toBe(true);
  });

  it('returns false for assistant message with content', () => {
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: 'test content',
      parts: [{ type: 'text', text: 'test content' }],
      loading: false,
      createdAt: new Date().toISOString()
    };
    expect(is.removableAssistantPlaceholder(message)).toBe(false);
  });

  it('returns false for assistant message with usage', () => {
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: '',
      parts: [],
      loading: false,
      createdAt: new Date().toISOString(),
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }
    };
    expect(is.removableAssistantPlaceholder(message)).toBe(false);
  });

  it('returns false for non-assistant message', () => {
    const message: Message = {
      id: 'test-id',
      role: 'user',
      content: '',
      parts: [],
      loading: false,
      createdAt: new Date().toISOString()
    };
    expect(is.removableAssistantPlaceholder(message)).toBe(false);
  });

  it('returns false for undefined message', () => {
    expect(is.removableAssistantPlaceholder(undefined)).toBe(false);
  });
});

describe('append.textPart', () => {
  it('appends text to empty parts array', () => {
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: '',
      parts: [],
      loading: false,
      createdAt: new Date().toISOString()
    };
    append.textPart(message, 'hello');
    expect(message.parts).toEqual([{ type: 'text', text: 'hello' }]);
    expect(message.content).toBe('');
  });

  it('appends text to existing text part', () => {
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: 'hello',
      parts: [{ type: 'text', text: 'hello' }],
      loading: false,
      createdAt: new Date().toISOString()
    };
    append.textPart(message, ' world');
    expect(message.parts).toEqual([{ type: 'text', text: 'hello world' }]);
    expect(message.content).toBe('hello');
  });

  it('creates new text part when last part is not text', () => {
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: '',
      parts: [{ type: 'thinking', thinking: 'thinking...' }],
      loading: false,
      createdAt: new Date().toISOString()
    };
    append.textPart(message, 'hello');
    expect(message.parts).toEqual([
      { type: 'thinking', thinking: 'thinking...' },
      { type: 'text', text: 'hello' }
    ]);
    expect(message.content).toBe('');
  });
});

describe('append.thinkingPart', () => {
  it('appends thinking to empty parts array', () => {
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: '',
      parts: [],
      loading: false,
      createdAt: new Date().toISOString()
    };
    append.thinkingPart(message, 'thinking...');
    expect(message.parts).toEqual([{ type: 'thinking', thinking: 'thinking...' }]);
    expect(message.thinking).toBe('thinking...');
  });

  it('appends thinking to existing thinking part', () => {
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: '',
      parts: [{ type: 'thinking', thinking: 'thinking...' }],
      thinking: 'thinking...',
      loading: false,
      createdAt: new Date().toISOString()
    };
    append.thinkingPart(message, ' more');
    expect(message.parts).toEqual([{ type: 'thinking', thinking: 'thinking... more' }]);
    expect(message.thinking).toBe('thinking... more');
  });

  it('creates new thinking part when last part is not thinking', () => {
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: 'hello',
      parts: [{ type: 'text', text: 'hello' }],
      loading: false,
      createdAt: new Date().toISOString()
    };
    append.thinkingPart(message, 'thinking...');
    expect(message.parts).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'thinking', thinking: 'thinking...' }
    ]);
    expect(message.thinking).toBe('thinking...');
  });
});

describe('append.toolCallPart', () => {
  it('appends tool call to parts array', () => {
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: '',
      parts: [],
      loading: false,
      createdAt: new Date().toISOString()
    };
    append.toolCallPart(message, 'tool-call-1', 'test_tool', { arg1: 'value1' });
    expect(message.parts).toEqual([{ type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'test_tool', input: { arg1: 'value1' } }]);
  });

  it('appends multiple tool calls', () => {
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: '',
      parts: [],
      loading: false,
      createdAt: new Date().toISOString()
    };
    append.toolCallPart(message, 'tool-call-1', 'tool1', {});
    append.toolCallPart(message, 'tool-call-2', 'tool2', {});
    expect(message.parts).toHaveLength(2);
  });
});

describe('append.toolResultPart', () => {
  it('appends tool result to parts array when no matching tool call', () => {
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: '',
      parts: [],
      loading: false,
      createdAt: new Date().toISOString()
    };
    append.toolResultPart(message, 'tool-call-1', 'test_tool', { status: 'success', toolName: 'test_tool', data: {} });
    expect(message.parts).toEqual([
      { type: 'tool-result', toolCallId: 'tool-call-1', toolName: 'test_tool', result: { status: 'success', toolName: 'test_tool', data: {} } }
    ]);
  });

  it('inserts tool result after matching tool call', () => {
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: '',
      parts: [
        { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'test_tool', input: {} },
        { type: 'text', text: 'some text' }
      ],
      loading: false,
      createdAt: new Date().toISOString()
    };
    append.toolResultPart(message, 'tool-call-1', 'test_tool', { status: 'success', toolName: 'test_tool', data: {} });
    expect(message.parts).toEqual([
      { type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'test_tool', input: {} },
      { type: 'tool-result', toolCallId: 'tool-call-1', toolName: 'test_tool', result: { status: 'success', toolName: 'test_tool', data: {} } },
      { type: 'text', text: 'some text' }
    ]);
  });
});

describe('create.assistantPlaceholder', () => {
  it('creates assistant placeholder message', () => {
    const message = create.assistantPlaceholder();
    expect(message.role).toBe('assistant');
    expect(message.content).toBe('');
    expect(message.thinking).toBe('');
    expect(message.parts).toEqual([]);
    expect(message.loading).toBe(true);
    expect(message.createdAt).toBe('');
    expect(message.id).toBeDefined();
  });
});

describe('create.errorMessage', () => {
  it('creates error message with content', () => {
    const message = create.errorMessage('Something went wrong');
    expect(message.role).toBe('assistant');
    expect(message.content).toBe('Something went wrong');
    expect(message.parts).toEqual([{ type: 'error', text: 'Something went wrong' }]);
    expect(message.finished).toBe(true);
    expect(message.id).toBeDefined();
  });
});

describe('create.userMessage', () => {
  it('creates user message with content', () => {
    const message = create.userMessage('Hello, world!');
    expect(message.role).toBe('user');
    expect(message.content).toBe('Hello, world!');
    expect(message.parts).toEqual([{ type: 'text', text: 'Hello, world!' }]);
    expect(message.finished).toBe(true);
    expect(message.id).toBeDefined();
  });

  it('creates user message with empty content', () => {
    const message = create.userMessage('');
    expect(message.role).toBe('user');
    expect(message.content).toBe('');
    expect(message.parts).toEqual([]);
    expect(message.finished).toBe(true);
  });
});

describe('create.systemMessage', () => {
  it('creates system message with content', () => {
    const message = create.systemMessage('System instruction');
    expect(message.role).toBe('system');
    expect(message.content).toBe('System instruction');
    expect(message.parts).toEqual([{ type: 'text', text: 'System instruction' }]);
    expect(message.finished).toBe(true);
    expect(message.id).toBeDefined();
  });
});

describe('userChoice.findPending', () => {
  it('returns null when no pending user choice', () => {
    const messages: Message[] = [create.userMessage('Hello'), create.assistantPlaceholder()];
    expect(userChoice.findPending(messages)).toBeNull();
  });

  it('finds pending user choice in last message', () => {
    const questionData = {
      questionId: 'q1',
      toolCallId: 'tc1',
      mode: 'single' as const,
      question: 'Choose an option',
      options: [{ id: 'opt1', label: 'Option 1', value: 'opt1' }],
      allowOther: false
    };
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: '',
      parts: [
        {
          type: 'tool-result',
          toolCallId: 'tc1',
          toolName: 'ask_user_choice',
          result: {
            toolName: 'ask_user_choice',
            status: 'awaiting_user_input',
            data: questionData
          }
        }
      ],
      loading: false,
      createdAt: new Date().toISOString()
    };
    const messages: Message[] = [message];
    expect(userChoice.findPending(messages)).toEqual(questionData);
  });

  it('returns null for answered user choice', () => {
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: '',
      parts: [
        {
          type: 'tool-result',
          toolCallId: 'tc1',
          toolName: 'ask_user_choice',
          result: {
            status: 'success',
            toolName: 'ask_user_choice',
            data: {
              questionId: 'q1',
              selectedOptionId: 'opt1'
            }
          }
        }
      ],
      loading: false,
      createdAt: new Date().toISOString()
    };
    const messages: Message[] = [message];
    expect(userChoice.findPending(messages)).toBeNull();
  });
});

describe('userChoice.submitAnswer', () => {
  it('submits answer to pending user choice', () => {
    const questionData = {
      questionId: 'q1',
      toolCallId: 'tc1',
      mode: 'single' as const,
      question: 'Choose an option',
      options: [{ id: 'opt1', label: 'Option 1', value: 'opt1' }],
      allowOther: false
    };
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: '',
      parts: [
        {
          type: 'tool-result',
          toolCallId: 'tc1',
          toolName: 'ask_user_choice',
          result: {
            toolName: 'ask_user_choice',
            status: 'awaiting_user_input',
            data: questionData
          }
        }
      ],
      loading: false,
      createdAt: new Date().toISOString()
    };
    const messages: Message[] = [message];

    const answer = {
      toolCallId: 'tc1',
      questionId: 'q1',
      answers: ['opt1']
    };

    const result = userChoice.submitAnswer(messages, answer);
    expect(result).toBe(true);
    const toolResultPart = message.parts[0] as Extract<ChatMessagePart, { type: 'tool-result' }>;
    expect(toolResultPart.result.status).toBe('success');
  });

  it('returns false when no matching pending question', () => {
    const messages: Message[] = [create.userMessage('Hello')];
    const answer = {
      toolCallId: 'tc1',
      questionId: 'q1',
      answers: ['opt1']
    };
    const result = userChoice.submitAnswer(messages, answer);
    expect(result).toBe(false);
  });
});

describe('convert.toModelMessages', () => {
  it('converts user message to model message', () => {
    const messages: Message[] = [create.userMessage('Hello')];
    const modelMessages = convert.toModelMessages(messages);
    expect(modelMessages).toHaveLength(1);
    expect(modelMessages[0]).toEqual({
      role: 'user',
      content: 'Hello'
    });
  });

  it('converts assistant message with text parts', () => {
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: 'Hello',
      parts: [{ type: 'text', text: 'Hello' }],
      loading: false,
      createdAt: new Date().toISOString()
    };
    const messages: Message[] = [message];
    const modelMessages = convert.toModelMessages(messages);
    expect(modelMessages).toHaveLength(1);
    expect(modelMessages[0]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello' }]
    });
  });

  it('converts assistant message with tool calls and results', () => {
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: '',
      parts: [
        { type: 'tool-call', toolCallId: 'tc1', toolName: 'test_tool', input: { arg: 'value' } },
        { type: 'tool-result', toolCallId: 'tc1', toolName: 'test_tool', result: { status: 'success', toolName: 'test_tool', data: {} } }
      ],
      loading: false,
      createdAt: new Date().toISOString()
    };
    const messages: Message[] = [message];
    const modelMessages = convert.toModelMessages(messages);
    expect(modelMessages).toHaveLength(2);
    expect(modelMessages[0].role).toBe('assistant');
    expect(modelMessages[1].role).toBe('tool');
  });

  it('filters out non-model messages', () => {
    const messages: Message[] = [create.systemMessage('System instruction'), create.userMessage('Hello')];
    const modelMessages = convert.toModelMessages(messages);
    expect(modelMessages).toHaveLength(1);
    expect(modelMessages[0].role).toBe('user');
  });

  it('converts user message with image files', () => {
    const message: Message = {
      id: 'test-id',
      role: 'user',
      content: 'Check this image',
      parts: [{ type: 'text', text: 'Check this image' }],
      files: [
        {
          id: 'file1',
          name: 'test.png',
          type: 'image',
          url: 'data:image/png;base64,abc',
          mimeType: 'image/png',
          size: 1000,
          contentHash: 'hash1'
        }
      ],
      loading: false,
      createdAt: new Date().toISOString()
    };
    const messages: Message[] = [message];
    const modelMessages = convert.toModelMessages(messages);
    expect(modelMessages).toHaveLength(1);
    expect(modelMessages[0].role).toBe('user');
    expect(Array.isArray(modelMessages[0].content)).toBe(true);
  });
});

describe('convert.toCachedModelMessages', () => {
  it('creates cache entries for messages', () => {
    const messages: Message[] = [create.userMessage('Hello')];
    const result = convert.toCachedModelMessages(messages);
    expect(result.entries).toHaveLength(1);
    expect(result.modelMessages).toHaveLength(1);
    expect(result.entries[0].sourceMessage).toBe(messages[0]);
    expect(result.entries[0].modelMessages).toHaveLength(1);
  });

  it('reuses cache from previous result', () => {
    const messages1: Message[] = [create.userMessage('Hello')];
    const result1 = convert.toCachedModelMessages(messages1);

    const messages2: Message[] = [...messages1, create.userMessage('World')];
    const result2 = convert.toCachedModelMessages(messages2, result1);

    expect(result2.entries).toHaveLength(2);
    expect(result2.entries[0]).toBe(result1.entries[0]);
    expect(result2.modelMessages).toHaveLength(2);
  });

  it('invalidates cache when message changes', () => {
    const messages1: Message[] = [create.userMessage('Hello')];
    const result1 = convert.toCachedModelMessages(messages1);

    const messages2: Message[] = [create.userMessage('Hello Changed'), create.userMessage('World')];
    const result2 = convert.toCachedModelMessages(messages2, result1);

    expect(result2.entries).toHaveLength(2);
    expect(result2.entries[0]).not.toBe(result1.entries[0]);
    expect(result2.modelMessages).toHaveLength(2);
  });
});
