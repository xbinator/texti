/**
 * @file message-bubble.component.test.ts
 * @description MessageBubble 组件确认卡片集成测试。
 */
/* @vitest-environment jsdom */

import type { Message } from '@/components/BChat/types';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import MessageBubble from '@/components/BChat/components/MessageBubble.vue';

/**
 * BBubble 占位组件，保留默认插槽和命名插槽。
 */
const BubbleStub = defineComponent({
  name: 'BBubble',
  props: {
    placement: {
      type: String,
      required: false,
      default: 'left'
    },
    loading: {
      type: Boolean,
      required: false,
      default: false
    },
    size: {
      type: String,
      required: false,
      default: 'fill'
    }
  },
  template: `
    <div class="bubble-stub" :data-placement="placement" :data-loading="String(loading)" :data-size="size">
      <div class="bubble-stub__header"><slot name="header" /></div>
      <div class="bubble-stub__body"><slot /></div>
      <div class="bubble-stub__toolbar"><slot name="toolbar" /></div>
    </div>
  `
});

/**
 * Markdown 消息占位组件。
 */
const MessageStub = defineComponent({
  name: 'BMessage',
  props: {
    content: {
      type: String,
      required: true
    }
  },
  template: '<div class="message-stub">{{ content }}</div>'
});

/**
 * 图标占位组件。
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
 * 按钮占位组件。
 */
const ButtonStub = defineComponent({
  name: 'BButton',
  emits: ['click'],
  template: '<button type="button" @click="$emit(\'click\', $event)"><slot /></button>'
});

/**
 * 剪贴板 hook mock。
 */
vi.mock('@/hooks/useClipboard', () => ({
  useClipboard: () => ({
    clipboard: vi.fn()
  })
}));

/**
 * 创建带确认片段的消息。
 * @returns assistant 消息
 */
function createMessageWithConfirmation(): Message {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: 'AI 想要插入内容',
    createdAt: '2026-04-22T00:00:00.000Z',
    finished: true,
    parts: [
      {
        type: 'text',
        text: '先看一下变更。'
      },
      {
        type: 'confirmation',
        confirmationId: 'confirmation-1',
        toolName: 'insert_at_cursor',
        title: 'AI 想要插入内容',
        description: 'AI 请求在当前光标位置插入新内容。',
        permission: 'write',
        afterText: 'hello',
        confirmationStatus: 'pending',
        executionStatus: 'idle'
      }
    ]
  };
}

/**
 * 挂载 MessageBubble。
 * @param message - 消息数据
 * @returns 挂载结果
 */
function mountMessageBubble(message: Message): VueWrapper {
  return mount(MessageBubble, {
    props: { message },
    global: {
      stubs: {
        BBubble: BubbleStub,
        BMessage: MessageStub,
        BButton: ButtonStub,
        Icon: IconStub
      }
    }
  });
}

describe('MessageBubble confirmation integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders confirmation parts inside the message flow', () => {
    const wrapper = mountMessageBubble(createMessageWithConfirmation());

    expect(wrapper.text()).toContain('先看一下变更。');
    expect(wrapper.text()).toContain('AI 想要插入内容');
    expect(wrapper.text()).toContain('AI 请求在当前光标位置插入新内容。');
    expect(wrapper.text()).toContain('应用');
    expect(wrapper.text()).toContain('取消');
  });

  it('re-emits confirmation actions from the embedded confirmation card', async () => {
    const wrapper = mountMessageBubble(createMessageWithConfirmation());
    const buttons = wrapper.findAll('button');

    await buttons[0].trigger('click');
    await buttons[1].trigger('click');

    expect(wrapper.emitted('confirmation-action')).toEqual([
      ['confirmation-1', 'approve'],
      ['confirmation-1', 'cancel']
    ]);
  });
});
