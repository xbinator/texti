/**
 * @file renderer-tool-output.test.ts
 * @description 声明式 Renderer 工具历史投影测试。
 */
import type { ChatMessagePart, ChatMessageRecord, ChatMessageToolPart } from 'types/chat';
import type { ChatRendererToolDescriptor, ChatRendererToolHistoryPolicy } from 'types/chat-runtime';
import { describe, expect, it } from 'vitest';
import { projectRendererToolOutputs } from '../../../../../../electron/main/modules/chat/runtime/context/renderer-tool-output.mjs';

/**
 * 创建完成的 Renderer 工具 Part。
 * @param id - Part ID
 * @param data - 工具结果数据
 * @param history - 持久化历史策略
 * @returns 工具 Part
 */
function createToolPart(id: string, data: unknown, history?: ChatRendererToolHistoryPolicy): ChatMessageToolPart {
  return {
    id,
    type: 'tool',
    toolCallId: `call-${id}`,
    toolName: 'inspect_future_page',
    status: 'done',
    input: { payload: { visible: true, secret: 'TOKEN' }, steps: [{ secret: 'ARRAY_TOKEN', label: 'first' }] },
    ...(history ? { rendererHistory: history } : {}),
    result: { toolName: 'inspect_future_page', status: 'success', data }
  };
}

/**
 * 创建包含工具 Part 的消息。
 * @param id - 消息 ID
 * @param parts - 消息 Parts
 * @returns assistant 消息
 */
function createMessage(id: string, parts: ChatMessagePart[]): ChatMessageRecord {
  return {
    id,
    sessionId: 'session-1',
    role: 'assistant',
    content: '',
    parts,
    createdAt: '2026-08-05T00:00:00.000Z',
    loading: false,
    finished: true
  };
}

describe('renderer tool output projection', (): void => {
  it('keeps only the latest full result and redacts every projected input without mutating storage', (): void => {
    const history: ChatRendererToolHistoryPolicy = {
      mode: 'latest-only',
      placeholder: 'Previous observation omitted.',
      redactInputPaths: ['payload.secret', 'steps.0.secret']
    };
    const messages = [
      createMessage('assistant-1', [createToolPart('tool-1', { value: 'OLD_SENTINEL' }, history)]),
      createMessage('assistant-2', [createToolPart('tool-2', { value: 'CURRENT_SENTINEL' }, history)])
    ];
    const original = structuredClone(messages);

    const projected = projectRendererToolOutputs(messages);
    const oldPart = projected[0]?.parts[0];
    const currentPart = projected[1]?.parts[0];

    expect(messages).toEqual(original);
    expect(oldPart).toMatchObject({
      type: 'tool',
      result: {
        status: 'success',
        data: { pruned: true, pruneReason: 'renderer_history_latest_only', summary: 'Previous observation omitted.' }
      }
    });
    expect(currentPart).toMatchObject({ type: 'tool', result: { status: 'success', data: { value: 'CURRENT_SENTINEL' } } });
    if (oldPart?.type !== 'tool' || currentPart?.type !== 'tool') throw new Error('Expected projected tool parts');
    expect(oldPart.input).toEqual({ payload: { visible: true }, steps: [{ label: 'first' }] });
    expect(currentPart.input).toEqual({ payload: { visible: true }, steps: [{ label: 'first' }] });
    expect(JSON.stringify(projected)).not.toContain('OLD_SENTINEL');
  });

  it('keeps full results when the page declares keep mode', (): void => {
    const messages = [createMessage('assistant-1', [createToolPart('tool-1', { value: 'FULL_SENTINEL' }, { mode: 'keep' })])];

    expect(projectRendererToolOutputs(messages)).toEqual(messages);
  });

  it('uses a runtime descriptor for legacy parts that do not yet contain a policy snapshot', (): void => {
    const descriptors: ChatRendererToolDescriptor[] = [
      { name: 'inspect_future_page', history: { mode: 'latest-only', placeholder: 'Legacy observation omitted.' } }
    ];
    const messages = [
      createMessage('assistant-1', [createToolPart('tool-1', { value: 'LEGACY_OLD' })]),
      createMessage('assistant-2', [createToolPart('tool-2', { value: 'LEGACY_CURRENT' })])
    ];

    const serialized = JSON.stringify(projectRendererToolOutputs(messages, descriptors));

    expect(serialized).not.toContain('LEGACY_OLD');
    expect(serialized).toContain('Legacy observation omitted.');
    expect(serialized).toContain('LEGACY_CURRENT');
  });

  it('ignores unsafe redaction paths defensively', (): void => {
    const history = {
      mode: 'keep' as const,
      redactInputPaths: ['payload.constructor.token', 'payload.__proto__.token']
    };
    const messages = [createMessage('assistant-1', [createToolPart('tool-1', { value: 'safe' }, history)])];

    const projected = projectRendererToolOutputs(messages);
    const part = projected[0]?.parts[0];

    expect(part).toMatchObject({ type: 'tool', input: { payload: { visible: true, secret: 'TOKEN' } } });
    expect(Object.prototype).not.toHaveProperty('token');
  });
});
