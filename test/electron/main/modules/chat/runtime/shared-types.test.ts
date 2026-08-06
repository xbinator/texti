import type { AIToolExecutionError } from 'types/ai';
import type { ChatMessageCompactionPart, ChatMessageFilePart, ChatMessageFilePartInput, ChatMessagePart, ChatMessageToolPart } from 'types/chat';
import type {
  ChatRuntimeAddress,
  ChatRuntimeCompactInput,
  ChatRuntimeControlToolInput,
  ChatRuntimeRecoverySnapshot,
  ChatRuntimeSendInput,
  ChatRuntimeSubmitToolActivityInput,
  ChatRuntimeSubmitUserChoiceInput
} from 'types/chat-runtime';
import { describe, expect, it } from 'vitest';

describe('chat runtime shared types', (): void => {
  it('keeps tool activity and control payloads cloneable', (): void => {
    const progress = {
      phase: 'scan',
      completed: 3,
      total: 10,
      message: '已扫描 3 个目录'
    };
    const progressInput: ChatRuntimeSubmitToolActivityInput = {
      runtimeId: 'runtime-1',
      toolCallId: 'tool-1',
      sequence: 2,
      occurredAt: 1_000,
      activity: {
        kind: 'progress',
        progress
      }
    };
    const stopInput: ChatRuntimeControlToolInput = {
      runtimeId: 'runtime-1',
      toolCallId: 'tool-1',
      action: 'stop'
    };
    const toolPart: ChatMessageToolPart = {
      id: 'part-tool-1',
      type: 'tool',
      toolCallId: 'tool-1',
      toolName: 'search_files',
      status: 'executing',
      input: {},
      activity: {
        state: 'executing',
        sequence: 2,
        lastProgressAt: 1_000,
        progress: { ...progress, updatedAt: 1_000 }
      }
    };
    const stableErrorCodes: AIToolExecutionError['code'][] = ['TOOL_UNRESPONSIVE', 'EXTERNAL_WAIT_TIMEOUT', 'USER_CANCELLED', 'RUNTIME_INTERRUPTED'];

    expect(structuredClone({ progressInput, stopInput, toolPart })).toEqual({ progressInput, stopInput, toolPart });
    expect(stableErrorCodes).toHaveLength(4);
  });

  it('requires a complete external wait deadline', (): void => {
    const input: ChatRuntimeSubmitToolActivityInput = {
      runtimeId: 'runtime-1',
      toolCallId: 'tool-1',
      sequence: 3,
      occurredAt: 2_000,
      activity: {
        kind: 'waiting_external',
        // @ts-expect-error External waits must always include retryAt and deadlineAt.
        wait: { reason: '等待限流解除' }
      }
    };

    expect(input.activity.kind).toBe('waiting_external');
  });

  it('accepts input file parts without snapshots and persisted file parts with snapshots', (): void => {
    const inputPart: ChatMessageFilePartInput = {
      type: 'file',
      id: 'file-part-1',
      filename: 'foo.ts',
      mime: 'text/plain',
      url: 'file:///workspace/src/foo.ts?start=10&end=20',
      path: 'src/foo.ts',
      sourceText: { start: 4, end: 25, value: '{{@src/foo.ts#L10-20}}' }
    };

    const persistedPart: ChatMessageFilePart = {
      ...inputPart,
      snapshot: {
        content: 'export const foo = 1;',
        startLine: 10,
        endLine: 20,
        totalLines: 100,
        contentHash: 'hash-1',
        capturedAt: '2026-06-20T00:00:00.000Z'
      }
    };

    const messagePart: ChatMessagePart = persistedPart;
    const sendInput: Pick<ChatRuntimeSendInput, 'parts'> = { parts: [{ id: 'part0122', type: 'text', text: 'fix ' }, inputPart] };

    expect(messagePart.type).toBe('file');
    expect(sendInput.parts?.[1]?.type).toBe('file');
  });

  it('keeps runtime recovery snapshots cloneable and free of executable values', (): void => {
    const snapshot: ChatRuntimeRecoverySnapshot = {
      runtimeId: 'runtime-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: 'runtime-1',
      phase: 'streaming',
      createdAt: 1,
      capabilities: {
        rendererTools: [{ name: 'inspect_registered_page' }],
        toolContext: { providerId: 'editor', resourceId: 'document-1' }
      },
      pendingRequests: [
        {
          type: 'confirmation',
          event: {
            runtimeId: 'runtime-1',
            sessionId: 'session-1',
            turnId: 'turn-1',
            clientId: 'bchat',
            agentId: 'primary',
            rootRuntimeId: 'runtime-1',
            confirmationId: 'confirmation-1',
            request: {
              toolName: 'write_file',
              title: '写入文件',
              description: '是否写入？',
              riskLevel: 'write'
            }
          }
        }
      ]
    };

    expect(structuredClone(snapshot)).toEqual(snapshot);
  });

  it('keeps compaction commands and parts cloneable', (): void => {
    const input: ChatRuntimeCompactInput = {
      runtimeId: 'runtime-compact',
      sessionId: 'session-1',
      turnId: 'turn-compact',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: 'runtime-compact',
      contextWindow: 128_000
    };
    const part: ChatMessageCompactionPart = {
      id: 'checkpoint-pending',
      type: 'compaction',
      status: 'pending',
      trigger: 'manual',
      createdAt: 1
    };
    const snapshot: ChatRuntimeRecoverySnapshot = {
      runtimeId: input.runtimeId,
      sessionId: input.sessionId,
      turnId: 'turn-compact',
      clientId: input.clientId,
      agentId: input.agentId,
      rootRuntimeId: input.runtimeId,
      phase: 'compacting',
      createdAt: 1,
      pendingRequests: []
    };

    expect(structuredClone({ input, part, snapshot })).toEqual({ input, part, snapshot });
  });

  it('shares one complete runtime address across commands and renderer routes', (): void => {
    const address: ChatRuntimeAddress = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      agentId: 'primary',
      runtimeId: 'runtime-b',
      parentAgentId: 'coordinator',
      parentRuntimeId: 'runtime-a',
      rootRuntimeId: 'runtime-a',
      continuationOfRuntimeId: 'runtime-a'
    };
    const sendInput: ChatRuntimeSendInput = {
      ...address,
      clientId: 'bchat',
      content: 'continue'
    };

    expect(structuredClone({ address, sendInput })).toEqual({ address, sendInput });
  });

  it('requires compact and user-choice commands to satisfy the complete runtime address', (): void => {
    const compactInput: ChatRuntimeCompactInput = {
      runtimeId: 'runtime-compact',
      sessionId: 'session-1',
      turnId: 'turn-1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: 'runtime-a'
    };
    const choiceInput: ChatRuntimeSubmitUserChoiceInput = {
      runtimeId: 'runtime-choice',
      sessionId: 'session-1',
      turnId: 'turn-1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: 'runtime-a',
      continuationOfRuntimeId: 'runtime-a',
      answer: { questionId: 'question-1', toolCallId: 'tool-1', answers: ['yes'] }
    };
    const addresses: ChatRuntimeAddress[] = [compactInput, choiceInput];

    expect(addresses.map((address) => address.rootRuntimeId)).toEqual(['runtime-a', 'runtime-a']);
  });
});
