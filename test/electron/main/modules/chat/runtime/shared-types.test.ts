import type { ChatMessageCompactionPart, ChatMessageFilePart, ChatMessageFilePartInput, ChatMessagePart } from 'types/chat';
import type {
  ChatRuntimeAddress,
  ChatRuntimeCompactInput,
  ChatRuntimeRecoverySnapshot,
  ChatRuntimeSendInput,
  ChatRuntimeSubmitUserChoiceInput
} from 'types/chat-runtime';
import { describe, expect, it } from 'vitest';

describe('chat runtime shared types', (): void => {
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
        rendererToolNames: ['read_current_document'],
        documentId: 'document-1'
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
