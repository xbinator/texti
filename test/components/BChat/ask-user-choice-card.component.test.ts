/**
 * @file ask-user-choice-card.component.test.ts
 * @description 用户选择卡片组件挂载测试。
 */
/* @vitest-environment jsdom */

import type { AIAwaitingUserChoiceQuestion } from 'types/ai';
import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import AskUserChoiceCard from '@/components/BChat/components/AskUserChoiceCard.vue';

/**
 * 创建用户选择问题。
 * @param overrides - 覆盖字段
 * @returns 用户选择问题
 */
function createQuestion(overrides: Partial<AIAwaitingUserChoiceQuestion> = {}): AIAwaitingUserChoiceQuestion {
  return {
    questionId: 'question-1',
    toolCallId: 'tool-call-1',
    mode: 'single',
    question: '请选择渠道',
    options: [
      { label: '官网', value: 'official' },
      { label: '短视频', value: 'video' }
    ],
    allowOther: false,
    ...overrides
  };
}

/**
 * 挂载用户选择卡片。
 * @param question - 用户选择问题
 * @returns 挂载结果
 */
function mountAskUserChoiceCard(question: AIAwaitingUserChoiceQuestion): VueWrapper {
  return mount(AskUserChoiceCard, {
    props: { question },
    global: {
      stubs: {
        BButton: {
          emits: ['click'],
          template: '<button type="button" @click="$emit(\'click\', $event)"><slot /></button>'
        }
      }
    }
  });
}

describe('AskUserChoiceCard', () => {
  it('emits a single selected answer', async () => {
    const wrapper = mountAskUserChoiceCard(createQuestion());

    await wrapper.find('input[value="official"]').setValue(true);
    await wrapper.find('button').trigger('click');

    expect(wrapper.emitted('submit-choice')).toEqual([
      [{
        questionId: 'question-1',
        toolCallId: 'tool-call-1',
        answers: ['official'],
        otherText: ''
      }]
    ]);
  });

  it('limits multiple selected answers by maxSelections', async () => {
    const wrapper = mountAskUserChoiceCard(createQuestion({ mode: 'multiple', maxSelections: 1 }));
    const checkboxes = wrapper.findAll('input[type="checkbox"]');

    await checkboxes[0].setValue(true);
    await nextTick();
    const updatedCheckboxes = wrapper.findAll('input[type="checkbox"]');

    expect((updatedCheckboxes[1].element as HTMLInputElement).disabled).toBe(true);
  });

  it('submits other text when manual input is enabled', async () => {
    const wrapper = mountAskUserChoiceCard(createQuestion({ allowOther: true }));

    await wrapper.find('input[type="text"]').setValue('线下活动');
    await wrapper.find('button').trigger('click');

    expect(wrapper.emitted('submit-choice')).toEqual([
      [{
        questionId: 'question-1',
        toolCallId: 'tool-call-1',
        answers: [],
        otherText: '线下活动'
      }]
    ]);
  });
});
