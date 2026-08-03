/**
 * @file projector.test.ts
 * @description 上下文压缩模型投影测试。
 */
import type {
  ChatMessageCompactionPart,
  ChatMessagePart,
  ChatMessageRecord,
  ChatMessageToolPart,
  CompactionBudgetSnapshot,
  StructuredContextSummary
} from 'types/chat';
import { describe, expect, it } from 'vitest';
import { projectContext } from '../../../../../../../electron/main/modules/chat/runtime/compaction/projector.mjs';
import { estimateRequestTokens } from '../../../../../../../electron/main/modules/chat/runtime/compaction/token-estimator.mjs';

/**
 * 创建投影测试预算。
 * @returns 预算快照
 */
function createBudget(): CompactionBudgetSnapshot {
  return {
    outputReserve: 2_000,
    safetyReserve: 1_000,
    usableInputTokens: 17_000,
    triggerTokens: 13_600,
    targetTokens: 9_350,
    summaryMaxTokens: 2_000,
    rawTailMaxTokens: 4_000
  };
}

/**
 * 创建引用指定证据的结构化摘要。
 * @param sourcePartIds - 证据 Part 标识
 * @returns 结构化摘要
 */
function createSummary(sourcePartIds: string[]): StructuredContextSummary {
  return {
    schemaVersion: 1,
    objectives: [],
    facts: [
      {
        id: 'fact-1',
        type: 'decision',
        content: '使用结构化 checkpoint 继续长会话',
        sourcePartIds
      }
    ],
    artifacts: [],
    completedActions: [],
    pendingActions: [],
    openQuestions: [],
    failures: []
  };
}

/**
 * 创建成功 checkpoint。
 * @param id - checkpoint 标识
 * @param boundaryPartId - boundary 标识
 * @param sourcePartIds - 摘要证据标识
 * @returns 成功 checkpoint
 */
function createCheckpoint(id: string, boundaryPartId: string, sourcePartIds: string[]): ChatMessageCompactionPart {
  return {
    id,
    type: 'compaction',
    status: 'success',
    trigger: 'automatic',
    boundaryPartId,
    sourceFingerprint: `sha256:${id}`,
    modelSnapshot: {
      providerType: 'openai',
      providerId: 'provider-1',
      modelId: 'model-1',
      contextWindow: 20_000
    },
    budgetSnapshot: createBudget(),
    summary: createSummary(sourcePartIds),
    createdAt: 1,
    completedAt: 2
  };
}

/**
 * 创建已完成聊天消息。
 * @param id - 消息标识
 * @param role - 消息角色
 * @param parts - 消息 Part
 * @returns 聊天消息
 */
function createMessage(id: string, role: 'user' | 'assistant', parts: ChatMessagePart[]): ChatMessageRecord {
  return {
    id,
    sessionId: 'session-1',
    role,
    content: '',
    parts,
    createdAt: `2026-07-16T00:00:0${id.length}.000Z`,
    loading: false,
    finished: true
  };
}

/**
 * 创建成功网页读取 Part。
 * @param id - Part ID
 * @param snapshotId - 快照 ID
 * @returns 网页读取 Part
 */
function createWebviewReadPart(id: string, snapshotId: string): ChatMessageToolPart {
  return {
    id,
    type: 'tool',
    toolCallId: `call-${id}`,
    toolName: 'read_current_webpage',
    status: 'done',
    input: {},
    result: {
      toolName: 'read_current_webpage',
      status: 'success',
      data: {
        url: 'https://example.com',
        title: 'Example',
        summary: 'DOM_SENTINEL',
        header: 'Header',
        content: 'DOM_SENTINEL',
        footer: 'Footer',
        text: 'Visible text',
        selectedText: '',
        headings: [],
        links: [],
        capturedAt: 1,
        truncated: {},
        snapshotId
      }
    }
  };
}

/**
 * 创建成功网页操作 Part。
 * @param id - Part ID
 * @param snapshotId - 快照 ID
 * @returns 网页操作 Part
 */
function createWebviewOperatePart(id: string, snapshotId: string): ChatMessageToolPart {
  return {
    id,
    type: 'tool',
    toolCallId: `call-${id}`,
    toolName: 'operate_webpage',
    status: 'done',
    input: {
      snapshotId,
      step: { evaluation: '列表已更新', memory: '当前最低价格为 ¥820', nextGoal: '继续比较' },
      action: { type: 'click', index: 2 }
    },
    result: { toolName: 'operate_webpage', status: 'success', data: { ok: true } }
  };
}

describe('context projector', (): void => {
  it('只保留最新用户轮次中尚未消费的网页观察', (): void => {
    const messages = [
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '比较价格' }]),
      createMessage('assistant-1', 'assistant', [
        createWebviewReadPart('read-1', 'snapshot-1'),
        createWebviewOperatePart('operate-1', 'snapshot-1'),
        createWebviewReadPart('read-2', 'snapshot-2')
      ])
    ];
    const original = structuredClone(messages);

    const projection = projectContext({ messages });
    const serialized = JSON.stringify(projection.messages);

    expect(messages).toEqual(original);
    expect(serialized).toContain('snapshot-2');
    expect(serialized.match(/DOM_SENTINEL/gu)).toHaveLength(2);
  });

  it('网页操作后不再把已消费观察发送给模型', (): void => {
    const messages = [
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '继续' }]),
      createMessage('assistant-1', 'assistant', [createWebviewReadPart('read-1', 'snapshot-1'), createWebviewOperatePart('operate-1', 'snapshot-1')])
    ];
    const original = structuredClone(messages);

    const serialized = JSON.stringify(projectContext({ messages }).messages);

    expect(messages).toEqual(original);
    expect(serialized).not.toContain('DOM_SENTINEL');
    expect(serialized).not.toContain('snapshot-1');
    expect(serialized).toContain('当前最低价格为 ¥820');
  });

  it('新用户轮次不继承上一轮完整网页观察', (): void => {
    const messages = [
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '第一轮' }]),
      createMessage('assistant-1', 'assistant', [createWebviewReadPart('read-1', 'snapshot-1')]),
      createMessage('user-2', 'user', [{ id: 'user-part-2', type: 'text', text: '第二轮' }])
    ];
    const original = structuredClone(messages);

    const serialized = JSON.stringify(projectContext({ messages }).messages);

    expect(messages).toEqual(original);
    expect(serialized).not.toContain('DOM_SENTINEL');
  });

  it('按 WebView 裁剪后的消息估算请求 Token', (): void => {
    const largeReadPart = createWebviewReadPart('read-1', 'snapshot-1');
    if (largeReadPart.result?.status !== 'success') throw new Error('Expected a successful read fixture');
    const largeReadData = largeReadPart.result.data as Record<string, unknown>;
    largeReadData.summary = `DOM_SENTINEL${'x'.repeat(5_000)}`;
    largeReadData.content = `DOM_SENTINEL${'x'.repeat(5_000)}`;
    const messages = [
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '第一轮' }]),
      createMessage('assistant-1', 'assistant', [largeReadPart]),
      createMessage('user-2', 'user', [{ id: 'user-part-2', type: 'text', text: '第二轮' }])
    ];

    const projection = projectContext({ messages });

    expect(projection.estimatedTokens).toBe(estimateRequestTokens({ messages: projection.messages }));
    expect(projection.estimatedTokens).toBeLessThan(estimateRequestTokens({ messages }));
  });

  it('用最新有效摘要替换已覆盖前缀并保留 checkpoint 后原始 tail', (): void => {
    const messages = [
      createMessage('old-user', 'user', [{ id: 'source-1', type: 'text', text: '很早的需求' }]),
      createMessage('checkpoint-message', 'assistant', [
        createCheckpoint('checkpoint-1', 'source-1', ['source-1']),
        { id: 'tail-1', type: 'text', text: 'checkpoint 完成后的新进展' }
      ])
    ];

    const projection = projectContext({ messages });

    expect(projection.checkpointId).toBe('checkpoint-1');
    expect(projection.messages).toHaveLength(2);
    expect(projection.messages[0]).toMatchObject({
      id: 'context-checkpoint:checkpoint-1',
      role: 'assistant',
      parts: [{ type: 'text', text: expect.stringContaining('使用结构化 checkpoint 继续长会话') }]
    });
    expect(projection.messages[1].parts).toEqual([{ id: 'tail-1', type: 'text', text: 'checkpoint 完成后的新进展' }]);
    expect(JSON.stringify(projection.messages)).not.toContain('很早的需求');
    expect(projection.estimatedTokens).toBeGreaterThan(0);
  });

  it('boundary 与 checkpoint 同消息时保持 boundary 后的 Part 拓扑完整', (): void => {
    const boundaryTool: ChatMessagePart = {
      id: 'tool-boundary',
      type: 'tool',
      toolCallId: 'tool-call-boundary',
      toolName: 'read_file',
      status: 'done',
      input: { path: 'src/a.ts' },
      result: {
        toolName: 'read_file',
        status: 'success',
        data: { path: 'src/a.ts', content: 'export const value = 1' }
      }
    };
    const messages = [
      createMessage('inline-checkpoint', 'assistant', [
        boundaryTool,
        createCheckpoint('checkpoint-inline', 'tool-boundary', ['tool-boundary']),
        { id: 'tail-text', type: 'text', text: '继续修改文件' }
      ])
    ];

    const projection = projectContext({ messages });

    expect(projection.checkpointId).toBe('checkpoint-inline');
    expect(projection.messages[1]).toMatchObject({
      id: 'inline-checkpoint',
      parts: [{ id: 'tail-text', type: 'text', text: '继续修改文件' }]
    });
    expect(JSON.stringify(projection.messages)).not.toContain('tool-call-boundary');
  });

  it('最新 checkpoint 拓扑无效时回退到前一个有效 checkpoint', (): void => {
    const messages = [
      createMessage('message-1', 'assistant', [{ id: 'source-1', type: 'text', text: '第一阶段' }]),
      createMessage('message-2', 'assistant', [createCheckpoint('checkpoint-1', 'source-1', ['source-1'])]),
      createMessage('message-3', 'assistant', [
        { id: 'source-2', type: 'text', text: '第二阶段' },
        createCheckpoint('checkpoint-invalid', 'source-2', ['missing-evidence'])
      ])
    ];

    const projection = projectContext({ messages });

    expect(projection.checkpointId).toBe('checkpoint-1');
    expect(JSON.stringify(projection.messages)).toContain('第二阶段');
    expect(JSON.stringify(projection.messages)).not.toContain('checkpoint-invalid');
  });

  it('不把 pending 或失败状态 compaction 暴露给模型', (): void => {
    const messages = [
      createMessage('message-1', 'assistant', [
        { id: 'source-1', type: 'text', text: '保留内容' },
        { id: 'checkpoint-pending', type: 'compaction', status: 'pending', trigger: 'automatic', createdAt: 1 },
        { id: 'checkpoint-failed', type: 'compaction', status: 'failed', trigger: 'automatic', errorCode: 'MODEL_FAILED', createdAt: 1, completedAt: 2 }
      ])
    ];

    const projection = projectContext({ messages });

    expect(projection.checkpointId).toBeUndefined();
    expect(projection.messages[0].parts).toEqual([{ id: 'source-1', type: 'text', text: '保留内容' }]);
  });

  it('只在模型投影中软剪枝旧大型工具结果并保留 artifact identity', (): void => {
    const oldToolMessage = createMessage('old-tool', 'assistant', [
      {
        id: 'old-tool-part',
        type: 'tool',
        toolCallId: 'old-tool-call',
        toolName: 'read_file',
        status: 'done',
        input: { path: 'src/a.ts' },
        result: {
          toolName: 'read_file',
          status: 'success',
          data: {
            artifactId: 'artifact-1',
            path: 'src/a.ts',
            content: 'x'.repeat(5_000)
          }
        }
      }
    ]);
    const messages = [
      oldToolMessage,
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '继续' }]),
      createMessage('assistant-1', 'assistant', [{ id: 'assistant-part-1', type: 'text', text: '收到' }]),
      createMessage('user-2', 'user', [{ id: 'user-part-2', type: 'text', text: '再继续' }])
    ];
    const original = structuredClone(messages);

    const projection = projectContext({ messages });

    expect(messages).toEqual(original);
    expect(projection.messages[0].parts[0]).toMatchObject({
      type: 'tool',
      result: {
        data: {
          artifactId: 'artifact-1',
          path: 'src/a.ts',
          pruned: true
        }
      }
    });
    expect(JSON.stringify(projection.messages[0])).not.toContain('x'.repeat(5_000));
  });

  it('高压模式裁剪当前 Agent 轮次中较早的工具结果并保留最新结果', (): void => {
    const messages = [
      createMessage('current-user', 'user', [{ id: 'current-user-part', type: 'text', text: '继续执行长任务' }]),
      createMessage('current-assistant', 'assistant', [
        {
          id: 'current-tool-earlier',
          type: 'tool',
          toolCallId: 'current-tool-call-earlier',
          toolName: 'read_file',
          status: 'done',
          input: { path: 'src/large.ts' },
          result: {
            toolName: 'read_file',
            status: 'success',
            data: { artifactId: 'artifact-large', path: 'src/large.ts', content: 'x'.repeat(6_000) }
          }
        },
        {
          id: 'current-tool-latest',
          type: 'tool',
          toolCallId: 'current-tool-call-latest',
          toolName: 'read_file',
          status: 'done',
          input: { path: 'src/current.ts' },
          result: {
            toolName: 'read_file',
            status: 'success',
            data: { path: 'src/current.ts', content: 'y'.repeat(6_000) }
          }
        }
      ])
    ];
    const original = structuredClone(messages);

    const projection = projectContext({ messages, activeTurnToolPruneMode: 'preserve-latest' });

    expect(messages).toEqual(original);
    expect(projection.messages[1].parts[0]).toMatchObject({
      id: 'current-tool-earlier',
      type: 'tool',
      result: { data: { artifactId: 'artifact-large', path: 'src/large.ts', pruned: true } }
    });
    expect(projection.messages[1].parts[1]).toEqual(messages[1].parts[1]);
  });
});
