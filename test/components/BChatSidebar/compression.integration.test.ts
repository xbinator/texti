/**
 * @file compression.integration.test.ts
 * @description 压缩功能集成测试：测试完整的压缩流程和 UI 交互。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ConversationSummaryRecord } from '@/components/BChatSidebar/utils/compression/types';
import type { Message } from '@/components/BChatSidebar/utils/types';

/**
 * @vitest-environment jsdom
 */

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] || null)
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock
});

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
  }),
  hasElectronAPI: vi.fn().mockReturnValue(false)
}));

/**
 * 创建测试用消息
 */
function createTestMessage(id: string, role: 'user' | 'assistant', content: string): Message {
  return {
    id,
    role,
    content,
    parts: [{ type: 'text', text: content }],
    createdAt: new Date().toISOString(),
    loading: false
  };
}

/**
 * 创建测试用摘要记录
 */
function createTestSummary(overrides: Partial<ConversationSummaryRecord> = {}): ConversationSummaryRecord {
  return {
    id: 'summary-1',
    sessionId: 'session-1',
    buildMode: 'incremental',
    coveredStartMessageId: 'm1',
    coveredEndMessageId: 'm30',
    coveredUntilMessageId: 'm30',
    sourceMessageIds: Array.from({ length: 30 }, (_, i) => `m${i + 1}`),
    preservedMessageIds: [],
    summaryText: 'Test summary text.',
    structuredSummary: {
      goal: 'Test goal',
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
    messageCountSnapshot: 30,
    charCountSnapshot: 50000,
    schemaVersion: 1,
    status: 'valid',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe('Compression Integration', () => {
  describe('useCompression hook', () => {
    it('provides compression state and methods', async () => {
      const { useCompression } = await import('@/components/BChatSidebar/hooks/useCompression');

      const messages = [createTestMessage('m1', 'user', 'Hello')];
      const compression = useCompression({
        getSessionId: () => 'session-1',
        getMessages: () => messages
      });

      expect(compression.compressing.value).toBe(false);
      expect(compression.currentSummary.value).toBeUndefined();
      expect(compression.error.value).toBeUndefined();
      expect(typeof compression.compress).toBe('function');
      expect(typeof compression.loadSummary).toBe('function');
      expect(typeof compression.clearError).toBe('function');
    });

    it('handles compression without session ID', async () => {
      const { useCompression } = await import('@/components/BChatSidebar/hooks/useCompression');

      const messages = [createTestMessage('m1', 'user', 'Hello')];
      const compression = useCompression({
        getSessionId: () => undefined,
        getMessages: () => messages
      });

      const success = await compression.compress();
      expect(success).toBe(false);
      expect(compression.error.value).toBe('没有活跃的会话');
    });

    it('handles compression with empty messages', async () => {
      const { useCompression } = await import('@/components/BChatSidebar/hooks/useCompression');

      const compression = useCompression({
        getSessionId: () => 'session-1',
        getMessages: () => []
      });

      const success = await compression.compress();
      expect(success).toBe(false);
      expect(compression.error.value).toBe('没有可压缩的消息');
    });

    it('supports manual compression even when the last message is from the assistant', async () => {
      const { useCompression } = await import('@/components/BChatSidebar/hooks/useCompression');

      const messages: Message[] = [];
      for (let i = 1; i <= 14; i += 1) {
        messages.push(createTestMessage(`m${i}`, i % 2 === 1 ? 'user' : 'assistant', `Message ${i}`));
      }

      const compression = useCompression({
        getSessionId: () => 'session-1',
        getMessages: () => messages
      });

      const success = await compression.compress();
      expect(success).toBe(true);
      expect(compression.currentSummary.value?.triggerReason).toBe('manual');
    });

    it('clears error correctly', async () => {
      const { useCompression } = await import('@/components/BChatSidebar/hooks/useCompression');

      const compression = useCompression({
        getSessionId: () => undefined,
        getMessages: () => []
      });

      await compression.compress();
      expect(compression.error.value).toBeDefined();

      compression.clearError();
      expect(compression.error.value).toBeUndefined();
    });
  });

  describe('SummaryModal component', () => {
    it('mounts correctly with summary', async () => {
      const { mount } = await import('@vue/test-utils');
      const SummaryModal = (await import('@/components/BChatSidebar/components/SummaryModal.vue')).default;

      const summary = createTestSummary();
      const wrapper = mount(SummaryModal, {
        props: {
          open: true,
          summary
        },
        global: {
          stubs: {
            BModal: {
              template: '<div class="b-modal"><slot /></div>',
              props: ['open', 'title', 'footer', 'width']
            }
          }
        }
      });

      expect(wrapper.exists()).toBe(true);
    });

    it('mounts correctly without summary', async () => {
      const { mount } = await import('@vue/test-utils');
      const SummaryModal = (await import('@/components/BChatSidebar/components/SummaryModal.vue')).default;

      const wrapper = mount(SummaryModal, {
        props: {
          open: true,
          summary: undefined
        },
        global: {
          stubs: {
            BModal: {
              template: '<div class="b-modal"><slot /></div>',
              props: ['open', 'title', 'footer', 'width']
            }
          }
        }
      });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('End-to-end compression flow', () => {
    it('handles compression coordinator initialization', async () => {
      const { createCompressionCoordinator } = await import('@/components/BChatSidebar/utils/compression/coordinator');
      const { chatSummariesStorage } = await import('@/shared/storage/chat-summaries');

      const coordinator = createCompressionCoordinator(chatSummariesStorage);
      expect(coordinator).toBeDefined();
      expect(typeof coordinator.prepareMessagesBeforeSend).toBe('function');
    });

    it('prepares messages without compression when under threshold', async () => {
      const { createCompressionCoordinator } = await import('@/components/BChatSidebar/utils/compression/coordinator');
      const { chatSummariesStorage } = await import('@/shared/storage/chat-summaries');

      // Create only 10 messages (5 rounds)
      const messages: Message[] = [];
      for (let i = 0; i < 10; i++) {
        const role = i % 2 === 0 ? 'user' : 'assistant';
        messages.push(createTestMessage(`m${i + 1}`, role, `Message ${i + 1}`));
      }

      const coordinator = createCompressionCoordinator(chatSummariesStorage);
      const result = await coordinator.prepareMessagesBeforeSend({
        sessionId: 'session-1',
        messages,
        currentUserMessage: messages[messages.length - 1]
      });

      // Should not compress because under threshold
      expect(result.compressed).toBe(false);
      // Model messages may include system message, so just check it's greater than 0
      expect(result.modelMessages.length).toBeGreaterThan(0);
    });

    it('degrades manual full rebuild to incremental when trim input exceeds the hard limit', async () => {
      const { createCompressionCoordinator } = await import('@/components/BChatSidebar/utils/compression/coordinator');
      const { chatSummariesStorage } = await import('@/shared/storage/chat-summaries');

      const coordinator = createCompressionCoordinator(chatSummariesStorage);

      // 创建大量超长消息，确保 ruleTrim 超过 COMPRESSION_INPUT_CHAR_LIMIT (32,000)
      // 注意：每条消息内容需不同，否则 ruleTrim 的去重逻辑会合并连续相同内容
      const messages: Message[] = [];
      for (let i = 1; i <= 200; i += 1) {
        const role = i % 2 === 1 ? 'user' : 'assistant';
        messages.push(createTestMessage(`m${i}`, role, `Message ${i} `.padEnd(1000, 'X')));
      }

      const summary = await coordinator.compressSessionManually({
        sessionId: 'session-1',
        messages
      });

      // 手动压缩降级时 buildMode 仍为 full_rebuild（用户意图），通过 degradeReason 标记执行层降级
      expect(summary?.buildMode).toBe('full_rebuild');
      expect(summary?.degradeReason).toBe('degraded_to_incremental');
    });
  });
});
