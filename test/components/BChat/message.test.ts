/**
 * @file message.test.ts
 * @description BChat 消息工具行为测试
 */
import type { ChatMessageFile } from 'types/chat';
import { describe, expect, it } from 'vitest';
import { append, convert, create, expandFileReferencesForModel, is, userChoice } from '@/components/BChatSidebar/utils/messageHelper';
import type { Message } from '@/components/BChatSidebar/utils/types';

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

/**
 * 创建测试图片附件。
 * @param overrides - 覆盖默认字段
 * @returns 测试图片附件
 */
function createImageFile(overrides: Partial<ChatMessageFile> = {}): ChatMessageFile {
  return {
    id: 'image-1',
    name: 'diagram.png',
    type: 'image',
    mimeType: 'image/png',
    size: 1024,
    extension: 'png',
    url: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
    contentHash: 'hash-1',
    ...overrides
  };
}

describe('BChat message helpers', () => {
  it('creates a finished error message for visible stream failures', () => {
    const message = create.errorMessage('服务连接失败');

    expect(message.role).toBe('assistant');
    expect(message.content).toBe('服务连接失败');
    expect(message.parts).toEqual([{ type: 'error', text: '服务连接失败' }]);
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

    expect(convert.toModelMessages(messages)).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: [{ type: 'text', text: '你好，有什么可以帮你？' }] }
    ]);
  });

  it('expands file reference placeholders before sending user content to the model', () => {
    const content = '请解释 {{file-ref:{"path":"src/foo/file.ts","name":"file.ts","line":"12-14"}}} 这里的逻辑';

    expect(expandFileReferencesForModel(content)).toBe('请解释 引用文件：src/foo/file.ts，第 12-14 行 这里的逻辑');
  });

  it('expands unsaved file reference placeholders as temporary document references', () => {
    const content = '看下 {{file-ref:{"path":null,"name":"临时笔记","line":"3"}}}';

    expect(expandFileReferencesForModel(content)).toBe('看下 引用未保存文件：临时笔记，第 3 行');
  });

  it('marks error messages as persistable but not model messages', () => {
    const errorMessage = createTextMessage('error-1', 'error', '服务连接失败');

    expect(is.persistableMessage(errorMessage)).toBe(true);
    expect(is.modelMessage(errorMessage)).toBe(false);
    expect(is.persistableMessage(createTextMessage('assistant-1', 'assistant', '好的'))).toBe(true);
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

    expect(convert.toModelMessages(messages)).toEqual([
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

  it('converts user messages with images into multimodal model messages', () => {
    const message = create.userMessage('请描述这张图');
    message.files = [
      createImageFile({
        id: 'image-1',
        url: 'data:image/png;base64,Zmlyc3Q=',
        contentHash: 'hash-1'
      }),
      createImageFile({
        id: 'image-2',
        name: 'photo.jpg',
        mimeType: 'image/jpeg',
        extension: 'jpg',
        url: 'data:image/jpeg;base64,c2Vjb25k',
        contentHash: 'hash-2'
      })
    ];

    expect(convert.toModelMessages([message])).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '请描述这张图' },
          { type: 'image', image: 'data:image/png;base64,Zmlyc3Q=', mediaType: 'image/png' },
          { type: 'image', image: 'data:image/jpeg;base64,c2Vjb25k', mediaType: 'image/jpeg' }
        ]
      }
    ]);
  });

  it('reuses the cached model-message prefix when only new messages are appended', () => {
    const baseMessages = createBaseMessages();
    const baseCache = convert.toCachedModelMessages(baseMessages);
    const nextMessages: Message[] = [...baseMessages, createTextMessage('error-1', 'error', '服务连接失败'), createTextMessage('user-2', 'user', '继续')];

    const nextCache = convert.toCachedModelMessages(nextMessages, baseCache);

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
    const baseCache = convert.toCachedModelMessages(baseMessages);
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

    const nextCache = convert.toCachedModelMessages(changedMessages, baseCache);

    expect(nextCache.entries[0]).toBe(baseCache.entries[0]);
    expect(nextCache.entries[1]).not.toBe(baseCache.entries[1]);
    expect(nextCache.modelMessages).toEqual([
      { role: 'user', content: '你好' },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '我来帮你处理。' }]
      }
    ]);
  });

  it('rebuilds cached entries when a user message image hash changes', () => {
    const baseMessage = create.userMessage('请描述图片');
    baseMessage.files = [createImageFile({ contentHash: 'hash-1', url: 'data:image/png;base64,b25l' })];

    const baseCache = convert.toCachedModelMessages([baseMessage]);

    const changedMessage: Message = {
      ...baseMessage,
      files: [createImageFile({ contentHash: 'hash-2', url: 'data:image/png;base64,dHdv' })]
    };

    const nextCache = convert.toCachedModelMessages([changedMessage], baseCache);

    expect(nextCache.entries[0]).not.toBe(baseCache.entries[0]);
    expect(nextCache.modelMessages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '请描述图片' },
          { type: 'image', image: 'data:image/png;base64,dHdv', mediaType: 'image/png' }
        ]
      }
    ]);
  });

  it('drops unmatched assistant tool calls from model history to avoid missing tool results', () => {
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
            toolCallId: 'call_function_1u1uzdwv6q8z_1',
            toolName: 'read_current_document',
            input: {}
          }
        ]
      }
    ];

    expect(convert.toModelMessages(messages)).toEqual([{ role: 'user', content: '查看一下文档' }]);
  });

  it('keeps completed tool pairs and drops the final blocked repeated tool call', () => {
    const messages: Message[] = [
      createTextMessage('user-1', 'user', '切换一下主题色'),
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        createdAt: '2026-04-21T00:00:01.000Z',
        parts: [
          {
            type: 'tool-call',
            toolCallId: 'call_function_1u1uzdwv6q8z_1',
            toolName: 'update_settings',
            input: { key: 'theme', value: 'auto' }
          },
          {
            type: 'tool-result',
            toolCallId: 'call_function_1u1uzdwv6q8z_1',
            toolName: 'update_settings',
            result: {
              toolName: 'update_settings',
              status: 'failure',
              error: { code: 'INVALID_INPUT', message: 'theme 只能设置为 dark、light 或 system。' }
            }
          },
          {
            type: 'tool-call',
            toolCallId: 'call_function_1u1uzdwv6q8z_2',
            toolName: 'update_settings',
            input: { key: 'theme', value: 'auto' }
          }
        ]
      },
      createTextMessage('error-1', 'error', '工具 `update_settings` 使用相同参数重复调用超过限制（2），已停止自动续轮。'),
      createTextMessage('user-2', 'user', '重新设置一下')
    ];

    expect(convert.toModelMessages(messages)).toEqual([
      { role: 'user', content: '切换一下主题色' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_function_1u1uzdwv6q8z_1',
            toolName: 'update_settings',
            input: { key: 'theme', value: 'auto' }
          }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_function_1u1uzdwv6q8z_1',
            toolName: 'update_settings',
            output: {
              type: 'json',
              value: {
                toolName: 'update_settings',
                status: 'failure',
                error: { code: 'INVALID_INPUT', message: 'theme 只能设置为 dark、light 或 system。' }
              }
            }
          }
        ]
      },
      { role: 'user', content: '重新设置一下' }
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

    expect(is.removableAssistantPlaceholder(message)).toBe(false);
  });

  it('finds an awaiting ask_user_choice question in assistant history', () => {
    const message = create.assistantPlaceholder();

    append.toolCallPart(message, 'tool-call-1', 'ask_user_choice', { question: '请选择渠道' });
    append.toolResultPart(message, 'tool-call-1', 'ask_user_choice', {
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

    expect(userChoice.findPending([message])).toMatchObject({
      questionId: 'question-1',
      toolCallId: 'tool-call-1'
    });
  });

  it('replaces awaiting ask_user_choice result with the submitted answer for model history', () => {
    const message = create.assistantPlaceholder();

    append.toolCallPart(message, 'tool-call-1', 'ask_user_choice', { question: '请选择渠道' });
    append.toolResultPart(message, 'tool-call-1', 'ask_user_choice', {
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

    const submitted = userChoice.submitAnswer([message], {
      questionId: 'question-1',
      toolCallId: 'tool-call-1',
      answers: ['official'],
      otherText: ''
    });

    expect(submitted).toBe(true);
    expect(convert.toModelMessages([message])).toEqual([
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
