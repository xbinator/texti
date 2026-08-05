/**
 * @file tool-output-prune.test.ts
 * @description ChatRuntime 旧工具结果剪枝辅助函数测试。
 */
import type { ChatMessageRecord, ChatMessageToolPart } from 'types/chat';
import { describe, expect, it } from 'vitest';
import {
  findToolOutputPruneProtectedStartIndex,
  pruneActiveTurnToolOutputs,
  pruneMessageToolOutputs
} from '../../../../../../electron/main/modules/chat/runtime/context/tool-output-prune.mjs';

/**
 * 创建 assistant 工具消息。
 * @param toolPart - 工具片段
 * @returns assistant 消息
 */
function createAssistantToolMessage(toolPart: ChatMessageToolPart): ChatMessageRecord {
  return {
    id: 'assistant-1',
    sessionId: 'session-1',
    role: 'assistant',
    content: '',
    parts: [toolPart],
    createdAt: '2026-06-19T00:00:00.000Z',
    finished: true
  };
}

describe('tool output prune helpers', () => {
  it('prunes large successful tool result data while preserving summary fields and artifact identity', (): void => {
    const toolPart: ChatMessageToolPart = {
      id: 'part0127',
      type: 'tool',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      status: 'done',
      input: { path: 'large.md' },
      result: {
        toolName: 'read_file',
        status: 'success',
        data: {
          artifactId: 'artifact-1',
          path: 'large.md',
          content: 'x'.repeat(5_000)
        }
      }
    };
    const message = createAssistantToolMessage(toolPart);
    const original = structuredClone(message);

    const prunedMessage = pruneMessageToolOutputs(message);

    expect(message).toEqual(original);
    expect(prunedMessage?.parts[0]).toMatchObject({
      type: 'tool',
      result: {
        status: 'success',
        data: {
          artifactId: 'artifact-1',
          path: 'large.md',
          pruned: true,
          originalBytes: expect.any(Number)
        }
      }
    });
  });

  it('keeps user choice tool results unpruned', (): void => {
    const toolPart: ChatMessageToolPart = {
      id: 'part0128',
      type: 'tool',
      toolCallId: 'tool-call-1',
      toolName: 'ask_user_choice',
      status: 'done',
      input: { question: '继续吗？' },
      result: {
        toolName: 'ask_user_choice',
        status: 'success',
        data: { answer: 'x'.repeat(5_000) }
      }
    };
    const message = createAssistantToolMessage(toolPart);

    expect(pruneMessageToolOutputs(message)).toBeUndefined();
  });

  it('protects the latest two user turns from pruning', (): void => {
    const messages = [
      { id: 'user-1', role: 'user' },
      { id: 'assistant-1', role: 'assistant' },
      { id: 'user-2', role: 'user' },
      { id: 'assistant-2', role: 'assistant' },
      { id: 'user-3', role: 'user' },
      { id: 'assistant-3', role: 'assistant' }
    ] as ChatMessageRecord[];

    expect(findToolOutputPruneProtectedStartIndex(messages)).toBe(2);
  });

  it('prunes earlier large results in the active agent turn while preserving the latest result', (): void => {
    const messages: ChatMessageRecord[] = [
      {
        id: 'user-active',
        sessionId: 'session-1',
        role: 'user',
        content: '执行一个长任务',
        parts: [{ id: 'user-part-active', type: 'text', text: '执行一个长任务' }],
        createdAt: '2026-07-16T00:00:00.000Z',
        finished: true
      },
      {
        ...createAssistantToolMessage({
          id: 'tool-large-earlier',
          type: 'tool',
          toolCallId: 'tool-call-large-earlier',
          toolName: 'read_file',
          status: 'done',
          input: { path: 'src/large.ts' },
          result: {
            toolName: 'read_file',
            status: 'success',
            data: { artifactId: 'artifact-large', path: 'src/large.ts', content: 'x'.repeat(10_000) }
          }
        }),
        parts: [
          {
            id: 'tool-large-earlier',
            type: 'tool',
            toolCallId: 'tool-call-large-earlier',
            toolName: 'read_file',
            status: 'done',
            input: { path: 'src/large.ts' },
            result: {
              toolName: 'read_file',
              status: 'success',
              data: { artifactId: 'artifact-large', path: 'src/large.ts', content: 'x'.repeat(10_000) }
            }
          },
          {
            id: 'tool-latest',
            type: 'tool',
            toolCallId: 'tool-call-latest',
            toolName: 'read_file',
            status: 'done',
            input: { path: 'src/current.ts' },
            result: {
              toolName: 'read_file',
              status: 'success',
              data: { path: 'src/current.ts', content: 'y'.repeat(10_000) }
            }
          }
        ]
      }
    ];
    const original = structuredClone(messages);

    const pruned = pruneActiveTurnToolOutputs(messages);

    expect(messages).toEqual(original);
    expect(pruned[1].parts[0]).toMatchObject({
      id: 'tool-large-earlier',
      type: 'tool',
      result: { data: { artifactId: 'artifact-large', path: 'src/large.ts', pruned: true } }
    });
    expect(pruned[1].parts[1]).toEqual(messages[1].parts[1]);

    const fullyPruned = pruneActiveTurnToolOutputs(messages, 'all-complete');
    expect(fullyPruned[1].parts[1]).toMatchObject({
      id: 'tool-latest',
      type: 'tool',
      result: { data: { path: 'src/current.ts', pruned: true } }
    });
  });
});
