/**
 * @file chat-summaries.test.ts
 * @description 验证聊天摘要存储在 localStorage 降级路径下返回最新有效摘要。
 */
import { describe, expect, it, vi } from 'vitest';

/**
 * @vitest-environment jsdom
 */

const dbSelectMock = vi.fn();
const dbExecuteMock = vi.fn();
const isDatabaseAvailableMock = vi.fn(() => false);

vi.mock('@/shared/storage/utils', () => ({
  dbSelect: dbSelectMock,
  dbExecute: dbExecuteMock,
  isDatabaseAvailable: isDatabaseAvailableMock,
  parseJson: JSON.parse,
  stringifyJson: JSON.stringify
}));

describe('chat summaries storage fallback', () => {
  it('returns the latest valid summary from local storage fallback', async () => {
    localStorage.clear();
    const { chatSummariesStorage } = await import('@/shared/storage/chat-summaries');

    const firstSummary = await chatSummariesStorage.createSummary({
      sessionId: 'session-1',
      buildMode: 'incremental',
      coveredStartMessageId: 'm1',
      coveredEndMessageId: 'm10',
      coveredUntilMessageId: 'm10',
      sourceMessageIds: ['m1'],
      preservedMessageIds: [],
      summaryText: 'first summary',
      structuredSummary: {
        goal: 'goal 1',
        recentTopic: 'topic 1',
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
      charCountSnapshot: 1000,
      schemaVersion: 1,
      status: 'valid',
      invalidReason: undefined
    });

    await chatSummariesStorage.updateSummaryStatus(firstSummary.id, 'superseded');

    const latestSummary = await chatSummariesStorage.createSummary({
      sessionId: 'session-1',
      buildMode: 'incremental',
      coveredStartMessageId: 'm11',
      coveredEndMessageId: 'm20',
      coveredUntilMessageId: 'm20',
      sourceMessageIds: ['m11'],
      preservedMessageIds: [],
      summaryText: 'latest summary',
      structuredSummary: {
        goal: 'goal 2',
        recentTopic: 'topic 2',
        userPreferences: [],
        constraints: [],
        decisions: [],
        importantFacts: [],
        fileContext: [],
        openQuestions: [],
        pendingActions: []
      },
      triggerReason: 'manual',
      messageCountSnapshot: 20,
      charCountSnapshot: 2000,
      schemaVersion: 1,
      status: 'valid',
      invalidReason: undefined
    });

    const summary = await chatSummariesStorage.getValidSummary('session-1');
    expect(summary?.id).toBe(latestSummary.id);
    expect(summary?.summaryText).toBe('latest summary');
  });
});
