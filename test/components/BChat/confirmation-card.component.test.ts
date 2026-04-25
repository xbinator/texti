/**
 * @file confirmation-card.component.test.ts
 * @description 确认卡片组件挂载测试。
 */
/* @vitest-environment jsdom */

import type { ChatMessageConfirmationPart } from 'types/chat';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import ConfirmationCard from '@/components/BChatSidebar/components/ConfirmationCard.vue';

/**
 * 图标占位组件，避免测试依赖真实图标渲染。
 */
const IconStub = defineComponent({
  name: 'Icon',
  props: {
    icon: {
      type: String,
      required: false,
      default: ''
    }
  },
  template: '<i :data-icon="icon"></i>'
});

/**
 * 按钮占位组件，保留点击行为用于确认事件测试。
 */
const ButtonStub = defineComponent({
  name: 'BButton',
  emits: ['click'],
  template: '<button type="button" @click="$emit(\'click\', $event)"><slot /></button>'
});

/**
 * 创建确认片段。
 * @param overrides - 覆盖字段
 * @returns 确认片段
 */
function createConfirmationPart(overrides: Partial<ChatMessageConfirmationPart> = {}): ChatMessageConfirmationPart {
  return {
    type: 'confirmation',
    confirmationId: 'confirmation-1',
    toolName: 'insert_at_cursor',
    title: 'AI 想要插入内容',
    description: 'AI 请求在当前光标位置插入新内容。',
    riskLevel: 'write',
    afterText: 'hello',
    confirmationStatus: 'pending',
    executionStatus: 'idle',
    ...overrides
  };
}

/**
 * 挂载确认卡片组件。
 * @param part - 确认卡片片段
 * @returns 挂载结果
 */
function mountConfirmationCard(part: ChatMessageConfirmationPart): VueWrapper {
  return mount(ConfirmationCard, {
    props: { part },
    global: {
      stubs: {
        Icon: IconStub,
        BButton: ButtonStub
      }
    }
  });
}

describe('ConfirmationCard', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows pending confirmations expanded by default', () => {
    const wrapper = mountConfirmationCard(createConfirmationPart());

    expect(wrapper.text()).toContain('AI 请求在当前光标位置插入新内容。');
    expect(wrapper.text()).toContain('应用');
    expect(wrapper.text()).toContain('取消');
  });

  it('collapses approved confirmations by default and expands after title click', async () => {
    const wrapper = mountConfirmationCard(createConfirmationPart({
      confirmationStatus: 'approved',
      executionStatus: 'success'
    }));

    expect(wrapper.text()).not.toContain('AI 请求在当前光标位置插入新内容。');

    await wrapper.get('.b-confirmation-card__title').trigger('click');

    expect(wrapper.text()).toContain('AI 请求在当前光标位置插入新内容。');
    expect(wrapper.text()).toContain('已应用到文档。');
  });

  it('collapses a pending confirmation after title click', async () => {
    const wrapper = mountConfirmationCard(createConfirmationPart());

    await wrapper.get('.b-confirmation-card__title').trigger('click');

    expect(wrapper.text()).not.toContain('AI 请求在当前光标位置插入新内容。');
    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  it('emits approve and cancel actions from footer buttons', async () => {
    const wrapper = mountConfirmationCard(createConfirmationPart());
    const buttons = wrapper.findAll('button');

    await buttons[0].trigger('click');
    await buttons[1].trigger('click');

    expect(wrapper.emitted('confirmation-action')).toEqual([
      [{ confirmationId: 'confirmation-1', action: 'approve' }],
      [{ confirmationId: 'confirmation-1', action: 'cancel' }]
    ]);
  });
});
