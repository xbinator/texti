/**
 * @file message.test.ts
 * @description BChat 消息工具行为测试
 */
import { describe, expect, it } from 'vitest';
import {
  appendToolCallPart,
  appendToolResultPart,
  createAssistantPlaceholder,
  createErrorMessage,
  findPendingUserChoiceQuestion,
  isModelMessage,
  isPersistableMessage,
  isRemovableAssistantPlaceholder,
  submitUserChoiceAnswer,
  toCachedModelMessages,
  toModelMessages
} from '@/components/BChat/message';
import type { Message } from '@/components/BChat/types';

/**
 * 创建文本消息，便于测试结构化片段。
 * @param id - 消息 ID
 * @param role - 消息角色
 * @param content - 消息文本内容
 */
function createTextMessage(id: string, role: Message['role'], content: string): Message {
  return { id, role, content, parts: [{ type: 'text', text: content }], createdAt: '2026-04-21T00:00:00.000Z' };
}

/**
 * 创建基础消息列表，便于复用缓存相关测试。
 * @returns 测试使用的基础消息
 */
function createBaseMessages(): Message[] {
  return [
    createTextMessage('user-1', 'user', '你好'),
    { ...createTextMessage('assistant-1', 'assistant', '我来帮你处理。'), createdAt: '2026-04-21T00:00:01.000Z' }
  ];
}

describe('BChat message helpers', () => {
  it('creates a finished error message for visible stream failures', () => {
    const message = createErrorMessage('服务连接失败');

    expect(message.role).toBe('error');
    expect(message.content).toBe('服务连接失败');
    expect(message.parts).toEqual([{ type: 'text', text: '服务连接失败' }]);
    expect(message.loading).toBe(false);
    expect(message.finished).toBe(true);
    expect(message.createdAt).toEqual(expect.any(String));
  });

  it('excludes error messages from model history', () => {
    const messages: Message[] = [
      createTextMessage('user-1', 'user', '你好'),
      { ...createTextMessage('error-1', 'error', '服务连接失败'), createdAt: '2026-04-21T00:00:01.000Z' },
      { ...createTextMessage('assistant-1', 'assistant', '你好，有什么可以帮你？'), createdAt: '2026-04-21T00:00:02.000Z' }
    ];

    expect(toModelMessages(messages)).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: [{ type: 'text', text: '你好，有什么可以帮你？' }] }
    ]);
  });

  it('marks error messages as persistable but not model messages', () => {
    const errorMessage = createTextMessage('error-1', 'error', '服务连接失败');

    expect(isPersistableMessage(errorMessage)).toBe(true);
    expect(isModelMessage(errorMessage)).toBe(false);
    expect(isPersistableMessage(createTextMessage('assistant-1', 'assistant', '好的'))).toBe(true);
  });

  it('preserves assistant tool parts when converting continued tool loop history', () => {
    const messages: Message[] = [
      createTextMessage('user-1', 'user', '查看一下文档'),
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        createdAt: '2026-04-21T00:00:01.000Z',
        parts: [
          {
            type: 'tool-call',
            toolCallId: 'call_function_z4c3rw63ddmt_1',
            toolName: 'read_current_document',
            input: {}
          },
          {
            type: 'tool-result',
            toolCallId: 'call_function_z4c3rw63ddmt_1',
            toolName: 'read_current_document',
            result: {
              toolName: 'read_current_document',
              status: 'success',
              data: { content: '文档内容' }
            }
          }
        ]
      }
    ];

    expect(toModelMessages(messages)).toEqual([
      { role: 'user', content: '查看一下文档' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_function_z4c3rw63ddmt_1',
            toolName: 'read_current_document',
            input: {}
          }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_function_z4c3rw63ddmt_1',
            toolName: 'read_current_document',
            output: {
              type: 'json',
              value: {
                toolName: 'read_current_document',
                status: 'success',
                data: { content: '文档内容' }
              }
            }
          }
        ]
      }
    ]);
  });

  it('reuses the cached model-message prefix when only new messages are appended', () => {
    const baseMessages = createBaseMessages();
    const baseCache = toCachedModelMessages(baseMessages);
    const nextMessages: Message[] = [...baseMessages, createTextMessage('error-1', 'error', '服务连接失败'), createTextMessage('user-2', 'user', '继续')];

    const nextCache = toCachedModelMessages(nextMessages, baseCache);

    expect(nextCache.modelMessages).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: [{ type: 'text', text: '我来帮你处理。' }] },
      { role: 'user', content: '继续' }
    ]);
    expect(nextCache.entries[0]).toBe(baseCache.entries[0]);
    expect(nextCache.entries[1]).toBe(baseCache.entries[1]);
  });

  it('rebuilds cached entries when an existing assistant message changes', () => {
    const baseMessages = createBaseMessages();
    const baseCache = toCachedModelMessages(baseMessages);
    const changedMessages: Message[] = [
      baseMessages[0],
      {
        ...baseMessages[1],
        parts: [
          { type: 'text', text: '我来帮你处理。' },
          {
            type: 'tool-call',
            toolCallId: 'call_function_z4c3rw63ddmt_2',
            toolName: 'read_current_document',
            input: { path: '/docs/guide.md' }
          }
        ]
      }
    ];

    const nextCache = toCachedModelMessages(changedMessages, baseCache);

    expect(nextCache.entries[0]).toBe(baseCache.entries[0]);
    expect(nextCache.entries[1]).not.toBe(baseCache.entries[1]);
    expect(nextCache.modelMessages).toEqual([
      { role: 'user', content: '你好' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我来帮你处理。' },
          {
            type: 'tool-call',
            toolCallId: 'call_function_z4c3rw63ddmt_2',
            toolName: 'read_current_document',
            input: { path: '/docs/guide.md' }
          }
        ]
      }
    ]);
  });

  it('keeps assistant placeholders that already contain tool-call metadata', () => {
    const message: Message = {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      createdAt: '2026-04-21T00:00:01.000Z',
      parts: [
        {
          type: 'tool-call',
          toolCallId: 'call_function_z4c3rw63ddmt_1',
          toolName: 'read_current_document',
          input: {}
        }
      ]
    };

    expect(isRemovableAssistantPlaceholder(message)).toBe(false);
  });

  it('finds an awaiting ask_user_choice question in assistant history', () => {
    const message = createAssistantPlaceholder();

    appendToolCallPart(message, 'tool-call-1', 'ask_user_choice', { question: '请选择渠道' });
    appendToolResultPart(message, 'tool-call-1', 'ask_user_choice', {
      toolName: 'ask_user_choice',
      status: 'awaiting_user_input',
      data: {
        questionId: 'question-1',
        toolCallId: 'tool-call-1',
        mode: 'single',
        question: '请选择渠道',
        options: [{ label: '官网', value: 'official' }],
        allowOther: false
      }
    });

    expect(findPendingUserChoiceQuestion([message])).toMatchObject({
      questionId: 'question-1',
      toolCallId: 'tool-call-1'
    });
  });

  it('replaces awaiting ask_user_choice result with the submitted answer for model history', () => {
    const message = createAssistantPlaceholder();

    appendToolCallPart(message, 'tool-call-1', 'ask_user_choice', { question: '请选择渠道' });
    appendToolResultPart(message, 'tool-call-1', 'ask_user_choice', {
      toolName: 'ask_user_choice',
      status: 'awaiting_user_input',
      data: {
        questionId: 'question-1',
        toolCallId: 'tool-call-1',
        mode: 'single',
        question: '请选择渠道',
        options: [{ label: '官网', value: 'official' }],
        allowOther: false
      }
    });

    const submitted = submitUserChoiceAnswer([message], {
      questionId: 'question-1',
      toolCallId: 'tool-call-1',
      answers: ['official'],
      otherText: ''
    });

    expect(submitted).toBe(true);
    expect(toModelMessages([message])).toEqual([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'tool-call-1',
            toolName: 'ask_user_choice',
            input: { question: '请选择渠道' }
          }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tool-call-1',
            toolName: 'ask_user_choice',
            output: {
              type: 'json',
              value: {
                toolName: 'ask_user_choice',
                status: 'success',
                data: {
                  questionId: 'question-1',
                  toolCallId: 'tool-call-1',
                  answers: ['official'],
                  otherText: ''
                }
              }
            }
          }
        ]
      }
    ]);
  });
});
