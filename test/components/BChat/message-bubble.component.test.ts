/**
 * @file message-bubble.component.test.ts
 * @description BChat MessageBubble 工具栏交互测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import type { ChatMessageCompactionPart, ChatMessageToolPart, ChatMessageWidgetResultPart } from 'types/chat';
import type { WidgetData, WidgetRenderContext } from 'types/widget';
import { defineComponent, h, nextTick } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MessageBubble from '@/components/BChat/components/MessageBubble.vue';
import { create } from '@/components/BChat/utils/messageHelper';
import type { SubmitContext, SubmitAction } from '@/components/BChat/utils/submitAction';
import type { Message } from '@/components/BChat/utils/types';
import { createDefaultWidgetData } from '@/components/BWidget/utils/widgetData';
import { createDefaultWidgetElementLoopConfig } from '@/components/BWidget/utils/widgetLoop';
import type { WidgetRuntimeChange } from '@/components/BWidget/utils/widgetRuntime';

/** 剪贴板写入测试替身。 */
const clipboardMock = vi.fn();

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

/**
 * 创建统一提交上下文测试替身。
 * @returns 提交上下文测试替身
 */
function createSubmitContextMock(): SubmitContext {
  return {
    continueAssistantTurn: vi.fn(),
    controlRuntimeTool: vi.fn(),
    sendAdaptedUserMessage: vi.fn(),
    updateMessagePart: vi.fn()
  };
}

vi.mock('@/hooks/useClipboard', () => ({
  useClipboard: vi.fn(() => ({
    clipboard: clipboardMock
  }))
}));

vi.mock('@/hooks/useImagePreview', () => ({
  useImagePreview: vi.fn(() => ({
    previewImage: vi.fn()
  }))
}));

vi.mock('@/hooks/useNavigate', () => ({
  useNavigate: vi.fn(() => ({
    openFile: vi.fn(),
    openSkill: vi.fn(),
    openWebview: vi.fn()
  }))
}));

/** ResizeObserver 回调。 */
type ResizeObserverCallbackLike = (entries: ResizeObserverEntry[]) => void;

/**
 * BWidgetRuntime 测试用 ResizeObserver。
 */
class ResizeObserverMock {
  /** ResizeObserver 回调。 */
  private readonly callback: ResizeObserverCallbackLike;

  /**
   * 创建 ResizeObserver 测试替身。
   * @param callback - ResizeObserver 回调
   */
  public constructor(callback: ResizeObserverCallbackLike) {
    this.callback = callback;
  }

  /**
   * 监听目标元素尺寸。
   * @param target - 监听目标
   */
  public observe = (target: Element): void => {
    this.callback([
      {
        target,
        contentRect: DOMRect.fromRect({ width: 480, height: 240 }),
        contentBoxSize: [
          {
            inlineSize: 480,
            blockSize: 240
          }
        ]
      } as unknown as ResizeObserverEntry
    ]);
  };

  /** 停止监听目标元素。 */
  public unobserve = vi.fn();

  /** 断开全部尺寸监听。 */
  public disconnect = vi.fn();
}

/** BBubble 测试替身，保留默认插槽用于渲染消息内容。 */
const BBubbleStub = defineComponent({
  name: 'BBubble',
  template: '<div class="b-bubble-stub"><slot name="header" /><slot /></div>'
});

/** BButton 测试替身，暴露 icon 属性便于断言按钮是否存在。 */
const BButtonStub = defineComponent({
  name: 'BButton',
  props: {
    icon: {
      type: String,
      default: ''
    },
    disabled: {
      type: Boolean,
      default: false
    },
    loading: {
      type: Boolean,
      default: false
    }
  },
  emits: ['click'],
  template: '<button class="b-button-stub" :data-icon="icon" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
});

/** Markdown 消息测试替身，直接渲染文本内容。 */
const BMessageStub = defineComponent({
  name: 'BMessage',
  props: {
    content: {
      type: String,
      default: ''
    }
  },
  template: '<div class="b-message-stub">{{ content }}</div>'
});

/** 顺序测试用文本片段替身。 */
const BubblePartTextOrderStub = defineComponent({
  name: 'BubblePartText',
  props: {
    part: {
      type: Object,
      required: true
    }
  },
  template: '<div class="order-text">{{ part.text }}</div>'
});

/** 顺序测试用工具片段替身。 */
const BubblePartToolOrderStub = defineComponent({
  name: 'BubblePartTool',
  props: {
    part: {
      type: Object,
      required: true
    }
  },
  template: '<div class="order-tool">{{ part.result.data.marker }}</div>'
});

/** 顺序测试用 Child Agent 片段替身。 */
let agentTaskStubInstance = 0;

/** 顺序测试用 Child Agent 片段替身。 */
const BubblePartAgentOrderStub = defineComponent({
  name: 'BubblePartAgent',
  props: {
    sessionId: {
      type: String,
      default: null
    },
    assistantMessageId: {
      type: String,
      required: true
    },
    part: {
      type: Object,
      required: true
    }
  },
  setup(stubProps): () => ReturnType<typeof h> {
    const instanceId = ++agentTaskStubInstance;
    return (): ReturnType<typeof h> =>
      h(
        'div',
        {
          class: 'order-agent',
          'data-instance': instanceId
        },
        String((stubProps.part as ChatMessageToolPart).input && ((stubProps.part as ChatMessageToolPart).input as Record<string, unknown>).marker)
      );
  }
});

/** 静默 BWidgetRuntime 测试替身，用于只验证宿主初始化动作。 */
const BWidgetRuntimeSilentStub = defineComponent({
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
  template: '<div class="b-widget-runtime-silent-stub" />'
});

/**
 * 创建助手消息。
 * @param overrides - 消息覆盖字段
 * @returns 助手消息
 */
function createAssistantMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: 'assistant content',
    parts: [{ id: 'part0008', type: 'text', text: 'assistant content' }],
    createdAt: '2026-06-23T00:00:00.000Z',
    loading: false,
    finished: true,
    ...overrides
  };
}

/**
 * 创建消息流顺序测试用压缩片段。
 * @returns 成功压缩片段
 */
function createCompactionPart(): ChatMessageCompactionPart {
  return {
    id: 'checkpoint-order',
    type: 'compaction',
    status: 'success',
    trigger: 'manual',
    boundaryPartId: 'text-before',
    createdAt: 1,
    completedAt: 2
  };
}

/**
 * 创建消息内小组件快照数据。
 * @returns 小组件快照数据
 */
function createWeatherWidgetData(): WidgetData {
  return {
    ...createDefaultWidgetData(),
    elements: [
      {
        id: 'weather-text',
        name: 'text',
        label: '文本',
        icon: 'lucide:type',
        title: '天气文本',
        position: { x: 0, y: 0 },
        size: { width: 180, height: 48 },
        rotation: 0,
        style: {},
        loop: createDefaultWidgetElementLoopConfig(),
        metadata: {
          content: '{{ $input.city }} 当前 {{ weather.temperature }}°C'
        }
      }
    ]
  };
}

/**
 * 创建消息内小组件渲染上下文。
 * @returns 小组件渲染上下文
 */
function createWeatherRenderContext(): WidgetRenderContext {
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

/**
 * 将测试用小组件运行态包装成 open_widget 工具片段。
 * @param part - 小组件运行态片段
 * @returns open_widget 工具片段
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
 * 从消息气泡中的 BWidgetRuntime 发出运行态变化。
 * @param wrapper - 消息气泡包装器
 * @param change - 运行态变化事件
 */
async function emitWidgetRuntimeChange(wrapper: VueWrapper, change: WidgetRuntimeChange): Promise<void> {
  const commitRuntimeChange = wrapper.findComponent({ name: 'BWidgetRuntime' }).props('commitRuntimeChange') as
    | ((nextChange: WidgetRuntimeChange) => Promise<void> | void)
    | undefined;
  if (!commitRuntimeChange) throw new Error('Expected BWidgetRuntime commitRuntimeChange prop');

  await commitRuntimeChange(change);
  await nextTick();
}

/**
 * 创建会立即运行 SubmitAction 的测试提交函数。
 * @param context - 提交上下文测试替身
 * @returns 测试提交函数
 */
function createSubmitActionRunner(context: SubmitContext): (action: SubmitAction) => Promise<void> {
  return async (action: SubmitAction): Promise<void> => {
    await action.run(context);
  };
}

/**
 * 断言提交上下文只更新消息片段。
 * @param context - 提交上下文测试替身
 */
function expectSubmitContextUpdatesPartOnly(context: SubmitContext): void {
  expect(context.updateMessagePart).toHaveBeenCalled();
  expect(context.sendAdaptedUserMessage).not.toHaveBeenCalled();
}

/**
 * 创建等待用户选择的工具片段。
 * @returns 等待用户选择工具片段
 */
function createQuestionToolPart(): ChatMessageToolPart {
  return {
    id: 'tool-part-question',
    type: 'tool',
    toolCallId: 'tool-call-question',
    toolName: 'question',
    status: 'done',
    input: {},
    result: {
      toolName: 'question',
      status: 'awaiting_user_input',
      data: {
        questionId: 'question-1',
        toolCallId: 'tool-call-question',
        question: '是否继续？',
        mode: 'single',
        options: [{ label: '继续', value: 'continue' }]
      }
    }
  };
}

/**
 * 创建顺序测试用 delegate_task 片段。
 * @param id - Part 稳定身份
 * @param marker - 可观察展示标记
 * @returns 执行中的委派片段
 */
function createTaskOrderPart(id: string, marker: string): ChatMessageToolPart {
  return {
    id,
    type: 'tool',
    toolCallId: `${id}-call`,
    toolName: 'delegate_task',
    status: 'executing',
    input: { marker }
  };
}

/**
 * 挂载消息气泡。
 * @param message - 待渲染消息
 * @param submitAction - 消息级交互提交函数
 * @param loading - 是否禁用助手历史操作
 * @returns 组件包装器
 */
function mountMessageBubble(message: Message, submitAction?: (action: SubmitAction) => Promise<void> | void, loading = false): VueWrapper {
  return mount(MessageBubble, {
    props: {
      sessionId: 'session-1',
      message,
      submitAction,
      loading
    },
    global: {
      stubs: {
        BBubble: BBubbleStub,
        BButton: BButtonStub,
        BIcon: true,
        BRecentIcon: true,
        BMessage: BMessageStub
      }
    }
  });
}

/**
 * 使用可观察片段替身挂载顺序测试消息。
 * @param message - 待渲染消息
 * @returns 组件包装器
 */
function mountOrderedMessageBubble(message: Message): VueWrapper {
  return mount(MessageBubble, {
    props: {
      sessionId: 'session-1',
      message
    },
    global: {
      stubs: {
        BBubble: BBubbleStub,
        BButton: BButtonStub,
        BIcon: true,
        BubblePartAgent: BubblePartAgentOrderStub,
        BubblePartText: BubblePartTextOrderStub,
        BubblePartTool: BubblePartToolOrderStub
      }
    }
  });
}

/**
 * 挂载静默 Widget 运行态的消息气泡。
 * @param message - 待渲染消息
 * @returns 组件包装器
 */
function mountMessageBubbleWithSilentWidgetRuntime(message: Message, submitAction?: (action: SubmitAction) => Promise<void> | void): VueWrapper {
  return mount(MessageBubble, {
    props: {
      sessionId: 'session-1',
      message,
      submitAction
    },
    global: {
      stubs: {
        BBubble: BBubbleStub,
        BButton: BButtonStub,
        BIcon: true,
        BRecentIcon: true,
        BMessage: BMessageStub,
        BWidgetRuntime: BWidgetRuntimeSilentStub
      }
    }
  });
}

describe('MessageBubble', (): void => {
  beforeEach((): void => {
    clipboardMock.mockClear();
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('shows regenerate for finished assistant text messages', (): void => {
    const wrapper = mountMessageBubble(createAssistantMessage());

    expect(wrapper.find('[data-icon="lucide:refresh-cw"]').exists()).toBe(true);
  });

  it('keeps compaction parts in their original message part order', (): void => {
    const firstTool = createQuestionToolPart();
    firstTool.id = 'tool-first';
    firstTool.toolCallId = 'tool-call-first';
    firstTool.toolName = 'first_tool';
    firstTool.result = { toolName: 'first_tool', status: 'success', data: { marker: 'first tool' } };
    const secondTool = structuredClone(firstTool);
    secondTool.id = 'tool-second';
    secondTool.toolCallId = 'tool-call-second';
    secondTool.toolName = 'second_tool';
    secondTool.result = { toolName: 'second_tool', status: 'success', data: { marker: 'second tool' } };
    const wrapper = mountOrderedMessageBubble(
      createAssistantMessage({
        content: '',
        parts: [
          { id: 'text-before', type: 'text', text: 'before text' },
          firstTool,
          createCompactionPart(),
          secondTool,
          { id: 'text-after', type: 'text', text: 'after text' }
        ]
      })
    );
    const content = wrapper.get('.message-bubble__parts').text();

    expect(content.indexOf('before text')).toBeLessThan(content.indexOf('first tool'));
    expect(content.indexOf('first tool')).toBeLessThan(content.indexOf('上下文已压缩'));
    expect(content.indexOf('上下文已压缩')).toBeLessThan(content.indexOf('second tool'));
    expect(content.indexOf('second tool')).toBeLessThan(content.indexOf('after text'));
  });

  it('routes only exact delegate_task parts at their original key and order', (): void => {
    const delegatePart = createQuestionToolPart();
    delegatePart.id = 'delegate-part';
    delegatePart.toolCallId = 'delegate-call';
    delegatePart.toolName = 'delegate_task';
    delegatePart.status = 'executing';
    delegatePart.input = { marker: 'delegated task' };
    delegatePart.result = undefined;
    const otherPart = structuredClone(delegatePart);
    Reflect.deleteProperty(otherPart, 'id');
    otherPart.toolCallId = 'other-call';
    otherPart.toolName = 'delegate_task_similar';
    otherPart.status = 'done';
    otherPart.input = {};
    otherPart.result = {
      toolName: 'delegate_task_similar',
      status: 'success',
      data: { marker: 'generic tool' }
    };
    const message = createAssistantMessage({
      id: 'assistant-route',
      content: '',
      parts: [
        { id: 'text-before-agent', type: 'text', text: 'before agent' },
        delegatePart,
        otherPart,
        { id: 'text-after-agent', type: 'text', text: 'after agent' }
      ]
    });
    const wrapper = mountOrderedMessageBubble(message);
    const content = wrapper.get('.message-bubble__parts').text();
    const agentTask = wrapper.getComponent(BubblePartAgentOrderStub);

    expect(content.indexOf('before agent')).toBeLessThan(content.indexOf('delegated task'));
    expect(content.indexOf('delegated task')).toBeLessThan(content.indexOf('generic tool'));
    expect(content.indexOf('generic tool')).toBeLessThan(content.indexOf('after agent'));
    expect(agentTask.props()).toMatchObject({
      sessionId: 'session-1',
      assistantMessageId: 'assistant-route',
      part: delegatePart
    });
    expect(wrapper.findAllComponents(BubblePartToolOrderStub)).toHaveLength(1);
  });

  it('keeps keyed delegate_task component identity when message parts reorder', async (): Promise<void> => {
    const firstTask = createTaskOrderPart('delegate-first', 'first task');
    const secondTask = createTaskOrderPart('delegate-second', 'second task');
    const message = createAssistantMessage({
      content: '',
      parts: [firstTask, secondTask]
    });
    const wrapper = mountOrderedMessageBubble(message);
    const initialInstances = Object.fromEntries(
      wrapper.findAll('.order-agent').map((item): readonly [string, string | undefined] => [item.text(), item.attributes('data-instance')])
    );

    await wrapper.setProps({
      sessionId: 'session-1',
      message: {
        ...message,
        parts: [secondTask, firstTask]
      }
    });

    const reorderedInstances = Object.fromEntries(
      wrapper.findAll('.order-agent').map((item): readonly [string, string | undefined] => [item.text(), item.attributes('data-instance')])
    );
    expect(reorderedInstances).toEqual(initialInstances);
  });

  it('routes delegate_task before question-result detection and keeps case-sensitive near names generic', (): void => {
    const delegateQuestion = createQuestionToolPart();
    delegateQuestion.toolName = 'delegate_task';
    const caseVariant = structuredClone(delegateQuestion);
    caseVariant.id = 'delegate-case';
    caseVariant.toolCallId = 'delegate-case-call';
    caseVariant.toolName = 'Delegate_Task';
    caseVariant.result = {
      toolName: 'Delegate_Task',
      status: 'success',
      data: { marker: 'case variant' }
    };
    const wrapper = mountOrderedMessageBubble(
      createAssistantMessage({
        content: '',
        parts: [delegateQuestion, caseVariant]
      })
    );

    expect(wrapper.findAllComponents(BubblePartAgentOrderStub)).toHaveLength(1);
    expect(wrapper.findAllComponents(BubblePartToolOrderStub)).toHaveLength(1);
    expect(wrapper.findComponent({ name: 'QuestionCard' }).exists()).toBe(false);
  });

  it('hides assistant actions for compaction-only messages', (): void => {
    const wrapper = mountMessageBubble(
      createAssistantMessage({
        content: '',
        parts: [createCompactionPart()]
      })
    );

    expect(wrapper.text()).toContain('上下文已压缩');
    expect(wrapper.find('[data-icon="lucide:git-branch"]').exists()).toBe(false);
    expect(wrapper.find('[data-icon="lucide:refresh-cw"]').exists()).toBe(false);
    expect(wrapper.find('[data-icon="lucide:copy"]').exists()).toBe(false);
  });

  it('emits branch clicks without owning request loading state', async (): Promise<void> => {
    const message = createAssistantMessage();
    const wrapper = mountMessageBubble(message);
    const branchButton = wrapper.findAllComponents(BButtonStub).find((button): boolean => button.props('icon') === 'lucide:git-branch');

    expect(branchButton).toBeDefined();

    await branchButton?.trigger('click');
    await branchButton?.trigger('click');

    const branchEvents = wrapper.emitted('branch');
    expect(branchEvents).toHaveLength(2);
    expect(branchEvents?.[0]?.[0]).toEqual(message);
    expect(branchButton?.props('disabled')).toBe(false);
    expect(branchButton?.props('loading')).toBe(false);
  });

  it('disables branch and regenerate while assistant actions are locked', async (): Promise<void> => {
    const message = createAssistantMessage();
    const wrapper = mountMessageBubble(message, undefined, true);
    const branchButton = wrapper.findAllComponents(BButtonStub).find((button): boolean => button.props('icon') === 'lucide:git-branch');
    const regenerateButton = wrapper.findAllComponents(BButtonStub).find((button): boolean => button.props('icon') === 'lucide:refresh-cw');
    const copyButton = wrapper.findAllComponents(BButtonStub).find((button): boolean => button.props('icon') === 'lucide:copy');

    expect(branchButton?.props('disabled')).toBe(true);
    expect(regenerateButton?.props('disabled')).toBe(true);
    expect(copyButton?.props('disabled')).toBe(false);

    await branchButton?.trigger('click');
    await regenerateButton?.trigger('click');

    expect(wrapper.emitted('branch')).toBeUndefined();
    expect(wrapper.emitted('regenerate')).toBeUndefined();
  });

  it('does not show regenerate for runtime error messages', (): void => {
    const wrapper = mountMessageBubble(create.errorMessage('模型调用失败'));

    expect(wrapper.find('[data-icon="lucide:refresh-cw"]').exists()).toBe(false);
    expect(wrapper.emitted('regenerate')).toBeUndefined();
  });

  it('shows regenerate for assistant messages that contain an error part', async (): Promise<void> => {
    const wrapper = mountMessageBubble(
      createAssistantMessage({
        content: '模型调用失败',
        parts: [{ id: 'part0009', type: 'error', text: '模型调用失败' }]
      })
    );

    const regenerateButton = wrapper.get('[data-icon="lucide:refresh-cw"]');
    await regenerateButton.trigger('click');

    expect(wrapper.emitted('regenerate')?.[0]?.[0]).toMatchObject({
      role: 'assistant',
      content: '模型调用失败'
    });
  });

  it('keeps mounted widget render data local without submit actions', async (): Promise<void> => {
    const widgetPart: TestWidgetDisplayFixture = {
      id: 'widget-created-part',
      sessionId: 'widget-session-1',
      widgetId: 'weather',
      value: {
        ...createWeatherWidgetData(),
        execute: {
          code: ['export default class Weather extends Widget {', '  onMounted() {', '    this.weather = { temperature: 31 }', '  }', '}'].join('\n')
        }
      },
      renderContext: {
        input: {
          city: '上海'
        },
        output: undefined,
        data: {}
      }
    };
    const toolPart = createOpenWidgetToolPartFromWidgetPart(widgetPart);
    const submitContext = createSubmitContextMock();
    const wrapper = mountMessageBubble(
      createAssistantMessage({
        id: 'assistant-widget',
        content: '',
        parts: [toolPart]
      }),
      createSubmitActionRunner(submitContext)
    );

    await emitWidgetRuntimeChange(
      wrapper,
      createRuntimeChange(widgetPart, {
        reason: 'mount',
        renderContext: {
          input: {
            city: '上海'
          },
          output: undefined,
          isMounted: true,
          data: {
            weather: {
              temperature: 31
            }
          }
        }
      })
    );
    await flushPromises();

    expect(submitContext.updateMessagePart).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'assistant-widget',
        part: expect.objectContaining({
          result: expect.objectContaining({
            data: expect.objectContaining({
              renderContext: expect.objectContaining({
                isMounted: true,
                data: {
                  weather: {
                    temperature: 31
                  }
                }
              })
            })
          })
        })
      })
    );
    expect(wrapper.findComponent({ name: 'BWidgetRuntime' }).props('renderContext')).toMatchObject({
      isMounted: true,
      data: {
        weather: {
          temperature: 31
        }
      }
    });
  });

  it('keeps widget render data local for widget parts outside the first index', async (): Promise<void> => {
    const widgetPart: TestWidgetDisplayFixture = {
      id: 'widget-second-part',
      sessionId: 'widget-session-2',
      widgetId: 'weather',
      value: {
        ...createWeatherWidgetData(),
        execute: {
          code: ['export default class Weather extends Widget {', '  onMounted() {', '    this.weather = { temperature: 32 }', '  }', '}'].join('\n')
        }
      },
      renderContext: {
        input: {
          city: '杭州'
        },
        output: undefined,
        data: {}
      }
    };
    const toolPart = createOpenWidgetToolPartFromWidgetPart(widgetPart);
    const submitContext = createSubmitContextMock();
    const wrapper = mountMessageBubble(
      createAssistantMessage({
        id: 'assistant-widget-second',
        content: '',
        parts: [{ id: 'part0012', type: 'text', text: '天气卡片' }, toolPart]
      }),
      createSubmitActionRunner(submitContext)
    );

    await emitWidgetRuntimeChange(
      wrapper,
      createRuntimeChange(widgetPart, {
        reason: 'mount',
        renderContext: {
          input: {
            city: '杭州'
          },
          output: undefined,
          data: {
            weather: {
              temperature: 32
            }
          }
        }
      })
    );
    await flushPromises();

    expectSubmitContextUpdatesPartOnly(submitContext);
    expect(wrapper.findComponent({ name: 'BWidgetRuntime' }).props('renderContext')).toMatchObject({
      data: {
        weather: {
          temperature: 32
        }
      }
    });
  });

  it('keeps widget runtime state local without sending widget_result messages', async (): Promise<void> => {
    const widgetPart: TestWidgetDisplayFixture = {
      id: 'widget-result-part',
      sessionId: 'widget-coffee-session-1',
      widgetId: 'coffee',
      value: createWeatherWidgetData(),
      renderContext: createWeatherRenderContext()
    };
    const toolPart = createOpenWidgetToolPartFromWidgetPart(widgetPart);
    const submitContext = createSubmitContextMock();
    const wrapper = mountMessageBubble(
      createAssistantMessage({
        content: '',
        parts: [toolPart]
      }),
      createSubmitActionRunner(submitContext)
    );

    await emitWidgetRuntimeChange(
      wrapper,
      createRuntimeChange(widgetPart, {
        reason: 'interaction',
        renderContext: {
          input: {
            city: '上海'
          },
          output: undefined,
          data: {
            weather: {
              temperature: 28
            },
            submitted: {
              city: '上海',
              temperature: 28
            }
          }
        }
      })
    );
    await flushPromises();

    expectSubmitContextUpdatesPartOnly(submitContext);
    expect(wrapper.findComponent({ name: 'BWidgetRuntime' }).props('renderContext')).toMatchObject({
      data: {
        weather: {
          temperature: 28
        },
        submitted: {
          city: '上海',
          temperature: 28
        }
      }
    });
  });

  it('keeps widget runtime data local without sending widget_result messages', async (): Promise<void> => {
    const widgetPart: TestWidgetDisplayFixture = {
      id: 'widget-submit-part',
      sessionId: 'widget-coffee-session-2',
      widgetId: 'coffee',
      value: {
        ...createWeatherWidgetData(),
        execute: {
          code: [
            'export default class Weather extends Widget {',
            '  confirmOrder() {',
            '    this.submitted = { city: this.$input.city, temperature: this.weather.temperature }',
            '  }',
            '}'
          ].join('\n')
        }
      },
      renderContext: createWeatherRenderContext()
    };
    const toolPart = createOpenWidgetToolPartFromWidgetPart(widgetPart);
    const submitContext = createSubmitContextMock();
    const wrapper = mountMessageBubble(
      createAssistantMessage({
        id: 'assistant-widget-submit',
        content: '',
        parts: [toolPart]
      }),
      createSubmitActionRunner(submitContext)
    );

    await emitWidgetRuntimeChange(
      wrapper,
      createRuntimeChange(widgetPart, {
        reason: 'interaction',
        renderContext: {
          input: {
            city: '上海'
          },
          output: undefined,
          data: {
            weather: {
              temperature: 28
            },
            submitted: {
              city: '上海',
              temperature: 28
            }
          }
        }
      })
    );
    await flushPromises();

    expectSubmitContextUpdatesPartOnly(submitContext);
    expect(wrapper.findComponent({ name: 'BWidgetRuntime' }).props('renderContext')).toMatchObject({
      data: {
        weather: {
          temperature: 28
        },
        submitted: {
          city: '上海',
          temperature: 28
        }
      }
    });
  });

  it('keeps latest widget runtime data local after message part updates', async (): Promise<void> => {
    const staleWidgetPart: TestWidgetDisplayFixture = {
      id: 'widget-latest-submit-part',
      sessionId: 'widget-coffee-session-3',
      widgetId: 'coffee',
      value: {
        ...createWeatherWidgetData(),
        execute: {
          code: [
            'export default class Weather extends Widget {',
            '  confirmOrder() {',
            '    this.submitted = { temperature: this.weather.temperature }',
            '  }',
            '}'
          ].join('\n')
        }
      },
      renderContext: createWeatherRenderContext()
    };
    const latestWidgetPart: TestWidgetDisplayFixture = {
      ...staleWidgetPart,
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
    const latestToolPart = createOpenWidgetToolPartFromWidgetPart(latestWidgetPart);
    const submitContext = createSubmitContextMock();
    const wrapper = mountMessageBubble(
      createAssistantMessage({
        id: 'assistant-widget-latest-submit',
        content: '',
        parts: [staleToolPart]
      }),
      createSubmitActionRunner(submitContext)
    );

    await wrapper.setProps({
      message: createAssistantMessage({
        id: 'assistant-widget-latest-submit',
        content: '',
        parts: [latestToolPart]
      })
    });
    await flushPromises();

    await emitWidgetRuntimeChange(
      wrapper,
      createRuntimeChange(latestWidgetPart, {
        reason: 'interaction',
        renderContext: {
          input: {
            city: '上海'
          },
          output: undefined,
          data: {
            weather: {
              temperature: 35
            },
            submitted: {
              temperature: 35
            }
          }
        }
      })
    );
    await flushPromises();

    expectSubmitContextUpdatesPartOnly(submitContext);
    expect(wrapper.findComponent({ name: 'BWidgetRuntime' }).props('renderContext')).toMatchObject({
      data: {
        weather: {
          temperature: 35
        },
        submitted: {
          temperature: 35
        }
      }
    });
  });

  it('keeps widget runtime data when streaming snapshots replace the part id for the same tool call', async (): Promise<void> => {
    const widgetPart: TestWidgetDisplayFixture = {
      id: 'widget-stream-created-part',
      sessionId: 'widget-coffee-session-5',
      widgetId: 'coffee',
      value: createWeatherWidgetData(),
      renderContext: {
        input: {
          city: '上海'
        },
        output: undefined,
        data: {}
      }
    };
    const initialToolPart: ChatMessageToolPart = {
      ...createOpenWidgetToolPartFromWidgetPart(widgetPart),
      toolCallId: 'tool-call-stable-widget'
    };
    const streamToolPart: ChatMessageToolPart = {
      ...createOpenWidgetToolPartFromWidgetPart({
        ...widgetPart,
        id: 'widget-stream-replaced-part'
      }),
      toolCallId: 'tool-call-stable-widget'
    };
    const wrapper = mountMessageBubble(
      createAssistantMessage({
        id: 'assistant-widget-stream',
        content: '',
        parts: [initialToolPart]
      })
    );

    await emitWidgetRuntimeChange(
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
              temperature: 33
            }
          }
        }
      })
    );
    await flushPromises();

    await wrapper.setProps({
      message: createAssistantMessage({
        id: 'assistant-widget-stream',
        content: '',
        parts: [streamToolPart]
      })
    });
    await flushPromises();

    expect(wrapper.findComponent({ name: 'BWidgetRuntime' }).props('renderContext')).toMatchObject({
      data: {
        weather: {
          temperature: 33
        }
      }
    });
  });

  it('adds ids to widget script message parts and sends them instead of widget_result', async (): Promise<void> => {
    const widgetPart: TestWidgetDisplayFixture = {
      id: 'widget-send-message-part',
      sessionId: 'widget-coffee-session-4',
      widgetId: 'coffee',
      value: {
        ...createWeatherWidgetData(),
        execute: {
          code: [
            'export default class Weather extends Widget {',
            '  confirmOrder() {',
            "    this.$sendMessage({ content: [{ type: 'text', text: '确认下单' }] })",
            '  }',
            '}'
          ].join('\n')
        }
      },
      renderContext: createWeatherRenderContext()
    };
    const toolPart = createOpenWidgetToolPartFromWidgetPart(widgetPart);
    const submitContext = createSubmitContextMock();
    const wrapper = mountMessageBubble(
      createAssistantMessage({
        id: 'assistant-widget-send-message',
        content: '',
        parts: [toolPart]
      }),
      createSubmitActionRunner(submitContext)
    );

    await emitWidgetRuntimeChange(
      wrapper,
      createRuntimeChange(widgetPart, {
        reason: 'interaction',
        sendMessage: {
          content: [{ type: 'text', text: '确认下单' }],
          isError: false
        }
      })
    );

    expect(submitContext.sendAdaptedUserMessage).toHaveBeenCalledWith({
      userMessage: expect.objectContaining({
        role: 'user',
        content: '确认下单',
        parts: [expect.objectContaining({ id: expect.any(String), type: 'text', text: '确认下单' })]
      }),
      parts: [expect.objectContaining({ id: expect.any(String), type: 'text', text: '确认下单' })]
    });
    expect(submitContext.sendAdaptedUserMessage).toHaveBeenCalledTimes(1);
  });

  it('marks widget script error messages in the text sent to chat runtime', async (): Promise<void> => {
    const widgetPart: TestWidgetDisplayFixture = {
      id: 'widget-error-message-part',
      sessionId: 'widget-coffee-session-error',
      widgetId: 'coffee',
      value: {
        ...createWeatherWidgetData(),
        execute: {
          code: [
            'export default class Weather extends Widget {',
            '  confirmOrder() {',
            "    this.$sendMessage({ content: '库存不足', isError: true })",
            '  }',
            '}'
          ].join('\n')
        }
      },
      renderContext: createWeatherRenderContext()
    };
    const toolPart = createOpenWidgetToolPartFromWidgetPart(widgetPart);
    const message = createAssistantMessage({
      id: 'assistant-widget-error-message',
      content: '',
      parts: [toolPart]
    });
    const submitContext = createSubmitContextMock();
    const wrapper = mountMessageBubble(message, createSubmitActionRunner(submitContext));

    await emitWidgetRuntimeChange(
      wrapper,
      createRuntimeChange(widgetPart, {
        reason: 'interaction',
        sendMessage: {
          content: '库存不足',
          isError: true
        }
      })
    );

    expect(submitContext.sendAdaptedUserMessage).toHaveBeenCalledWith({
      userMessage: expect.objectContaining({
        role: 'user',
        content: '小组件错误：库存不足',
        parts: [expect.objectContaining({ type: 'text', text: '小组件错误：库存不足' })]
      }),
      parts: [expect.objectContaining({ type: 'text', text: '小组件错误：库存不足' })]
    });
  });

  it('sends widget script message from latest message without relying on update updater side effects', async (): Promise<void> => {
    const staleWidgetPart: TestWidgetDisplayFixture = {
      id: 'widget-latest-message-part',
      sessionId: 'widget-coffee-session-latest-message',
      widgetId: 'coffee',
      value: {
        ...createWeatherWidgetData(),
        execute: {
          code: [
            'export default class Weather extends Widget {',
            '  confirmOrder() {',
            '    this.$sendMessage({ content: this.order.message })',
            '  }',
            '}'
          ].join('\n')
        }
      },
      renderContext: createWeatherRenderContext()
    };
    const latestWidgetPart: TestWidgetDisplayFixture = {
      ...staleWidgetPart,
      renderContext: {
        input: {},
        output: undefined,
        data: {
          order: {
            message: '确认最新订单'
          }
        }
      }
    };
    const staleToolPart = createOpenWidgetToolPartFromWidgetPart(staleWidgetPart);
    const latestToolPart = createOpenWidgetToolPartFromWidgetPart(latestWidgetPart);
    const submitContext = createSubmitContextMock();
    const wrapper = mountMessageBubble(
      createAssistantMessage({
        id: 'assistant-widget-latest-message',
        content: '',
        parts: [staleToolPart]
      }),
      createSubmitActionRunner(submitContext)
    );

    await wrapper.setProps({
      message: createAssistantMessage({
        id: 'assistant-widget-latest-message',
        content: '',
        parts: [latestToolPart]
      })
    });
    await flushPromises();

    await emitWidgetRuntimeChange(
      wrapper,
      createRuntimeChange(latestWidgetPart, {
        reason: 'interaction',
        sendMessage: {
          content: '确认最新订单',
          isError: false
        }
      })
    );

    expect(submitContext.sendAdaptedUserMessage).toHaveBeenCalledWith({
      userMessage: expect.objectContaining({
        role: 'user',
        content: '确认最新订单',
        parts: [expect.objectContaining({ type: 'text', text: '确认最新订单' })]
      }),
      parts: [expect.objectContaining({ type: 'text', text: '确认最新订单' })]
    });
  });

  it('emits unified submit actions from question answers', async (): Promise<void> => {
    const submitContext = createSubmitContextMock();
    const wrapper = mountMessageBubble(
      createAssistantMessage({
        content: '',
        parts: [createQuestionToolPart()]
      }),
      createSubmitActionRunner(submitContext)
    );

    await wrapper.get('.choice-card__option-btn').trigger('click');
    await wrapper.get('.choice-card__footer-right .b-button-stub:last-child').trigger('click');
    await wrapper.get('.choice-card__footer-right .b-button-stub:last-child').trigger('click');

    expect(submitContext.continueAssistantTurn).toHaveBeenCalledWith({
      questionId: 'question-1',
      toolCallId: 'tool-call-question',
      answers: ['continue'],
      questionAnswers: [
        {
          question: '是否继续？',
          answers: ['continue']
        }
      ],
      otherText: ''
    });
  });

  it('locks question actions while the answer submission is in flight', async (): Promise<void> => {
    let resolveSubmission: (() => void) | undefined;
    const submission = new Promise<void>((resolve) => {
      resolveSubmission = resolve;
    });
    const submitAction = vi.fn(() => submission);
    const wrapper = mountMessageBubble(
      createAssistantMessage({
        content: '',
        parts: [createQuestionToolPart()]
      }),
      submitAction
    );

    await wrapper.get('.choice-card__option-btn').trigger('click');
    await wrapper.get('.choice-card__footer-right .b-button-stub:last-child').trigger('click');
    const submitButton = wrapper.get('.choice-card__footer-right .b-button-stub:last-child');
    await submitButton.trigger('click');
    await nextTick();

    expect(submitButton.attributes('disabled')).toBeDefined();
    await submitButton.trigger('click');
    expect(submitAction).toHaveBeenCalledTimes(1);

    resolveSubmission?.();
    await flushPromises();
  });

  it('renders open_widget tool parts with widget runtime items', (): void => {
    const toolPart: ChatMessageToolPart = {
      id: 'part0014',
      type: 'tool',
      toolCallId: 'tool-call-widget',
      toolName: 'open_widget',
      status: 'done',
      input: {
        id: 'weather',
        input: {
          city: '上海'
        }
      },
      result: {
        toolName: 'open_widget',
        status: 'success',
        data: {
          sessionId: 'widget-weather-tool-call-widget',
          widgetId: 'weather',
          value: createWeatherWidgetData(),
          renderContext: createWeatherRenderContext(),
          execution: { status: 'success', output: undefined }
        }
      }
    };
    const wrapper = mountMessageBubble(
      createAssistantMessage({
        content: '',
        parts: [toolPart]
      })
    );

    expect(wrapper.text()).toContain('上海');
    expect(wrapper.text()).toContain('28°C');
  });

  it('renders open_widget display results as widget runtime without tool state', (): void => {
    const toolPart: ChatMessageToolPart = {
      id: 'part0014',
      type: 'tool',
      toolCallId: 'tool-call-widget',
      toolName: 'open_widget',
      status: 'done',
      input: {
        id: 'weather',
        input: {
          city: '上海'
        }
      },
      result: {
        toolName: 'open_widget',
        status: 'success',
        data: {
          sessionId: 'widget-weather-tool-call-widget',
          widgetId: 'weather',
          value: createWeatherWidgetData(),
          renderContext: createWeatherRenderContext(),
          execution: { status: 'success', output: undefined }
        }
      }
    };
    const wrapper = mountMessageBubble(
      createAssistantMessage({
        content: '',
        parts: [toolPart]
      })
    );

    expect(wrapper.findComponent({ name: 'BWidgetRuntime' }).exists()).toBe(true);
    expect(wrapper.text()).toContain('上海');
  });

  it('renders main-initialized open_widget tool runtime when scripts are disabled', (): void => {
    const widgetValue: WidgetData = {
      ...createWeatherWidgetData(),
      execute: {
        enabled: false,
        code: 'export default class Weather extends Widget {}'
      }
    };
    const toolPart: ChatMessageToolPart = {
      id: 'part0014',
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
          value: widgetValue,
          renderContext: createWeatherRenderContext(),
          execution: { status: 'success', output: undefined }
        }
      }
    };
    const message = createAssistantMessage({
      id: 'assistant-open-widget',
      content: '',
      parts: [toolPart],
      loading: true,
      finished: false
    });
    const wrapper = mountMessageBubbleWithSilentWidgetRuntime(message);

    expect(wrapper.findComponent({ name: 'BWidgetRuntime' }).exists()).toBe(true);
  });

  it('keeps open_widget render data local without tool part state actions', async (): Promise<void> => {
    const toolPart: ChatMessageToolPart = {
      id: 'part0014',
      type: 'tool',
      toolCallId: 'tool-call-widget',
      toolName: 'open_widget',
      status: 'done',
      input: {
        id: 'weather',
        input: {
          city: '上海'
        }
      },
      result: {
        toolName: 'open_widget',
        status: 'success',
        data: {
          sessionId: 'widget-weather-tool-call-widget',
          widgetId: 'weather',
          value: createWeatherWidgetData(),
          renderContext: createWeatherRenderContext(),
          execution: { status: 'success', output: undefined }
        }
      }
    };
    const message = createAssistantMessage({
      id: 'assistant-open-widget',
      content: '',
      parts: [toolPart]
    });
    const submitContext = createSubmitContextMock();
    const wrapper = mountMessageBubble(message, createSubmitActionRunner(submitContext));

    await flushPromises();

    await emitWidgetRuntimeChange(
      wrapper,
      createRuntimeChange(
        {
          id: 'part0014',
          sessionId: 'widget-weather-tool-call-widget',
          widgetId: 'weather',
          value: createWeatherWidgetData(),
          renderContext: createWeatherRenderContext()
        },
        {
          reason: 'mount',
          renderContext: {
            input: {
              city: '上海'
            },
            output: undefined,
            data: {
              weather: {
                temperature: 29
              }
            }
          }
        }
      )
    );
    await flushPromises();

    expectSubmitContextUpdatesPartOnly(submitContext);
    expect(wrapper.findComponent({ name: 'BWidgetRuntime' }).props('renderContext')).toMatchObject({
      data: {
        weather: {
          temperature: 29
        }
      }
    });
  });

  it('copies user widget result messages from message content when no text part exists', async (): Promise<void> => {
    const widgetResultPart: ChatMessageWidgetResultPart = {
      id: 'part0015',
      type: 'widget_result',
      sessionId: 'widget-session-1',
      widgetId: 'weather',
      submittedAt: '2026-06-30T00:00:00.000Z',
      result: {
        status: 'success',
        data: {
          city: '上海',
          action: 'confirm'
        }
      }
    };
    const content = '小组件已提交：{"city":"上海","action":"confirm"}';
    const wrapper = mountMessageBubble({
      id: 'user-widget-result-1',
      role: 'user',
      content,
      parts: [widgetResultPart],
      createdAt: '2026-06-30T00:00:00.000Z',
      loading: false,
      finished: true
    });

    expect(wrapper.text()).toContain(content);
    await wrapper.get('[data-icon="lucide:copy"]').trigger('click');

    expect(clipboardMock).toHaveBeenCalledWith(content, { successMessage: '已复制到剪贴板' });
  });
});
