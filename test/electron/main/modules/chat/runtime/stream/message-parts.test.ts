/**
 * @file message-parts.test.ts
 * @description ChatRuntime assistant 消息片段写入测试。
 */
import type { ChatMessageRecord } from 'types/chat';
import { describe, expect, it } from 'vitest';
import { createDefaultWidgetData } from '@/components/BWidget/utils/widgetData';
import {
  appendToolInputDelta,
  appendToolInputEnd,
  appendToolInputStart,
  appendToolCall,
  appendToolResult,
  applyToolActivity,
  findRendererHistory
} from '../../../../../../../electron/main/modules/chat/runtime/stream/message-parts.mjs';

/**
 * 创建 assistant 测试消息。
 * @returns assistant 消息
 */
function createAssistantMessage(): ChatMessageRecord {
  return {
    id: 'assistant-1',
    sessionId: 'session-1',
    role: 'assistant',
    content: '',
    parts: [],
    createdAt: '2026-06-30T00:00:00.000Z',
    loading: true,
    finished: false
  };
}

describe('runtime stream message parts', (): void => {
  it('parses streamed tool input only after the input-end boundary', (): void => {
    const message = createAssistantMessage();
    appendToolInputStart(message, { type: 'tool-input-start', toolCallId: 'tool-input-1', toolName: 'read_file' });
    appendToolInputDelta(message, { type: 'tool-input-delta', toolCallId: 'tool-input-1', inputTextDelta: '{"path":"src/index.ts"}' });

    expect(message.parts[0]).toMatchObject({ type: 'tool', status: 'inputting', input: null, inputText: '{"path":"src/index.ts"}' });

    appendToolInputEnd(message, { type: 'tool-input-end', toolCallId: 'tool-input-1' });
    expect(message.parts[0]).toMatchObject({ type: 'tool', status: 'executing', input: { path: 'src/index.ts' } });
  });

  it('keeps invalid completed tool input as raw text without a stale parsed value', (): void => {
    const message = createAssistantMessage();
    appendToolInputStart(message, { type: 'tool-input-start', toolCallId: 'tool-input-invalid', toolName: 'read_file' });
    appendToolInputDelta(message, { type: 'tool-input-delta', toolCallId: 'tool-input-invalid', inputTextDelta: '{"path":"src/index.ts"},' });
    appendToolInputEnd(message, { type: 'tool-input-end', toolCallId: 'tool-input-invalid' });

    expect(message.parts[0]).toMatchObject({ type: 'tool', status: 'executing', input: null, inputText: '{"path":"src/index.ts"},' });
  });

  it('finds history metadata only for the exact runtime renderer tool name', (): void => {
    const capabilities = {
      rendererTools: [
        { name: 'inspect_future_page', history: { mode: 'latest-only' as const, placeholder: 'Previous observation omitted.' } },
        { name: 'read_only_page' }
      ]
    };

    expect(findRendererHistory(capabilities, 'inspect_future_page')).toEqual({
      mode: 'latest-only',
      placeholder: 'Previous observation omitted.'
    });
    expect(findRendererHistory(capabilities, 'read_only_page')).toBeUndefined();
    expect(findRendererHistory(capabilities, 'unknown_page_tool')).toBeUndefined();
  });

  it('projects activity only onto the matching tool and clears it on result', (): void => {
    const message = createAssistantMessage();
    appendToolCall(message, { type: 'tool-call', toolCallId: 'tool-1', toolName: 'search_files', input: {} });
    appendToolCall(message, { type: 'tool-call', toolCallId: 'tool-2', toolName: 'read_file', input: {} });

    expect(
      applyToolActivity(message, 'tool-1', {
        state: 'executing',
        sequence: 2,
        lastProgressAt: 1_000,
        progress: { phase: 'scan', completed: 3, total: 10, updatedAt: 1_000 }
      })
    ).toBe(true);
    expect(message.parts[0]).toMatchObject({ type: 'tool', toolCallId: 'tool-1', activity: { progress: { completed: 3 } } });
    expect(message.parts[1]).not.toHaveProperty('activity');

    appendToolResult(message, {
      type: 'tool-result',
      toolCallId: 'tool-1',
      toolName: 'search_files',
      result: { toolName: 'search_files', status: 'success', data: { matches: [] } }
    });
    expect(message.parts[0]).not.toHaveProperty('activity');
  });

  it('persists the renderer history snapshot with the tool call', (): void => {
    const message = createAssistantMessage();

    appendToolCall(
      message,
      { type: 'tool-call', toolCallId: 'tool-history', toolName: 'inspect_future_page', input: {} },
      { mode: 'latest-only', placeholder: 'Previous observation omitted.', redactInputPaths: ['payload.secret'] }
    );

    expect(message.parts[0]).toMatchObject({
      type: 'tool',
      rendererHistory: {
        mode: 'latest-only',
        placeholder: 'Previous observation omitted.',
        redactInputPaths: ['payload.secret']
      }
    });
  });

  it('does not change assistant loading when appending an awaiting tool result', (): void => {
    const message = createAssistantMessage();
    message.loading = false;

    appendToolResult(message, {
      type: 'tool-result',
      toolCallId: 'tool-call-question',
      toolName: 'question',
      result: {
        toolName: 'question',
        status: 'awaiting_user_input',
        data: {
          questionId: 'question-1',
          toolCallId: 'tool-call-question',
          question: '继续吗？',
          mode: 'single',
          options: [{ label: '继续', value: 'yes' }]
        }
      }
    });

    expect(message).toMatchObject({ loading: false, finished: false });
  });

  it('keeps open_widget result as a tool part without appending widget part', (): void => {
    const message = createAssistantMessage();
    const widgetValue = {
      ...createDefaultWidgetData(),
      name: '天气小组件',
      description: '根据城市展示天气'
    };

    appendToolResult(message, {
      type: 'tool-result',
      toolCallId: 'tool-call-widget',
      toolName: 'open_widget',
      result: {
        toolName: 'open_widget',
        status: 'success',
        data: {
          sessionId: 'widget-weather-tool-call-widget',
          widgetId: 'weather',
          value: widgetValue,
          renderContext: {
            input: {
              city: '上海'
            },
            output: undefined,
            data: {}
          },
          execution: { status: 'success', output: undefined }
        }
      }
    });

    expect(message.parts[0]).toMatchObject({
      type: 'tool',
      toolCallId: 'tool-call-widget',
      toolName: 'open_widget',
      status: 'done',
      result: expect.objectContaining({
        data: expect.objectContaining({
          value: widgetValue
        })
      })
    });
    expect(message.parts[0]).not.toHaveProperty('presentation');
    expect(message.parts[0]).not.toHaveProperty('widget');
    expect(message.parts[0]).not.toHaveProperty('state');
    expect(message.parts).toHaveLength(1);
  });
});
