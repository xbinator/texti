/**
 * @file question-card.component.test.ts
 * @description QuestionCard 输入框模式渲染与提交测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import type { AIAwaitingUserChoiceQuestion } from 'types/ai';
import { defineComponent } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import QuestionCard from '@/components/BChat/components/QuestionCard.vue';
import type { SubmitAction, SubmitContext } from '@/components/BChat/utils/submitAction';

/** BButton 测试替身，保留 disabled 属性便于断言。 */
const BButtonStub = defineComponent({
  name: 'BButton',
  props: {
    disabled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['click'],
  template: '<button class="b-button-stub" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
});

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

/**
 * 创建输入框模式问题载荷。
 * @returns 输入框模式问题
 */
function createInputQuestion(): AIAwaitingUserChoiceQuestion {
  return {
    questionId: 'question-input-1',
    toolCallId: 'tool-call-input',
    question: '请描述你的需求',
    mode: 'input',
    options: [],
    placeholder: '例如：支持微信支付'
  };
}

/**
 * 挂载 QuestionCard 并注入统一提交函数。
 * @param question - 问题载荷
 * @param submitAction - 统一提交函数
 * @returns 组件包装器
 */
function mountCard(question: AIAwaitingUserChoiceQuestion, submitAction: (action: SubmitAction) => Promise<void> | void): VueWrapper {
  return mount(QuestionCard, {
    props: { question, submitAction },
    global: {
      stubs: {
        BButton: BButtonStub
      }
    }
  });
}

describe('QuestionCard input mode', (): void => {
  it('renders a text input with the placeholder for input-mode questions', (): void => {
    const wrapper = mountCard(createInputQuestion(), vi.fn());

    const input = wrapper.get('.choice-card__other');
    expect(input.element.getAttribute('placeholder')).toBe('例如：支持微信支付');
    expect(wrapper.find('.choice-card__option-btn').exists()).toBe(false);
  });

  it('keeps the next button disabled until text is entered', async (): Promise<void> => {
    const wrapper = mountCard(createInputQuestion(), vi.fn());
    const footerButtons = wrapper.findAll('.b-button-stub');

    expect(footerButtons.at(-1)?.element.hasAttribute('disabled')).toBe(true);

    await wrapper.get('.choice-card__other').setValue('接入微信支付');
    await flushPromises();

    expect(footerButtons.at(-1)?.element.hasAttribute('disabled')).toBe(false);
  });

  it('submits the typed text through the unified submit action', async (): Promise<void> => {
    const submitContext = createSubmitContextMock();
    const submitAction = async (action: SubmitAction): Promise<void> => {
      await action.run(submitContext);
    };
    const wrapper = mountCard(createInputQuestion(), submitAction);

    await wrapper.get('.choice-card__other').setValue('  接入微信支付  ');
    await wrapper.findAll('.b-button-stub').at(-1)?.trigger('click');
    await wrapper.findAll('.b-button-stub').at(-1)?.trigger('click');
    await flushPromises();

    expect(submitContext.continueAssistantTurn).toHaveBeenCalledWith({
      questionId: 'question-input-1',
      toolCallId: 'tool-call-input',
      answers: [],
      questionAnswers: [
        {
          question: '请描述你的需求',
          answers: [],
          text: '接入微信支付'
        }
      ],
      otherText: ''
    });
  });

  it('keeps the typed text when navigating back and forward', async (): Promise<void> => {
    const wrapper = mountCard(createInputQuestion(), vi.fn());

    await wrapper.get('.choice-card__other').setValue('保持的文本');
    await wrapper.findAll('.b-button-stub').at(-1)?.trigger('click');
    await wrapper.findAll('.b-button-stub').at(-2)?.trigger('click');

    expect((wrapper.get('.choice-card__other').element as HTMLInputElement).value).toBe('保持的文本');
  });
});
