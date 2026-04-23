/**
 * @file confirmation-controller.test.ts
 * @description 聊天会话确认控制器测试。
 */
import { describe, expect, it } from 'vitest';
import type { Message } from '@/components/BChat/types';
import { createChatConfirmationController } from '@/components/BChatSidebar/utils/confirmationController';

/**
 * 创建测试消息列表。
 * @returns 消息列表
 */
function createMessages(): Message[] {
  return [
    {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      parts: [],
      createdAt: '2026-04-22T00:00:00.000Z'
    }
  ];
}

describe('chat confirmation controller', () => {
  it('creates a pending confirmation card and approves it', async () => {
    const messages = createMessages();
    const controller = createChatConfirmationController({
      getMessages: () => messages
    });

    const promise = controller.requestConfirmation({
      toolName: 'insert_at_cursor',
      title: 'AI 想要插入内容',
      description: 'AI 请求在当前光标位置插入新内容。',
      permission: 'write',
      afterText: 'hello'
    });
    const confirmationPart = messages[0].parts[0];

    expect(confirmationPart?.type).toBe('confirmation');
    expect(confirmationPart?.type === 'confirmation' ? confirmationPart.confirmationStatus : '').toBe('pending');

    controller.approveConfirmation(confirmationPart.type === 'confirmation' ? confirmationPart.confirmationId : '');

    await expect(promise).resolves.toBe(true);
    expect(confirmationPart?.type === 'confirmation' ? confirmationPart.confirmationStatus : '').toBe('approved');
  });

  it('marks the active confirmation as expired before creating a new one', async () => {
    const messages = createMessages();
    const controller = createChatConfirmationController({
      getMessages: () => messages
    });

    const firstPromise = controller.requestConfirmation({
      toolName: 'insert_at_cursor',
      title: 'AI 想要插入内容',
      description: 'AI 请求在当前光标位置插入新内容。',
      permission: 'write',
      afterText: 'first'
    });

    const firstPart = messages[0].parts[0];

    const secondPromise = controller.requestConfirmation({
      toolName: 'insert_at_cursor',
      title: 'AI 想要插入内容',
      description: 'AI 请求在当前光标位置插入新内容。',
      permission: 'write',
      afterText: 'second'
    });

    await expect(firstPromise).resolves.toBe(false);
    expect(firstPart?.type === 'confirmation' ? firstPart.confirmationStatus : '').toBe('expired');

    const secondPart = messages[0].parts[1];
    controller.cancelConfirmation(secondPart.type === 'confirmation' ? secondPart.confirmationId : '');
    await expect(secondPromise).resolves.toBe(false);
    expect(secondPart?.type === 'confirmation' ? secondPart.confirmationStatus : '').toBe('cancelled');
  });

  it('tracks execution lifecycle for an approved confirmation', async () => {
    const messages = createMessages();
    const controller = createChatConfirmationController({
      getMessages: () => messages
    });

    const promise = controller.requestConfirmation({
      toolName: 'replace_selection',
      title: 'AI 想要替换当前选区',
      description: 'AI 请求用新内容替换当前选中的文本。',
      permission: 'write',
      beforeText: 'old',
      afterText: 'new'
    });
    const confirmationPart = messages[0].parts[0];
    const confirmationId = confirmationPart.type === 'confirmation' ? confirmationPart.confirmationId : '';

    controller.approveConfirmation(confirmationId);
    await expect(promise).resolves.toBe(true);

    controller.markExecutionStart();
    expect(confirmationPart.type === 'confirmation' ? confirmationPart.executionStatus : '').toBe('running');

    controller.markExecutionComplete({ status: 'failure', errorMessage: '磁盘写入失败' });
    expect(confirmationPart.type === 'confirmation' ? confirmationPart.executionStatus : '').toBe('failure');
    expect(confirmationPart.type === 'confirmation' ? confirmationPart.executionError : '').toBe('磁盘写入失败');
  });
});
