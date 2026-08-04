/**
 * @file bubble-part-widget.component.test.ts
 * @description BChat BubblePartWidget 小组件运行态提交测试。
 * @vitest-environment jsdom
 */
import type { ChatMessageToolPart } from 'types/chat';
import type { WidgetData, WidgetRenderContext } from 'types/widget';
import { defineComponent, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import BubblePartWidget from '@/components/BChat/components/MessageBubble/BubblePartWidget/index.vue';
import type { SubmitAction, SubmitContext } from '@/components/BChat/utils/submitAction';
import { createDefaultWidgetData } from '@/components/BWidget/utils/widgetData';
import type { WidgetRuntimeChange } from '@/components/BWidget/utils/widgetRuntime';

/**
 * open_widget 工具片段测试用展示数据来源。
 */
interface TestWidgetDisplayFixture {
  /** 片段唯一标识 */
  id: string;
  /** 小组件会话 ID */
  sessionId: string;
  /** 小组件稳定 ID */
  widgetId: string;
  /** 小组件快照值 */
  value: WidgetData;
  /** 小组件渲染上下文 */
  renderContext: WidgetRenderContext;
}

/** 小组件提交上下文测试替身。 */
type TestSubmitContext = Pick<SubmitContext, 'continueAssistantTurn' | 'controlRuntimeTool' | 'sendAdaptedUserMessage' | 'updateMessagePart'>;

/** 可手动 resolve 的测试 Promise。 */
interface Deferred<T> {
  /** Promise 实例。 */
  promise: Promise<T>;
  /** 解决 Promise。 */
  resolve: (value: T) => void;
}

/**
 * 创建测试用 Deferred。
 * @returns 测试 Deferred
 */
function createDeferred<T = void>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => undefined;
  const promise = new Promise<T>((promiseResolve): void => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

/**
 * 创建统一提交上下文测试替身。
 * @returns 提交上下文测试替身
 */
function createSubmitContextMock(): TestSubmitContext {
  return {
    continueAssistantTurn: vi.fn(),
    controlRuntimeTool: vi.fn(),
    sendAdaptedUserMessage: vi.fn(),
    updateMessagePart: vi.fn()
  };
}

/**
 * 创建会立即运行 SubmitAction 的测试提交函数。
 * @param context - 提交上下文测试替身
 * @returns 测试提交函数
 */
function createSubmitActionRunner(context: TestSubmitContext): (action: SubmitAction) => Promise<void> {
  return async (action: SubmitAction): Promise<void> => {
    await action.run(context);
  };
}

/**
 * 创建消息内小组件快照数据。
 * @param code - 小组件JS 脚本
 * @returns 小组件快照数据
 */
function createWidgetData(code: string): WidgetData {
  return {
    ...createDefaultWidgetData(),
    execute: {
      code
    }
  };
}

/**
 * 创建消息内小组件渲染上下文。
 * @returns 小组件渲染上下文
 */
function createWidgetRenderContext(): WidgetRenderContext {
  return {
    input: {
        city: '上海'
      },
      output: undefined,
    data: {
      weather: {
        temperature: 28
      }
    }
  };
}

/**
 * 创建小组件消息片段。
 * @param code - 小组件JS 脚本
 * @returns 小组件消息片段
 */
function createWidgetPart(code: string): TestWidgetDisplayFixture {
  return {
    id: `widget-part-${code.length}`,
    sessionId: 'widget-coffee-session',
    widgetId: 'coffee',
    value: createWidgetData(code),
    renderContext: createWidgetRenderContext()
  };
}

/**
 * 从小组件视图片段创建 open_widget 工具片段。
 * @param part - 小组件视图片段
 * @returns 承载小组件运行态的工具消息片段
 */
function createOpenWidgetToolPartFromWidgetPart(part: TestWidgetDisplayFixture): ChatMessageToolPart {
  return {
    id: part.id,
    type: 'tool',
    toolCallId: `tool-call-${part.id}`,
    toolName: 'open_widget',
    status: 'done',
    input: {
      id: part.widgetId
    },
    result: {
      toolName: 'open_widget',
      status: 'success',
      data: {
        sessionId: part.sessionId,
        widgetId: part.widgetId,
        value: part.value,
        renderContext: part.renderContext,
        execution: { status: 'success', output: undefined }
      }
    }
  };
}

/**
 * 创建 BWidgetRuntime 运行态变化事件。
 * @param part - 来源小组件片段
 * @param change - 运行态变化覆盖字段
 * @returns 运行态变化事件
 */
function createRuntimeChange(part: TestWidgetDisplayFixture, change: Partial<WidgetRuntimeChange> = {}): WidgetRuntimeChange {
  return {
    reason: 'mount',
    value: part.value,
    renderContext: part.renderContext,
    ...change
  };
}

/** BWidgetRuntime 测试替身。 */
const BWidgetRuntimeStub = defineComponent({
  name: 'BWidgetRuntime',
  props: {
    renderContext: {
      type: Object,
      required: true
    },
    value: {
      type: Object,
      required: true
    },
    commitRuntimeChange: {
      type: Function,
      required: false,
      default: undefined
    }
  },
  emits: ['change', 'submit'],
  template: '<button class="widget-submit" type="button" @click="$emit(\'submit\', { coffeeId: \'latte\' })">提交</button>'
});

/**
 * 挂载小组件工具片段。
 * @param part - open_widget 工具片段
 * @param props - 额外组件入参
 * @returns 组件包装器
 */
function mountBubblePartWidget(part: ChatMessageToolPart, props: Record<string, unknown> = {}): VueWrapper {
  return mount(BubblePartWidget, {
    props: {
      messageId: 'assistant-widget-message',
      part,
      ...props
    },
    global: {
      stubs: {
        BWidgetRuntime: BWidgetRuntimeStub
      }
    }
  });
}

/**
 * 通过 BWidgetRuntime 的可 await commit 回调提交运行态变化。
 * @param wrapper - 小组件工具片段包装器
 * @param change - 运行态变化
 */
async function commitWidgetRuntimeChange(wrapper: VueWrapper, change: WidgetRuntimeChange): Promise<void> {
  const commitRuntimeChange = wrapper.findComponent({ name: 'BWidgetRuntime' }).props('commitRuntimeChange') as
    | ((nextChange: WidgetRuntimeChange) => Promise<void> | void)
    | undefined;
  if (!commitRuntimeChange) throw new Error('Expected BWidgetRuntime commitRuntimeChange prop');

  await commitRuntimeChange(change);
  await nextTick();
}

describe('BubblePartWidget', (): void => {
  it('renders widget runtime data from open_widget tool results', (): void => {
    const widgetValue = createWidgetData('export default class Weather extends Widget {}');
    const renderContext = createWidgetRenderContext();
    const toolPart: ChatMessageToolPart = {
      id: 'tool-open-widget',
      type: 'tool',
      toolCallId: 'tool-call-widget',
      toolName: 'open_widget',
      status: 'done',
      input: {
        id: 'coffee'
      },
      result: {
        toolName: 'open_widget',
        status: 'success',
        data: {
          sessionId: 'widget-coffee-session',
          widgetId: 'coffee',
          value: widgetValue,
          renderContext,
          execution: { status: 'success', output: undefined }
        }
      }
    };
    const wrapper = mountBubblePartWidget(toolPart, {
      messageId: 'assistant-widget-message'
    });

    expect(wrapper.findComponent({ name: 'BWidgetRuntime' }).props()).toMatchObject({
      renderContext,
      value: widgetValue
    });
  });

  it('updates local runtime data without emitting submit actions', async (): Promise<void> => {
    const widgetPart: TestWidgetDisplayFixture = {
      ...createWidgetPart('export default class Weather extends Widget {}'),
      renderContext: {
                input: {
          city: '上海'
        },
          output: undefined,
        data: {}
      }
    };

    const context = createSubmitContextMock();
    const wrapper = mountBubblePartWidget(createOpenWidgetToolPartFromWidgetPart(widgetPart), {
      submitAction: createSubmitActionRunner(context)
    });
    await commitWidgetRuntimeChange(
      wrapper,
      createRuntimeChange(widgetPart, {
        reason: 'mount',
        renderContext: {
                    input: {
            city: '上海'
          },
            output: undefined,
          data: {
            weather: {
              temperature: 28
            }
          }
        }
      })
    );

    expect(context.updateMessagePart).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'assistant-widget-message',
        part: expect.objectContaining({
          result: expect.objectContaining({
            data: expect.objectContaining({
              renderContext: expect.objectContaining({
                data: {
                  weather: {
                    temperature: 28
                  }
                }
              })
            })
          })
        })
      })
    );
    expect(context.sendAdaptedUserMessage).not.toHaveBeenCalled();
    expect(wrapper.findComponent({ name: 'BWidgetRuntime' }).props('renderContext')).toMatchObject({
      data: {
        weather: {
          temperature: 28
        }
      }
    });
  });

  it('passes an awaitable runtime change committer to widget runtime', async (): Promise<void> => {
    const widgetPart: TestWidgetDisplayFixture = {
      ...createWidgetPart('export default class Weather extends Widget {}'),
      renderContext: {
                input: {
          city: '上海'
        },
          output: undefined,
        data: {}
      }
    };
    const context = createSubmitContextMock();
    const submitDeferred = createDeferred();
    const submitAction = vi.fn(async (action: SubmitAction): Promise<void> => {
      await submitDeferred.promise;
      await action.run(context);
    });
    const wrapper = mountBubblePartWidget(createOpenWidgetToolPartFromWidgetPart(widgetPart), { submitAction });
    const commitRuntimeChange = wrapper.findComponent({ name: 'BWidgetRuntime' }).props('commitRuntimeChange') as
      | ((change: WidgetRuntimeChange) => Promise<void>)
      | undefined;

    expect(commitRuntimeChange).toEqual(expect.any(Function));

    let committed = false;
    const commitPromise = commitRuntimeChange?.(
      createRuntimeChange(widgetPart, {
        reason: 'mount',
        renderContext: {
                    input: {
            city: '上海'
          },
            output: undefined,
          data: {
            weather: {
              temperature: 28
            }
          }
        },
        sendMessage: {
          content: '加载完成',
          isError: false
        }
      })
    ).then((): void => {
      committed = true;
    });
    await nextTick();

    expect(committed).toBe(false);

    submitDeferred.resolve();
    await commitPromise;

    expect(submitAction).toHaveBeenCalledTimes(1);
    expect(context.updateMessagePart).toHaveBeenCalled();
    expect(context.sendAdaptedUserMessage).toHaveBeenCalled();
  });

  it('keeps the visible runtime state when streaming props fall back to created', async (): Promise<void> => {
    const widgetPart: TestWidgetDisplayFixture = {
      ...createWidgetPart('export default class Weather extends Widget {}'),
      renderContext: {
                input: {
          city: '上海'
        },
          output: undefined,
        data: {}
      }
    };
    const initialToolPart = createOpenWidgetToolPartFromWidgetPart(widgetPart);
    const wrapper = mountBubblePartWidget(initialToolPart, {
      messageId: 'assistant-widget-message'
    });

    await commitWidgetRuntimeChange(
      wrapper,
      createRuntimeChange(widgetPart, {
        reason: 'mount',
        renderContext: {
                    input: {
            city: '上海'
          },
            output: undefined,
          data: {
            weather: {
              temperature: 28
            }
          }
        }
      })
    );

    const staleToolPart = createOpenWidgetToolPartFromWidgetPart(widgetPart);
    await wrapper.setProps({
      part: staleToolPart,
      messageId: 'assistant-widget-message'
    });
    await nextTick();

    expect(wrapper.findComponent({ name: 'BWidgetRuntime' }).props()).toMatchObject({
      renderContext: {
        data: {
          weather: {
            temperature: 28
          }
        }
      }
    });
  });

  it('uses latest tool result data when the widget display payload changes', async (): Promise<void> => {
    const widgetPart: TestWidgetDisplayFixture = {
      ...createWidgetPart('export default class Weather extends Widget {}'),
      renderContext: {
                input: {
          city: '上海'
        },
          output: undefined,
        data: {}
      }
    };
    const wrapper = mountBubblePartWidget(createOpenWidgetToolPartFromWidgetPart(widgetPart));

    await commitWidgetRuntimeChange(
      wrapper,
      createRuntimeChange(widgetPart, {
        reason: 'mount',
        renderContext: {
                    input: {
            city: '上海'
          },
            output: undefined,
          data: {
            weather: {
              temperature: 28
            }
          }
        }
      })
    );

    const latestWidgetPart: TestWidgetDisplayFixture = {
      ...widgetPart,
      renderContext: {
                input: {
          city: '上海'
        },
          output: undefined,
        data: {
          weather: {
            temperature: 31
          }
        }
      }
    };
    await wrapper.setProps({
      part: createOpenWidgetToolPartFromWidgetPart(latestWidgetPart)
    });
    await nextTick();

    expect(wrapper.findComponent({ name: 'BWidgetRuntime' }).props('renderContext')).toMatchObject({
      data: {
        weather: {
          temperature: 31
        }
      }
    });
  });

  it('keeps interaction render data local without touching message parts', async (): Promise<void> => {
    const staleWidgetPart = {
      ...createWidgetPart(
        ['export default class Weather extends Widget {', '  confirmOrder() {', '    this.submitted = { temperature: this.weather.temperature }', '  }', '}'].join(
          '\n'
        )
      ),
      id: 'widget-part-stale'
    };
    const targetWidgetPart = {
      ...createWidgetPart(
        ['export default class Weather extends Widget {', '  confirmOrder() {', '    this.submitted = { temperature: this.weather.temperature }', '  }', '}'].join(
          '\n'
        )
      ),
      id: 'widget-part-target',
      renderContext: {
        input: {
            city: '上海'
          },
          output: undefined,
        data: {
          weather: {
            temperature: 35
          }
        }
      }
    };
    const staleToolPart = createOpenWidgetToolPartFromWidgetPart(staleWidgetPart);
    const targetToolPart = createOpenWidgetToolPartFromWidgetPart(targetWidgetPart);
    const context = createSubmitContextMock();
    const wrapper = mountBubblePartWidget(targetToolPart, {
      messageId: 'assistant-widget-message',
      submitAction: createSubmitActionRunner(context)
    });

    await commitWidgetRuntimeChange(
      wrapper,
      createRuntimeChange(targetWidgetPart, {
        reason: 'interaction',
        renderContext: {
          input: {
              city: '上海'
            },
            output: undefined,
          data: {
            submitted: {
              temperature: 35
            }
          }
        }
      })
    );

    expect(context.updateMessagePart).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'assistant-widget-message',
        part: expect.objectContaining({ id: targetToolPart.id })
      })
    );
    expect(context.sendAdaptedUserMessage).not.toHaveBeenCalled();
    expect(wrapper.findComponent({ name: 'BWidgetRuntime' }).props('renderContext')).toMatchObject({
      data: {
        submitted: {
          temperature: 35
        }
      }
    });
    expect(staleToolPart).toMatchObject({
      id: 'widget-part-stale'
    });
    expect(targetToolPart).not.toHaveProperty('state');
  });

  it('submits widget runtime data as a message part update without sending user messages', async (): Promise<void> => {
    const widgetScript = [
      'export default class Weather extends Widget {',
      '  confirmOrder() {',
      '    this.submitted = { temperature: this.weather.temperature }',
      '  }',
      '}'
    ].join('\n');
    const widgetPart = createWidgetPart(widgetScript);
    const toolPart = createOpenWidgetToolPartFromWidgetPart(widgetPart);
    const context = createSubmitContextMock();
    const wrapper = mountBubblePartWidget(toolPart, {
      messageId: 'assistant-widget-message',
      submitAction: createSubmitActionRunner(context)
    });

    await commitWidgetRuntimeChange(
      wrapper,
      createRuntimeChange(widgetPart, {
        reason: 'interaction',
        renderContext: {
                    input: {
            city: '上海'
          },
            output: undefined,
          data: {
            submitted: {
              temperature: 28
            }
          }
        }
      })
    );

    expect(context.updateMessagePart).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'assistant-widget-message',
        part: expect.objectContaining({
          id: toolPart.id,
          result: expect.objectContaining({
            data: expect.objectContaining({
              renderContext: expect.objectContaining({
                data: {
                  submitted: {
                    temperature: 28
                  }
                }
              })
            })
          })
        })
      })
    );
    expect(context.sendAdaptedUserMessage).not.toHaveBeenCalled();
    expect(wrapper.findComponent({ name: 'BWidgetRuntime' }).props('renderContext')).toMatchObject({
      data: {
        submitted: {
          temperature: 28
        }
      }
    });
  });

  it('sends widget runtime messages reported by interaction changes', async (): Promise<void> => {
    const widgetPart = createWidgetPart('export default class Weather extends Widget {}');
    const toolPart = createOpenWidgetToolPartFromWidgetPart(widgetPart);
    const context = createSubmitContextMock();
    const wrapper = mountBubblePartWidget(toolPart, {
      messageId: 'assistant-widget-message',
      submitAction: createSubmitActionRunner(context)
    });
    await commitWidgetRuntimeChange(
      wrapper,
      createRuntimeChange(widgetPart, {
        reason: 'interaction',
        sendMessage: {
          content: '确认下单',
          isError: false
        }
      })
    );

    expect(context.updateMessagePart).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'assistant-widget-message',
        part: expect.objectContaining({ id: toolPart.id })
      })
    );
    expect(context.sendAdaptedUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: expect.objectContaining({
          content: '确认下单'
        })
      })
    );
  });
});
