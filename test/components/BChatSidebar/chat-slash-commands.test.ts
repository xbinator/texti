/**
 * @file chat-slash-commands.test.ts
 * @description BChatSidebar 聊天斜杠命令注册表测试，校验首版动作命令的顺序与类型。
 */
import { describe, expect, test } from 'vitest';
import { chatSlashCommands } from '@/components/BChatSidebar/utils/slashCommands';

describe('chatSlashCommands', () => {
  test('exports first-version commands with the shared metadata contract', () => {
    expect(chatSlashCommands).toEqual([
      {
        id: 'model',
        trigger: '/model',
        title: 'Model',
        description: 'Switch the active model.',
        type: 'action'
      },
      {
        id: 'usage',
        trigger: '/usage',
        title: 'Usage',
        description: 'Show usage help for the chat sidebar.',
        type: 'action'
      },
      {
        id: 'new',
        trigger: '/new',
        title: 'New Chat',
        description: 'Start a new chat session.',
        type: 'action'
      },
      {
        id: 'clear',
        trigger: '/clear',
        title: 'Clear Chat',
        description: 'Clear the current chat input.',
        type: 'action'
      }
    ]);
  });
});
