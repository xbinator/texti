/**
 * @file message-bubble-part-text.component.test.ts
 * @description MessageBubblePartText file-reference 渲染行为测试。
 */
/* @vitest-environment jsdom */

import type { Message } from '@/components/BChatSidebar/utils/types';
import type { ChatMessageFileReference, ChatMessageTextPart } from 'types/chat';
import { defineComponent } from 'vue';
import { describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import MessageBubble from '@/components/BChatSidebar/components/MessageBubble.vue';
import MessageBubblePartText from '@/components/BChatSidebar/components/MessageBubblePartText.vue';

/**
 * Markdown 消息占位组件，用于观察 assistant 文本是否仍按原路径渲染。
 */
const MessageStub = defineComponent({
  name: 'BMessage',
  props: {
    content: {
      type: String,
      required: true
    },
    type: {
      type: String,
      required: false,
      default: ''
    },
    loading: {
      type: Boolean,
      required: false,
      default: false
    }
  },
  template: '<div class="message-stub" :data-type="type" :data-loading="String(loading)">{{ content }}</div>'
});

/**
 * BBubble 占位组件，保留默认插槽内容。
 */
const BubbleStub = defineComponent({
  name: 'BBubble',
  template: '<div class="bubble-stub"><slot name="header" /><slot /><slot name="toolbar" /></div>'
});

/**
 * 按钮占位组件。
 */
const ButtonStub = defineComponent({
  name: 'BButton',
  template: '<button type="button"><slot /></button>'
});

/**
 * 图标占位组件。
 */
const IconStub = defineComponent({
  name: 'Icon',
  template: '<i></i>'
});

/**
 * 创建测试用文件引用。
 * @param overrides - 覆盖字段。
 * @returns 文件引用对象。
 */
function createReference(overrides: Partial<ChatMessageFileReference> = {}): ChatMessageFileReference {
  return {
    id: 'reference-1',
    token: '{{file-ref:ref_123}}',
    documentId: 'document-1',
    fileName: 'demo.ts',
    line: '12-14',
    path: 'src/demo.ts',
    snapshotId: 'snapshot-1',
    ...overrides
  };
}

/**
 * 挂载文本片段组件。
 * @param options - 挂载参数。
 * @returns 挂载结果。
 */
function mountTextPart(options: {
  part: ChatMessageTextPart;
  loading?: boolean;
  enableFileReferenceChips?: boolean;
  references?: ChatMessageFileReference[];
}): VueWrapper {
  return mount(MessageBubblePartText, {
    props: {
      loading: false,
      enableFileReferenceChips: false,
      references: [],
      ...options
    },
    global: {
      stubs: {
        BMessage: MessageStub
      }
    }
  });
}

/**
 * 挂载消息气泡组件。
 * @param message - 测试消息。
 * @returns 挂载结果。
 */
function mountBubble(message: Message): VueWrapper {
  return mount(MessageBubble, {
    props: { message },
    global: {
      stubs: {
        BBubble: BubbleStub,
        BButton: ButtonStub,
        BMessage: MessageStub,
        Icon: IconStub,
        MessageBubblePartThinking: true,
        MessageBubblePartToolCall: true,
        MessageBubblePartToolResult: true,
        AskUserChoiceCard: true,
        ConfirmationCard: true
      }
    }
  });
}

describe('MessageBubblePartText file references', () => {
  it('renders matched user file-reference placeholders as read-only chips', () => {
    const wrapper = mountTextPart({
      part: { type: 'text', text: '请查看 {{file-ref:ref_123}} 的实现' },
      enableFileReferenceChips: true,
      references: [createReference()]
    });

    const chip = wrapper.get('.b-prompt-editor-tag--file-reference');

    expect(chip.text()).toBe('demo.ts:12-14');
    expect(chip.attributes('contenteditable')).toBe('false');
    expect(wrapper.find('.message-stub').exists()).toBe(false);
    expect(wrapper.text()).toContain('请查看');
    expect(wrapper.text()).toContain('的实现');
  });

  it('falls back to the raw token when no reference mapping is available', () => {
    const wrapper = mountTextPart({
      part: { type: 'text', text: '请查看 {{file-ref:ref_missing}} 的实现' },
      enableFileReferenceChips: true,
      references: [createReference()]
    });

    expect(wrapper.find('.b-prompt-editor-tag--file-reference').exists()).toBe(false);
    expect(wrapper.text()).toContain('{{file-ref:ref_missing}}');
  });

  it('keeps assistant text on the existing markdown rendering path', () => {
    const wrapper = mountBubble({
      id: 'assistant-1',
      role: 'assistant',
      content: '请查看 {{file-ref:ref_123}}',
      createdAt: '2026-04-25T00:00:00.000Z',
      parts: [{ type: 'text', text: '请查看 {{file-ref:ref_123}}' }],
      references: [createReference()]
    });

    const message = wrapper.get('.message-stub');

    expect(message.attributes('data-type')).toBe('markdown');
    expect(message.text()).toContain('{{file-ref:ref_123}}');
    expect(wrapper.find('.b-prompt-editor-tag--file-reference').exists()).toBe(false);
  });
});
