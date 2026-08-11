/**
 * @file bubble-part-thinking.test.ts
 * @description BChat 思考片段 Markdown 渲染测试。
 * @vitest-environment jsdom
 */
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import BubblePartThinking from '@/components/BChat/components/MessageBubble/BubblePartThinking/index.vue';
import BMessage from '@/components/BMessage/index.vue';

vi.mock('@/hooks/useImagePreview', () => ({
  useImagePreview: vi.fn(() => ({
    previewImage: vi.fn()
  }))
}));

vi.mock('@/hooks/useNavigate', () => ({
  useNavigate: vi.fn(() => ({
    onLink: vi.fn()
  }))
}));

vi.mock('@/hooks/useClipboard', () => ({
  useClipboard: vi.fn(() => ({
    clipboard: vi.fn()
  }))
}));

describe('BubblePartThinking', (): void => {
  it('renders thinking content with the shared markdown renderer', async (): Promise<void> => {
    const wrapper = mount(BubblePartThinking, {
      props: {
        part: {
          id: 'thinking-part-markdown',
          type: 'thinking',
          thinking: '**bold thinking**\n\n```ts\nconst value = 1\n```'
        }
      },
      global: {
        components: {
          BMessage
        },
        stubs: {
          BIcon: true
        }
      }
    });

    await new Promise<void>((resolve: () => void): void => {
      requestAnimationFrame((): void => resolve());
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('strong').text()).toBe('bold thinking');
    expect(wrapper.find('.b-message__code-block').exists()).toBe(true);
    expect(wrapper.find('.hljs-keyword').exists()).toBe(true);
  });

  it('forwards the precise streaming state to BMessage', (): void => {
    const wrapper = mount(BubblePartThinking, {
      props: {
        part: { id: 'thinking-streaming', type: 'thinking', thinking: 'still growing' },
        streaming: true
      },
      global: {
        stubs: {
          BIcon: true,
          BMessage: {
            props: ['content', 'loading'],
            template: '<div class="thinking-message-stub" :data-loading="loading">{{ content }}</div>'
          }
        }
      }
    });

    expect(wrapper.find('.thinking-message-stub').attributes('data-loading')).toBe('true');
  });
});
