/**
 * @file deferred-tools.test.ts
 * @description ChatRuntime 延迟工具消息可见性边界测试。
 */
import type { RuntimeToolCallChunk } from '../../../../../../../electron/main/modules/chat/runtime/stream/types.mjs';
import type { ChatMessagePart, ChatMessageRecord, ChatMessageToolPart } from 'types/chat';
import { describe, expect, it } from 'vitest';
import { createPersistableAssistant, parseDeferredToolCall } from '../../../../../../../electron/main/modules/chat/runtime/stream/deferred-tools.mjs';

/** 带 Provider 元数据的测试工具片段。 */
interface ToolPartWithMetadata extends ChatMessageToolPart {
  /** Provider 工具调用元数据。 */
  providerMetadata?: unknown;
}

/**
 * 创建文本片段。
 * @param text - 文本内容
 * @returns 文本消息片段
 */
function textPart(text: string): ChatMessagePart {
  return { id: `text-${text}`, type: 'text', text };
}

/**
 * 创建工具片段。
 * @param toolCallId - 工具调用 ID
 * @param status - 工具生命周期状态
 * @param providerMetadata - Provider 元数据
 * @returns 工具消息片段
 */
function toolPart(toolCallId: string, status: ChatMessageToolPart['status'], providerMetadata?: unknown): ToolPartWithMetadata {
  return {
    id: `tool-${toolCallId}`,
    type: 'tool',
    toolCallId,
    toolName: toolCallId.startsWith('deferred') ? 'delegate_task' : 'read_file',
    status,
    input: status === 'inputting' ? null : { task: toolCallId },
    inputText: status === 'inputting' ? '{"task":"' : undefined,
    ...(providerMetadata === undefined ? {} : { providerMetadata })
  };
}

/**
 * 创建 assistant 工作消息。
 * @param parts - 工作消息片段
 * @returns assistant 消息
 */
function assistantWithParts(parts: ChatMessagePart[]): ChatMessageRecord {
  return {
    id: 'assistant-1',
    sessionId: 'session-1',
    role: 'assistant',
    content: 'analysis',
    parts,
    createdAt: '2026-07-23T00:00:00.000Z',
    loading: true,
    finished: false
  };
}

describe('deferred tool persistence boundary', (): void => {
  it.each([
    ['unexposed registry deferred tool', 'delegate_task', []],
    ['exposed non-deferred tool', 'read_file', ['read_file']]
  ])('rejects parsing a call that is not an exposed deferred tool: %s', (_label: string, toolName: string, exposedNames: string[]): void => {
    const chunk: RuntimeToolCallChunk = {
      type: 'tool-call',
      toolCallId: 'tool-call-1',
      toolName,
      input: {
        task: '浏览上下文',
        acceptanceCriteria: ['返回摘要'],
        mode: 'read',
        resources: [{ kind: 'file', reference: 'CONTEXT.md' }],
        requestedTools: ['read_file'],
        required: true,
        priority: 'normal'
      }
    };

    const result = parseDeferredToolCall(chunk, new Set(exposedNames));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'protocol_error',
        details: { reason: 'deferred_tool_not_exposed', toolName }
      }
    });
  });

  it('keeps deferred input private without mutating the working assistant', (): void => {
    const working = assistantWithParts([textPart('analysis'), toolPart('deferred-1', 'executing')]);
    const original = structuredClone(working);

    const persisted = createPersistableAssistant(working, new Set(['deferred-1']));

    expect(persisted.parts).toEqual([textPart('analysis')]);
    expect(working).toEqual(original);
    expect(persisted).not.toBe(working);
    expect(persisted.parts).not.toBe(working.parts);
  });

  it('filters input-streaming deferred parts and multiple deferred IDs only', (): void => {
    const directMetadata = { anthropic: { signature: 'provider-signature' } };
    const working = assistantWithParts([
      toolPart('deferred-1', 'inputting'),
      textPart('analysis'),
      toolPart('direct-1', 'executing', directMetadata),
      toolPart('deferred-2', 'executing')
    ]);

    const persisted = createPersistableAssistant(working, new Set(['deferred-1', 'deferred-2']));
    const directPart = persisted.parts.find((part): part is ChatMessageToolPart => part.type === 'tool');

    expect(persisted.parts).toHaveLength(2);
    expect(persisted.parts.map((part): string => part.type)).toEqual(['text', 'tool']);
    expect((directPart as ToolPartWithMetadata).providerMetadata).toEqual(directMetadata);
    expect((directPart as ToolPartWithMetadata).providerMetadata).not.toBe(directMetadata);
    expect(working.parts).toHaveLength(4);
  });

  it('returns an immutable clone when no deferred ID matches', (): void => {
    const working = assistantWithParts([textPart('analysis'), toolPart('direct-1', 'executing')]);

    const persisted = createPersistableAssistant(working, new Set(['missing-call']));

    expect(persisted).toEqual(working);
    expect(persisted).not.toBe(working);
    expect(persisted.parts).not.toBe(working.parts);
    expect(persisted.parts[1]).not.toBe(working.parts[1]);
  });
});
