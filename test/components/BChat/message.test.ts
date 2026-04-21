/**
 * @file message.test.ts
 * @description BChat 消息工具行为测试
 */
import { describe, expect, it } from 'vitest';
import { createErrorMessage, isModelMessage, isPersistableMessage, isRemovableAssistantPlaceholder, toModelMessages } from '@/components/BChat/message';
import type { Message } from '@/components/BChat/types';

describe('BChat message helpers', () => {
  it('creates a finished error message for visible stream failures', () => {
    const message = createErrorMessage('服务连接失败');

    expect(message.role).toBe('error');
    expect(message.content).toBe('服务连接失败');
    expect(message.loading).toBe(false);
    expect(message.finished).toBe(true);
    expect(message.createdAt).toEqual(expect.any(String));
  });

  it('excludes error messages from model history', () => {
    const messages: Message[] = [
      { id: 'user-1', role: 'user', content: '你好', createdAt: '2026-04-21T00:00:00.000Z' },
      { id: 'error-1', role: 'error', content: '服务连接失败', createdAt: '2026-04-21T00:00:01.000Z' },
      { id: 'assistant-1', role: 'assistant', content: '你好，有什么可以帮你？', createdAt: '2026-04-21T00:00:02.000Z' }
    ];

    expect(toModelMessages(messages)).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好，有什么可以帮你？' }
    ]);
  });

  it('marks error messages as persistable but not model messages', () => {
    const errorMessage: Message = { id: 'error-1', role: 'error', content: '服务连接失败', createdAt: '2026-04-21T00:00:01.000Z' };

    expect(isPersistableMessage(errorMessage)).toBe(true);
    expect(isModelMessage(errorMessage)).toBe(false);
    expect(isPersistableMessage({ id: 'assistant-1', role: 'assistant', content: '好的', createdAt: '2026-04-21T00:00:02.000Z' })).toBe(true);
  });

  it('preserves assistant tool-call metadata when converting continued tool loop history', () => {
    const messages: Message[] = [
      { id: 'user-1', role: 'user', content: '查看一下文档', createdAt: '2026-04-21T00:00:00.000Z' },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        createdAt: '2026-04-21T00:00:01.000Z',
        toolCalls: [
          {
            toolCallId: 'call_function_z4c3rw63ddmt_1',
            toolName: 'read_current_document',
            input: {}
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
      }
    ]);
  });

  it('keeps assistant placeholders that already contain tool-call metadata', () => {
    const message: Message = {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      createdAt: '2026-04-21T00:00:01.000Z',
      toolCalls: [
        {
          toolCallId: 'call_function_z4c3rw63ddmt_1',
          toolName: 'read_current_document',
          input: {}
        }
      ]
    };

    expect(isRemovableAssistantPlaceholder(message)).toBe(false);
  });
});
