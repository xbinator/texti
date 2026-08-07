/**
 * @file bubble-part-tool-activity.component.test.ts
 * @description 工具卡片持久化活动状态与单工具控制动作测试。
 * @vitest-environment jsdom
 */
import type { ChatMessageToolPart } from 'types/chat';
import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import BubblePartTool from '@/components/BChat/components/MessageBubble/BubblePartTool/index.vue';
import type { SubmitContext } from '@/components/BChat/utils/submitAction';

vi.mock('@/hooks/useNavigate', () => ({ useNavigate: (): { openFile: ReturnType<typeof vi.fn> } => ({ openFile: vi.fn() }) }));

/** 测试按钮替身，保留 loading/disabled 和点击语义。 */
const ButtonStub = defineComponent({
  name: 'BButton',
  props: {
    disabled: { type: Boolean, default: false },
    loading: { type: Boolean, default: false }
  },
  emits: ['click'],
  template: '<button :disabled="disabled || loading" @click="$emit(\'click\', $event)"><slot /></button>'
});

/**
 * 创建执行中的工具片段。
 * @param state - 持久化活动状态
 * @returns 工具消息片段
 */
function createPart(state: NonNullable<ChatMessageToolPart['activity']>['state']): ChatMessageToolPart {
  return {
    id: `part-${state}`,
    type: 'tool',
    toolCallId: 'tool-call-1',
    toolName: 'long_renderer_tool',
    status: 'executing',
    input: {},
    activity: {
      state,
      sequence: 4,
      lastProgressAt: Date.now() - 70_000,
      progress: { phase: 'download', completed: 4, total: 10, message: '已下载 4 项', updatedAt: Date.now() - 70_000 },
      userPrompt: '请选择目标文件',
      externalWait: { reason: '等待远端任务', retryAt: Date.now() + 1_000, deadlineAt: Date.now() + 60_000 }
    }
  };
}

/**
 * 挂载工具卡片。
 * @param part - 工具片段
 * @param submitAction - 统一提交函数
 * @param runtimeId - 可选 Runtime ID
 * @returns 组件包装器
 */
function mountTool(part: ChatMessageToolPart, submitAction = vi.fn(), runtimeId: string | undefined = 'runtime-1') {
  return mount(BubblePartTool, {
    props: { part, runtimeId, submitAction },
    global: {
      stubs: {
        BButton: ButtonStub,
        BIcon: true,
        BMessage: true,
        BTruncateText: { props: ['text'], template: '<span>{{ text }}</span>' }
      }
    }
  });
}

describe('BubblePartTool activity', (): void => {
  it('renders only persisted activity status labels', (): void => {
    const executing = mountTool(createPart('executing'));
    expect(executing.text()).toContain('执行中');
    expect(executing.text()).not.toContain('download');
    expect(executing.text()).not.toContain('4 / 10');
    expect(executing.text()).not.toContain('已下载 4 项');
    expect(executing.text()).not.toContain('1 分钟前有进展');

    const waitingUser = mountTool(createPart('waiting_user'));
    expect(waitingUser.text()).toContain('等待用户');
    expect(waitingUser.text()).not.toContain('请选择目标文件');

    const waitingExternal = mountTool(createPart('waiting_external'));
    expect(waitingExternal.text()).toContain('等待外部条件');
    expect(waitingExternal.text()).not.toContain('等待远端任务');

    const labels = new Map<NonNullable<ChatMessageToolPart['activity']>['state'], string>([
      ['running_idle', '仍在运行'],
      ['stopping', '正在停止'],
      ['interrupted', '已中断']
    ]);
    for (const [state, label] of labels) {
      expect(mountTool(createPart(state)).text()).toContain(label);
    }
  });

  it('submits continue and stop actions for the exact runtime tool', async (): Promise<void> => {
    const submitAction = vi.fn();
    const controlRuntimeTool = vi.fn<SubmitContext['controlRuntimeTool']>(() => Promise.resolve());
    const wrapper = mountTool(createPart('running_idle'), submitAction);
    const buttons = wrapper.findAll('button');

    expect(buttons.map((button) => button.text())).toEqual(['继续等待', '停止']);
    await buttons[0]?.trigger('click');
    await buttons[1]?.trigger('click');
    expect(submitAction).toHaveBeenCalledTimes(2);

    const context: SubmitContext = {
      continueAssistantTurn: async (): Promise<void> => undefined,
      controlRuntimeTool,
      sendAdaptedUserMessage: async (): Promise<void> => undefined,
      updateMessagePart: async (): Promise<void> => undefined
    };
    await submitAction.mock.calls[0]?.[0].run(context);
    await submitAction.mock.calls[1]?.[0].run(context);

    expect(controlRuntimeTool).toHaveBeenNthCalledWith(1, {
      runtimeId: 'runtime-1',
      toolCallId: 'tool-call-1',
      action: 'continue_waiting'
    });
    expect(controlRuntimeTool).toHaveBeenNthCalledWith(2, {
      runtimeId: 'runtime-1',
      toolCallId: 'tool-call-1',
      action: 'stop'
    });
  });

  it('hides idle controls without a runtime or after the tool is done', (): void => {
    expect(mountTool(createPart('running_idle'), vi.fn(), '').findAll('button')).toHaveLength(0);
    const donePart: ChatMessageToolPart = {
      ...createPart('running_idle'),
      status: 'done',
      result: { toolName: 'long_renderer_tool', status: 'success', data: {} }
    };
    expect(mountTool(donePart).findAll('button')).toHaveLength(0);
  });
});
