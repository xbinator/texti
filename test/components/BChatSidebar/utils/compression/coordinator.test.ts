/**
 * @file coordinator.test.ts
 * @description Coordinator 模块测试：压缩流程编排、并发锁、失败兜底。
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConversationSummaryRecord, SummaryStorage } from '@/components/BChatSidebar/utils/compression/types';
import type { Message } from '@/components/BChatSidebar/utils/types';

// Mock 存储模块
vi.mock('@/shared/storage', () => ({
  providerStorage: {
    getProvider: vi.fn().mockResolvedValue(null)
  },
  serviceModelsStorage: {
    getConfig: vi.fn().mockResolvedValue(null)
  }
}));

// Mock electron API
vi.mock('@/shared/platform/electron-api', () => ({
  getElectronAPI: vi.fn().mockReturnValue({
    aiInvoke: vi.fn().mockResolvedValue([null, { text: '{}' }])
  })
}));

/**
 * 创建测试用基础消息。
 */
function makeMsg(overrides: Partial<Message> & { id: string }): Message {
  return {
    role: 'user',
    content: '',
    parts: [],
    loading: false,
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

/**
 * 创建测试用摘要记录。
 */
function makeSummary(overrides: Partial<ConversationSummaryRecord> = {}): ConversationSummaryRecord {
  return {
    id: 'summary-1',
    sessionId: 'session-1',
    buildMode: 'incremental',
    coveredStartMessageId: 'm1',
    coveredEndMessageId: 'm5',
    coveredUntilMessageId: 'm5',
    sourceMessageIds: ['m1', 'm2', 'm3', 'm4', 'm5'],
    preservedMessageIds: [],
    summaryText: 'Test summary text.',
    structuredSummary: {
      goal: 'Test',
      recentTopic: 'Testing',
      userPreferences: [],
      constraints: [],
      decisions: [],
      importantFacts: [],
      fileContext: [],
      openQuestions: [],
      pendingActions: []
    },
    triggerReason: 'message_count',
    messageCountSnapshot: 10,
    charCountSnapshot: 2000,
    schemaVersion: 1,
    status: 'valid',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

/**
 * 创建模拟的 SummaryStorage。
 */
function createMockStorage(summary?: ConversationSummaryRecord): SummaryStorage {
  return {
    getValidSummary: vi.fn().mockResolvedValue(summary),
    createSummary: vi.fn().mockImplementation((record) =>
      Promise.resolve({
        ...record,
        id: 'new-summary-id',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
    ),
    updateSummaryStatus: vi.fn().mockResolvedValue(undefined),
    getAllSummaries: vi.fn().mockResolvedValue([])
  };
}

describe('coordinator - prepareMessagesBeforeSend', () => {
  it('returns assembled messages without compression when under threshold', async () => {
    const { createCompressionCoordinator } = await import('@/components/BChatSidebar/utils/compression/coordinator');
    const mockStorage = createMockStorage();

    const coordinator = createCompressionCoordinator(mockStorage);
    const messages: Message[] = [
      makeMsg({ id: 'm1', role: 'user', content: 'Hello', parts: [{ type: 'text', text: 'Hello' } as never] }),
      makeMsg({ id: 'm2', role: 'assistant', content: 'Hi', parts: [{ type: 'text', text: 'Hi' } as never] })
    ];
    const currentUserMessage = makeMsg({ id: 'current', role: 'user', content: 'New question', parts: [{ type: 'text', text: 'New question' } as never] });

    const result = await coordinator.prepareMessagesBeforeSend({
      sessionId: 'session-1',
      messages,
      currentUserMessage
    });

    expect(result.modelMessages.length).toBeGreaterThan(0);
    expect(result.compressed).toBe(false);
    const userMessages = result.modelMessages.filter((message) => message.role === 'user');
    const currentMessages = userMessages.filter((message) => message.content === 'New question');
    expect(currentMessages).toHaveLength(1);
  });

  it('returns compressed context when over threshold', async () => {
    const { createCompressionCoordinator } = await import('@/components/BChatSidebar/utils/compression/coordinator');
    const mockStorage = createMockStorage();

    const coordinator = createCompressionCoordinator(mockStorage);

    // Create many messages to exceed round threshold
    const messages: Message[] = [];
    for (let i = 1; i <= 62; i += 1) {
      const role = i % 2 === 1 ? 'user' : 'assistant';
      messages.push(
        makeMsg({
          id: `m${i}`,
          role,
          content: `Message ${i} with some additional text to make it longer and exceed the character threshold`,
          parts: [{ type: 'text', text: `Message ${i} with some additional text to make it longer and exceed the character threshold` } as never]
        })
      );
    }
    const currentUserMessage = makeMsg({ id: 'current', role: 'user', content: 'New question', parts: [{ type: 'text', text: 'New question' } as never] });

    const result = await coordinator.prepareMessagesBeforeSend({
      sessionId: 'session-1',
      messages,
      currentUserMessage
    });

    expect(result.modelMessages.length).toBeGreaterThan(0);
    // Should have compressed
    expect(result.compressed).toBe(true);
    // Should have created a summary
    expect(mockStorage.createSummary).toHaveBeenCalled();
  });

  it('falls back to original context on compression failure', async () => {
    const { createCompressionCoordinator } = await import('@/components/BChatSidebar/utils/compression/coordinator');
    const mockStorage = createMockStorage();
    // Make createSummary throw
    mockStorage.createSummary = vi.fn().mockRejectedValue(new Error('DB write failed'));

    const coordinator = createCompressionCoordinator(mockStorage);

    // Create enough messages to trigger compression
    const messages: Message[] = [];
    for (let i = 1; i <= 62; i += 1) {
      const role = i % 2 === 1 ? 'user' : 'assistant';
      messages.push(
        makeMsg({
          id: `m${i}`,
          role,
          content: `Message ${i} with extra text to exceed thresholds`,
          parts: [{ type: 'text', text: `Message ${i} with extra text to exceed thresholds` } as never]
        })
      );
    }
    const currentUserMessage = makeMsg({ id: 'current', role: 'user', content: 'New question', parts: [{ type: 'text', text: 'New question' } as never] });

    const result = await coordinator.prepareMessagesBeforeSend({
      sessionId: 'session-1',
      messages,
      currentUserMessage
    });

    // Should still return messages (fallback to original)
    expect(result.modelMessages.length).toBeGreaterThan(0);
    expect(result.compressed).toBe(false);
    const userMessages = result.modelMessages.filter((message) => message.role === 'user');
    const currentMessages = userMessages.filter((message) => message.content === 'New question');
    expect(currentMessages).toHaveLength(1);
  });

  it('maintains session-level lock to prevent concurrent compression', async () => {
    const { createCompressionCoordinator } = await import('@/components/BChatSidebar/utils/compression/coordinator');
    const mockStorage = createMockStorage();

    // Track the created summary so getValidSummary can return it
    let createdSummary: ConversationSummaryRecord | undefined;
    mockStorage.createSummary = vi.fn().mockImplementation((record) => {
      const summary: ConversationSummaryRecord = {
        ...record,
        id: 'new-summary',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      createdSummary = summary;
      return new Promise((resolve) => {
        setTimeout(() => resolve(summary), 100);
      });
    });
    mockStorage.getValidSummary = vi.fn().mockImplementation(() => {
      return Promise.resolve(createdSummary);
    });

    const coordinator = createCompressionCoordinator(mockStorage);

    // Create enough messages to trigger compression
    const messages: Message[] = [];
    for (let i = 1; i <= 62; i += 1) {
      const role = i % 2 === 1 ? 'user' : 'assistant';
      messages.push(
        makeMsg({
          id: `m${i}`,
          role,
          content: `Message ${i} lots of text to fill up the character threshold for compression triggers`,
          parts: [{ type: 'text', text: `Message ${i} lots of text to fill up the character threshold for compression triggers` } as never]
        })
      );
    }
    const currentUserMessage = makeMsg({ id: 'current', role: 'user', content: 'New question', parts: [{ type: 'text', text: 'New question' } as never] });

    // Send two concurrent requests
    const [result1, result2] = await Promise.all([
      coordinator.prepareMessagesBeforeSend({ sessionId: 'session-1', messages, currentUserMessage }),
      coordinator.prepareMessagesBeforeSend({
        sessionId: 'session-1',
        messages,
        currentUserMessage: makeMsg({ id: 'current2', role: 'user', content: 'Second', parts: [{ type: 'text', text: 'Second' } as never] })
      })
    ]);

    // Both should succeed
    expect(result1.modelMessages.length).toBeGreaterThan(0);
    expect(result2.modelMessages.length).toBeGreaterThan(0);
    // createSummary should only be called once (second call skips compression due to lock)
    expect(mockStorage.createSummary).toHaveBeenCalledTimes(1);
  });

  it('excludes current user message from compression', async () => {
    const { createCompressionCoordinator } = await import('@/components/BChatSidebar/utils/compression/coordinator');
    const mockStorage = createMockStorage();

    const coordinator = createCompressionCoordinator(mockStorage);

    // Create enough messages to trigger compression
    const messages: Message[] = [];
    for (let i = 1; i <= 62; i += 1) {
      const role = i % 2 === 1 ? 'user' : 'assistant';
      messages.push(
        makeMsg({
          id: `m${i}`,
          role,
          content: `Message ${i} with some extra padding to reach the compression threshold`,
          parts: [{ type: 'text', text: `Message ${i} with some extra padding to reach the compression threshold` } as never]
        })
      );
    }
    const currentUserMessage = makeMsg({
      id: 'current',
      role: 'user',
      content: 'Current question',
      parts: [{ type: 'text', text: 'Current question' } as never]
    });

    const result = await coordinator.prepareMessagesBeforeSend({
      sessionId: 'session-1',
      messages,
      currentUserMessage,
      excludeMessageIds: [currentUserMessage.id]
    });

    // Current user message should be the last message
    const lastMsg = result.modelMessages[result.modelMessages.length - 1];
    expect(lastMsg.role).toBe('user');
    if (typeof lastMsg.content === 'string') {
      expect(lastMsg.content).toContain('Current');
    }
  });

  it('compresses based on valid summary boundary', async () => {
    const { createCompressionCoordinator } = await import('@/components/BChatSidebar/utils/compression/coordinator');

    // Provide a valid summary that covers messages 1-30
    const existingSummary = makeSummary({
      id: 'existing-summary',
      coveredUntilMessageId: 'm30',
      sourceMessageIds: Array.from({ length: 30 }, (_, i) => `m${i + 1}`)
    });
    const mockStorage = createMockStorage(existingSummary);

    const coordinator = createCompressionCoordinator(mockStorage);

    // Create more messages (31-92) beyond the summary boundary to trigger new compression
    // Need at least 30 rounds (60 messages) after the summary to trigger compression
    const messages: Message[] = [];
    for (let i = 1; i <= 92; i += 1) {
      const role = i % 2 === 1 ? 'user' : 'assistant';
      messages.push(
        makeMsg({
          id: `m${i}`,
          role,
          content: `Message ${i} with additional text content to fill space`,
          parts: [{ type: 'text', text: `Message ${i} with additional text content to fill space` } as never]
        })
      );
    }
    const currentUserMessage = makeMsg({ id: 'current', role: 'user', content: 'New question', parts: [{ type: 'text', text: 'New question' } as never] });

    const result = await coordinator.prepareMessagesBeforeSend({
      sessionId: 'session-1',
      messages,
      currentUserMessage
    });

    expect(result.modelMessages.length).toBeGreaterThan(0);
    // Should have triggered compression of new messages (31-92, which is 31 rounds)
    expect(mockStorage.createSummary).toHaveBeenCalled();
  });

  it('keeps preserved messages once and includes recent raw messages after the summary boundary', async () => {
    const { createCompressionCoordinator } = await import('@/components/BChatSidebar/utils/compression/coordinator');
    const mockStorage = createMockStorage();

    const coordinator = createCompressionCoordinator(mockStorage);
    const messages: Message[] = [];

    for (let i = 1; i <= 62; i += 1) {
      const role = i % 2 === 1 ? 'user' : 'assistant';
      if (i === 49) {
        messages.push(
          makeMsg({
            id: 'm49',
            role: 'assistant',
            content: 'pending confirmation',
            parts: [
              { type: 'text', text: 'pending confirmation' } as never,
              { type: 'confirmation', title: 'Confirm deploy', confirmationStatus: 'pending' } as never
            ]
          })
        );
        continue;
      }

      const content = i >= 57 ? `Recent message ${i}` : `Message ${i} with extra padding to trigger compression`;
      messages.push(
        makeMsg({
          id: `m${i}`,
          role,
          content,
          parts: [{ type: 'text', text: content } as never]
        })
      );
    }

    const currentUserMessage = makeMsg({
      id: 'current',
      role: 'user',
      content: 'Current question',
      parts: [{ type: 'text', text: 'Current question' } as never]
    });

    const result = await coordinator.prepareMessagesBeforeSend({
      sessionId: 'session-1',
      messages,
      currentUserMessage,
      excludeMessageIds: [currentUserMessage.id]
    });

    const pendingConfirmationMessages = result.modelMessages.filter((message) => {
      if (typeof message.content === 'string') {
        return message.content.includes('pending confirmation');
      }
      if (Array.isArray(message.content)) {
        return message.content.some((part) => {
          return part.type === 'text' && part.text.includes('pending confirmation');
        });
      }
      return false;
    });
    expect(pendingConfirmationMessages).toHaveLength(1);

    const recentAssistant = result.modelMessages.find((message) => {
      if (message.role !== 'assistant') {
        return false;
      }
      if (typeof message.content === 'string') {
        return message.content === 'Recent message 58';
      }
      if (Array.isArray(message.content)) {
        return message.content.some((part) => part.type === 'text' && part.text === 'Recent message 58');
      }
      return false;
    });
    expect(recentAssistant).toBeDefined();
  });
});
