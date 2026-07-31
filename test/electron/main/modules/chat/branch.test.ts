/**
 * @file branch.test.ts
 * @description 聊天会话分支数据重建测试。
 */
import type {
  ChatMessageCompactionPart,
  ChatMessageRecord,
  ChatSession,
  CompactionBudgetSnapshot,
  CompactionModelSnapshot,
  StructuredContextSummary
} from 'types/chat';
import { describe, expect, it } from 'vitest';
import { createBranchTitle, createSessionBranchData } from '../../../../../electron/main/modules/chat/runtime/branch.mts';
import { buildSourceFingerprint, createFingerprintInput } from '../../../../../electron/main/modules/chat/runtime/compaction/fingerprint.mts';
import { validatePartTopology } from '../../../../../electron/main/modules/chat/runtime/compaction/topology.mts';

/**
 * 创建顺序可预测的测试 ID 工厂。
 * @returns 每次调用生成递增 ID 的函数
 */
function createIdFactory(): () => string {
  let index = 0;

  return (): string => {
    index += 1;
    return `branch-id-${index}`;
  };
}

/**
 * 创建测试源会话。
 * @returns 标题固定的助手会话
 */
function createSourceSession(): ChatSession {
  return {
    id: 'session-source',
    type: 'assistant',
    title: '原始标题',
    createdAt: '2026-07-14T08:00:00.000Z',
    updatedAt: '2026-07-14T08:00:00.000Z',
    lastMessageAt: '2026-07-14T08:04:00.000Z',
    metadata: { model: { providerId: 'provider-branch', modelId: 'model-branch' }, workspaceRoot: '/private/tmp/branch-project' }
  };
}

/**
 * 创建一条测试消息。
 * @param id - 消息 ID
 * @param role - 消息角色
 * @param content - 消息内容
 * @param createdAt - 创建时间
 * @returns 完整聊天消息记录
 */
function createMessage(id: string, role: 'user' | 'assistant', content: string, createdAt: string): ChatMessageRecord {
  return {
    id,
    sessionId: 'session-source',
    role,
    content,
    parts: [{ id: `part-${id}`, type: 'text', text: content }],
    createdAt,
    loading: false,
    finished: true,
    agentId: 'primary',
    runtimeId: `runtime-${id}`,
    parentRuntimeId: 'runtime-parent'
  };
}

/** 分支指纹测试使用的模型快照。 */
const MODEL_SNAPSHOT: CompactionModelSnapshot = {
  providerType: 'openai',
  providerId: 'provider-branch',
  modelId: 'model-branch',
  contextWindow: 20_000
};

/** 分支指纹测试使用的预算快照。 */
const BUDGET_SNAPSHOT: CompactionBudgetSnapshot = {
  outputReserve: 2_000,
  safetyReserve: 1_000,
  usableInputTokens: 17_000,
  triggerTokens: 13_600,
  targetTokens: 9_350,
  summaryMaxTokens: 2_000,
  rawTailMaxTokens: 4_000
};

/**
 * 创建包含稳定业务 identity 的结构化摘要。
 * @param sourcePartIds - 摘要证据 Part
 * @returns 结构化摘要
 */
function createSummary(sourcePartIds: string[]): StructuredContextSummary {
  return {
    schemaVersion: 1,
    objectives: [],
    facts: [{ id: 'fact-stable', type: 'decision', content: '保留分支 checkpoint', sourcePartIds }],
    artifacts: [
      {
        id: 'artifact-stable',
        path: 'src/a.ts',
        purpose: '入口文件',
        status: 'modified',
        keyChanges: ['增加分支'],
        shouldReload: false,
        sourcePartIds
      }
    ],
    completedActions: [],
    pendingActions: [],
    openQuestions: [],
    failures: []
  };
}

/**
 * 创建成功 checkpoint。
 * @param id - checkpoint ID
 * @param boundaryPartId - boundary Part ID
 * @param sourcePartIds - 摘要证据 ID
 * @param parentCheckpointId - 父 checkpoint ID
 * @returns 成功 checkpoint
 */
function createCheckpoint(id: string, boundaryPartId: string, sourcePartIds: string[], parentCheckpointId?: string): ChatMessageCompactionPart {
  return {
    id,
    type: 'compaction',
    status: 'success',
    trigger: 'automatic',
    boundaryPartId,
    parentCheckpointId,
    sourceFingerprint: `sha256:source-${id}`,
    modelSnapshot: structuredClone(MODEL_SNAPSHOT),
    budgetSnapshot: structuredClone(BUDGET_SNAPSHOT),
    summary: createSummary(sourcePartIds),
    createdAt: 1,
    completedAt: 2
  };
}

describe('createSessionBranchData', (): void => {
  it.each([
    ['原始标题', '原始标题（2）'],
    ['原始标题（2）', '原始标题（3）'],
    ['方案（草稿）', '方案（草稿）（2）']
  ])('creates the next branch title from %s', (sourceTitle: string, expectedTitle: string): void => {
    expect(createBranchTitle(sourceTitle)).toBe(expectedTitle);
  });

  it('rejects generated IDs that collide with source branch data', (): void => {
    const sourceMessages = [
      createMessage('user-1', 'user', '问题一', '2026-07-14T08:01:00.000Z'),
      createMessage('assistant-1', 'assistant', '回答一', '2026-07-14T08:02:00.000Z')
    ];

    expect((): void => {
      createSessionBranchData({
        sourceSession: createSourceSession(),
        sourceMessages,
        targetMessageId: 'assistant-1',
        now: '2026-07-14T12:00:00.000Z',
        createId: (): string => 'session-source'
      });
    }).toThrow('会话分支 ID 冲突');
  });

  it('rejects targets that are not completed assistant messages with a user-facing error', (): void => {
    expect((): void => {
      createSessionBranchData({
        sourceSession: createSourceSession(),
        sourceMessages: [createMessage('user-1', 'user', '问题一', '2026-07-14T08:01:00.000Z')],
        targetMessageId: 'user-1',
        now: '2026-07-14T12:00:00.000Z',
        createId: createIdFactory()
      });
    }).toThrow('无法从该助手消息创建会话分支');
  });

  it('copies through the target assistant message into an independently titled session', (): void => {
    const sourceSession = createSourceSession();
    const sourceMessages = [
      createMessage('user-1', 'user', '问题一', '2026-07-14T08:01:00.000Z'),
      createMessage('assistant-1', 'assistant', '回答一', '2026-07-14T08:02:00.000Z'),
      createMessage('user-2', 'user', '问题二', '2026-07-14T08:03:00.000Z'),
      createMessage('assistant-2', 'assistant', '回答二', '2026-07-14T08:04:00.000Z')
    ];
    sourceMessages[0].files = [{ id: 'file-1', name: '说明.md', type: 'document', path: '/workspace/说明.md' }];
    sourceMessages[0].usage = { inputTokens: 2, outputTokens: 0, totalTokens: 2 };
    sourceMessages[1].usage = { inputTokens: 3, outputTokens: 5, totalTokens: 8 };
    const sourceSnapshot = structuredClone(sourceMessages);

    const result = createSessionBranchData({
      sourceSession,
      sourceMessages,
      targetMessageId: 'assistant-1',
      now: '2026-07-14T12:00:00.000Z',
      createId: createIdFactory()
    });

    expect(result.session).toMatchObject({
      id: 'branch-id-1',
      type: 'assistant',
      title: '原始标题（2）',
      createdAt: '2026-07-14T12:00:00.000Z',
      updatedAt: '2026-07-14T12:00:00.000Z',
      lastMessageAt: '2026-07-14T12:00:00.000Z',
      usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 }
    });
    expect(result.session.metadata).toEqual({
      model: { providerId: 'provider-branch', modelId: 'model-branch' },
      workspaceRoot: '/private/tmp/branch-project'
    });
    expect(result.session.metadata).not.toBe(sourceSession.metadata);
    expect(result.messages.map((message: ChatMessageRecord): string => message.content)).toEqual(['问题一', '回答一']);
    expect(result.messages.every((message: ChatMessageRecord): boolean => message.sessionId === result.session.id)).toBe(true);
    expect(result.messages.map((message: ChatMessageRecord): string => message.id)).not.toContain('user-1');
    expect(result.messages.map((message: ChatMessageRecord): string => message.id)).not.toContain('assistant-1');
    expect(result.messages.flatMap((message: ChatMessageRecord): string[] => message.parts.map((part): string => part.id ?? ''))).not.toContain('part-user-1');
    expect(result.messages.every((message: ChatMessageRecord): boolean => message.runtimeId === undefined && message.parentRuntimeId === undefined)).toBe(true);
    expect(result.messages[0].files).toEqual(sourceMessages[0].files);
    expect(sourceMessages).toEqual(sourceSnapshot);
  });

  it('rewrites checkpoint references and recomputes fingerprints from branched identities', (): void => {
    const sourceMessages = [
      createMessage('user-1', 'user', '问题一', '2026-07-14T08:01:00.000Z'),
      createMessage('assistant-1', 'assistant', '回答一', '2026-07-14T08:02:00.000Z'),
      createMessage('user-2', 'user', '问题二', '2026-07-14T08:03:00.000Z'),
      createMessage('assistant-2', 'assistant', '回答二', '2026-07-14T08:04:00.000Z')
    ];
    const firstSourceIds = [sourceMessages[0].parts[0].id, sourceMessages[1].parts[0].id];
    const firstCheckpoint = createCheckpoint('checkpoint-1', sourceMessages[1].parts[0].id, firstSourceIds);
    sourceMessages[1].parts.push(firstCheckpoint);
    const secondSourceIds = [sourceMessages[2].parts[0].id, sourceMessages[3].parts[0].id];
    const secondCheckpoint = createCheckpoint('checkpoint-2', sourceMessages[3].parts[0].id, secondSourceIds, firstCheckpoint.id);
    sourceMessages[3].parts.push(secondCheckpoint);

    const result = createSessionBranchData({
      sourceSession: createSourceSession(),
      sourceMessages,
      targetMessageId: 'assistant-2',
      now: '2026-07-14T12:00:00.000Z',
      createId: createIdFactory()
    });
    const partIdMap = new Map<string, string>();
    sourceMessages.forEach((sourceMessage: ChatMessageRecord, messageIndex: number): void => {
      sourceMessage.parts.forEach((sourcePart, partIndex: number): void => {
        partIdMap.set(sourcePart.id, result.messages[messageIndex].parts[partIndex].id);
      });
    });
    const branchedFirst = result.messages[1].parts[1] as ChatMessageCompactionPart;
    const branchedSecond = result.messages[3].parts[1] as ChatMessageCompactionPart;

    expect(branchedFirst.boundaryPartId).toBe(partIdMap.get(firstCheckpoint.boundaryPartId as string));
    expect(branchedSecond.parentCheckpointId).toBe(partIdMap.get(firstCheckpoint.id));
    expect(branchedSecond.boundaryPartId).toBe(partIdMap.get(secondCheckpoint.boundaryPartId as string));
    expect(branchedFirst.summary?.facts[0]).toMatchObject({
      id: 'fact-stable',
      sourcePartIds: firstSourceIds.map((id): string => partIdMap.get(id) as string)
    });
    expect(branchedFirst.summary?.artifacts[0]).toMatchObject({
      id: 'artifact-stable',
      sourcePartIds: firstSourceIds.map((id): string => partIdMap.get(id) as string)
    });
    const expectedFingerprint = buildSourceFingerprint(
      createFingerprintInput({
        modelSnapshot: MODEL_SNAPSHOT,
        budgetSnapshot: BUDGET_SNAPSHOT,
        boundaryPartId: branchedFirst.boundaryPartId as string,
        sources: [
          { messageId: result.messages[0].id, part: result.messages[0].parts[0] },
          { messageId: result.messages[1].id, part: result.messages[1].parts[0] }
        ]
      })
    );
    expect(branchedFirst.sourceFingerprint).toBe(expectedFingerprint);
    expect(branchedFirst.sourceFingerprint).not.toBe(firstCheckpoint.sourceFingerprint);
    expect(validatePartTopology(result.messages).validCheckpointIds).toEqual(new Set([branchedFirst.id, branchedSecond.id]));
  });

  it('removes invalid checkpoints and every descendant without dropping normal messages', (): void => {
    const sourceMessages = [
      createMessage('user-1', 'user', '问题一', '2026-07-14T08:01:00.000Z'),
      createMessage('assistant-1', 'assistant', '回答一', '2026-07-14T08:02:00.000Z'),
      createMessage('user-2', 'user', '问题二', '2026-07-14T08:03:00.000Z'),
      createMessage('assistant-2', 'assistant', '回答二', '2026-07-14T08:04:00.000Z')
    ];
    sourceMessages[1].parts.push(createCheckpoint('checkpoint-invalid', sourceMessages[1].parts[0].id, ['missing-evidence']));
    sourceMessages[3].parts.push(createCheckpoint('checkpoint-child', sourceMessages[3].parts[0].id, [sourceMessages[3].parts[0].id], 'checkpoint-invalid'));

    const result = createSessionBranchData({
      sourceSession: createSourceSession(),
      sourceMessages,
      targetMessageId: 'assistant-2',
      now: '2026-07-14T12:00:00.000Z',
      createId: createIdFactory()
    });

    expect(result.messages).toHaveLength(4);
    expect(result.messages.map((message: ChatMessageRecord): string => message.content)).toEqual(['问题一', '回答一', '问题二', '回答二']);
    expect(result.messages.flatMap((message: ChatMessageRecord) => message.parts).some((part): boolean => part.type === 'compaction')).toBe(false);
  });
});
