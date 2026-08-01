/**
 * @file bubble-part-user-input.test.ts
 * @description 用户输入气泡 content 展示测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import BubblePartUserInput from '@/components/BChat/components/MessageBubble/BubblePartUserInput/index.vue';

const openSkillMock = vi.hoisted(() => vi.fn<(skillName: string) => void>());

vi.mock('@/hooks/useNavigate', () => ({
  useNavigate: vi.fn(() => ({
    openFile: vi.fn(),
    openSkill: openSkillMock
  }))
}));

/** 最近记录图标测试替身，保留文件名与尺寸用于断言。 */
const BRecentIconStub = defineComponent({
  name: 'BRecentIcon',
  props: {
    fileName: {
      type: String,
      default: ''
    },
    size: {
      type: [Number, String],
      default: ''
    }
  },
  template: '<i class="b-recent-icon-stub" :data-file-name="fileName" :data-size="size"></i>'
});

/** 通用图标测试替身，保留图标名称与尺寸用于断言。 */
const BIconStub = defineComponent({
  name: 'BIcon',
  props: {
    icon: {
      type: String,
      default: ''
    },
    size: {
      type: [Number, String],
      default: ''
    }
  },
  template: '<i class="b-icon-stub" :data-icon="icon" :data-size="size"></i>'
});

describe('BubblePartUserInput', (): void => {
  it('renders content text and file reference chips from the original user input', (): void => {
    const wrapper = mount(BubblePartUserInput, {
      props: {
        part: { id: 'text-file-range', type: 'text', text: 'fix {{@src/foo.ts#L10-20}} please' }
      }
    });

    expect(wrapper.text()).toContain('fix');
    expect(wrapper.text()).toContain('foo.ts');
    expect(wrapper.text()).toContain('10-20');
    expect(wrapper.text()).toContain('please');
  });

  it('renders file reference chips with the shared recent icon component', (): void => {
    const wrapper = mount(BubblePartUserInput, {
      props: {
        part: { id: 'text-file', type: 'text', text: 'read {{@package.json}}' }
      },
      global: {
        stubs: {
          BRecentIcon: BRecentIconStub
        }
      }
    });

    const icon = wrapper.find('.b-recent-icon-stub');

    expect(icon.attributes('data-file-name')).toBe('package.json');
    expect(icon.attributes('data-size')).toBe('14');
  });

  it('renders unencoded file references with spaces as chips', (): void => {
    const wrapper = mount(BubblePartUserInput, {
      props: {
        part: {
          id: 'text-file-spaces',
          type: 'text',
          text: 'read {{@/home/user/Desktop/Markdown 语法全量渲染测试.md}}'
        }
      },
      global: {
        stubs: {
          BRecentIcon: BRecentIconStub
        }
      }
    });

    const icon = wrapper.find('.b-recent-icon-stub');

    expect(wrapper.text()).toContain('Markdown 语法全量渲染测试.md');
    expect(icon.attributes('data-file-name')).toBe('Markdown 语法全量渲染测试.md');
  });

  it('renders clickable skill tokens with the shared hammer icon style', async (): Promise<void> => {
    const wrapper = mount(BubblePartUserInput, {
      props: {
        part: { id: 'text-skill-reference', type: 'text', text: '使用 {{$天气}} 查询上海' }
      },
      global: {
        stubs: {
          BIcon: BIconStub
        }
      }
    });

    const icon = wrapper.find('.b-icon-stub');

    expect(wrapper.find('.b-skill-reference').exists()).toBe(true);
    expect(wrapper.find('.b-skill-reference__icon').exists()).toBe(true);
    expect(icon.attributes('data-icon')).toBe('lucide:hammer');
    expect(icon.attributes('data-size')).toBe('13');
    expect(wrapper.find('.b-skill-reference__name').text()).toBe('天气');
    expect(wrapper.find('.b-skill-reference').attributes('role')).toBe('button');
    expect(wrapper.find('.b-skill-reference').attributes('tabindex')).toBe('0');
    expect(wrapper.text()).toBe('使用 天气 查询上海');
    expect(wrapper.text()).not.toContain('$');

    await wrapper.find('.b-skill-reference').trigger('click');

    expect(openSkillMock).toHaveBeenCalledWith('天气');
  });
});
