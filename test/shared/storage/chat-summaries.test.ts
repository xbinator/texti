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
  parseJson: (json: string | null) => {
    if (!json) return undefined;
    try { return JSON.parse(json); } catch { return undefined; }
  },
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

  it('ignores summaries with unsupported schema version', async () => {
    localStorage.clear();
    const { chatSummariesStorage } = await import('@/shared/storage/chat-summaries');

    // 种子摘要: schema_version=999, status=valid
    await chatSummariesStorage.createSummary({
      sessionId: 'session-1',
      buildMode: 'incremental',
      coveredStartMessageId: 'm1',
      coveredEndMessageId: 'm10',
      coveredUntilMessageId: 'm10',
      sourceMessageIds: ['m1'],
      preservedMessageIds: [],
      summaryText: 'bad schema summary',
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
      schemaVersion: 999,
      status: 'valid',
      invalidReason: undefined
    } as never);

    const summary = await chatSummariesStorage.getValidSummary('session-1');
    // 不支持的 schema version 应被过滤
    expect(summary).toBeUndefined();
  });

  it('marks malformed structured summaries invalid instead of fabricating empty data', async () => {
    // 模拟 SQLite 返回格式错误的行
    dbSelectMock.mockResolvedValue([{
      id: 'summary-1',
      session_id: 'session-1',
      build_mode: 'incremental',
      derived_from_summary_id: null,
      covered_start_message_id: 'm1',
      covered_end_message_id: 'm10',
      covered_until_message_id: 'm10',
      source_message_ids_json: '["m1"]',
      preserved_message_ids_json: '[]',
      summary_text: 'test',
      structured_summary_json: '{bad json}',
      trigger_reason: 'message_count',
      message_count_snapshot: 10,
      char_count_snapshot: 1000,
      schema_version: 1,
      status: 'valid',
      invalid_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }]);

    isDatabaseAvailableMock.mockReturnValue(true);

    const { chatSummariesStorage } = await import('@/shared/storage/chat-summaries');
    const summary = await chatSummariesStorage.getValidSummary('session-1');

    // 格式错误的摘要应返回 undefined
    expect(summary).toBeUndefined();
    // 应该调用 updateSummaryStatus 标记为 invalid
    expect(dbExecuteMock).toHaveBeenCalled();
  });
});
