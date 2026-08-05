/**
 * @file message-helper-widget.test.ts
 * @description BChat 小组件工具结果消息工具测试。
 */
import type { ChatMessageToolPart } from 'types/chat';
import { describe, expect, it } from 'vitest';
import { convert, isWidgetToolPart } from '@/components/BChat/utils/messageHelper';
import type { Message } from '@/components/BChat/utils/types';
import { createDefaultWidgetData } from '@/components/BWidget/utils/widgetData';

/**
 * 创建 open_widget 成功工具片段。
 * @returns 工具消息片段
 */
function createOpenWidgetToolPart(): ChatMessageToolPart {
  return {
    id: 'tool-part-open-widget',
    type: 'tool',
    toolCallId: 'tool-call-widget',
    toolName: 'open_widget',
    status: 'done',
    input: {
      id: 'weather'
    },
    result: {
      toolName: 'open_widget',
      status: 'success',
      data: {
        sessionId: 'widget-weather-tool-call-widget',
        widgetId: 'weather',
        value: createDefaultWidgetData(),
        renderContext: {
          input: {
            city: '上海'
          },
          output: {
            temperature: 28
          },
          data: {}
        },
        execution: {
          status: 'success',
          output: {
            temperature: 28
          }
        }
      }
    }
  };
}

describe('messageHelper widget result', (): void => {
  it('detects open_widget tool parts with widget display results', (): void => {
    const widgetToolPart = createOpenWidgetToolPart();
    const plainToolPart: ChatMessageToolPart = {
      ...createOpenWidgetToolPart(),
      toolName: 'read_file',
      result: {
        toolName: 'read_file',
        status: 'success',
        data: {
          content: 'ok'
        }
      }
    };

    expect(isWidgetToolPart(widgetToolPart)).toBe(true);
    expect(isWidgetToolPart(plainToolPart)).toBe(false);
  });

  it('keeps widget snapshots out of model-visible tool results', (): void => {
    const assistantMessage: Message = {
      id: 'assistant-widget',
      role: 'assistant',
      content: '',
      parts: [createOpenWidgetToolPart()],
      createdAt: '2026-06-30T00:00:00.000Z',
      finished: true
    };

    const modelMessages = convert.toModelMessages([assistantMessage]);

    expect(modelMessages).toStrictEqual([
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'tool-call-widget', toolName: 'open_widget', input: { id: 'weather' } }]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tool-call-widget',
            toolName: 'open_widget',
            output: {
              type: 'json',
              value: {
                toolName: 'open_widget',
                status: 'success',
                data: {
                  sessionId: 'widget-weather-tool-call-widget',
                  widgetId: 'weather',
                  execution: {
                    status: 'success',
                    output: {
                      temperature: 28
                    }
                  }
                }
              }
            }
          }
        ]
      }
    ]);
    const toolMessage = modelMessages[1];
    if (
      !toolMessage ||
      !Array.isArray(toolMessage.content) ||
      toolMessage.content[0]?.type !== 'tool-result' ||
      toolMessage.content[0].output.type !== 'json'
    ) {
      throw new Error('Expected tool result model message');
    }
    const outputValue = toolMessage.content[0].output.value as { data: Record<string, unknown> };
    expect(Object.prototype.hasOwnProperty.call(outputValue.data, 'dropped')).toBe(false);
  });

  it('serializes model-visible tool results as JSON values', (): void => {
    const assistantMessage: Message = {
      id: 'assistant-json-tool',
      role: 'assistant',
      content: '',
      parts: [
        {
          id: 'tool-part-json',
          type: 'tool',
          toolCallId: 'tool-call-json',
          toolName: 'json_tool',
          status: 'done',
          input: {},
          result: {
            toolName: 'json_tool',
            status: 'success',
            data: {
              kept: 'ok',
              dropped: undefined,
              nested: {
                dropped: undefined
              }
            }
          }
        }
      ],
      createdAt: '2026-06-30T00:00:00.000Z',
      finished: true
    };

    expect(convert.toModelMessages([assistantMessage])).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'tool-call-json', toolName: 'json_tool', input: {} }]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tool-call-json',
            toolName: 'json_tool',
            output: {
              type: 'json',
              value: {
                toolName: 'json_tool',
                status: 'success',
                data: {
                  kept: 'ok',
                  nested: {}
                }
              }
            }
          }
        ]
      }
    ]);
  });

  it('converts widget result parts into a model-visible user text part', (): void => {
    const userMessage: Message = {
      id: 'user-widget-result',
      role: 'user',
      content: '',
      parts: [
        {
          id: 'part0028',
          type: 'widget_result',
          sessionId: 'widget-coffee-tool-call-widget',
          widgetId: 'coffee',
          result: {
            status: 'success',
            data: {
              coffeeId: 'latte',
              size: 'large'
            }
          },
          submittedAt: '2026-06-30T12:00:00.000Z'
        } as unknown as Message['parts'][number]
      ],
      createdAt: '2026-06-30T12:00:00.000Z',
      finished: true
    };

    const modelMessages = convert.toModelMessages([userMessage]);

    expect(modelMessages).toHaveLength(1);
    expect(modelMessages[0]).toEqual({
      role: 'user',
      content: [
        {
          type: 'text',
          text: JSON.stringify(userMessage.parts[0], null, 2)
        }
      ]
    });
  });
});
