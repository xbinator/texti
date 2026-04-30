/**
 * @file log-filter-bar.component.test.ts
 * @description 验证日志过滤栏在受控组件模式下的基础布局与筛选变更事件。
 */
/* @vitest-environment jsdom */
/* eslint-disable vue/one-component-per-file, vue/require-prop-types */
import { defineComponent } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import LogFilterBar, { type LogFilterBarDataItem } from '@/views/settings/logger/components/LogFilterBar.vue';

vi.mock('@/shared/logger', () => ({
  logger: {
    getLogs: vi.fn().mockResolvedValue([]),
    openLogFolder: vi.fn()
  }
}));

/**
 * 挂载过滤栏组件。
 * @param props - 组件属性。
 * @returns 挂载结果。
 */
function mountFilterBar(
  props: {
    count?: number;
    value?: LogFilterBarDataItem;
    availableDates?: string[];
  } = {}
): VueWrapper {
  return mount(LogFilterBar, {
    props: {
      count: 0,
      availableDates: [],
      value: {
        level: '',
        keyword: '',
        date: ''
      },
      ...props
    },
    global: {
      stubs: {
        BButton: defineComponent({
          name: 'BButton',
          inheritAttrs: false,
          props: ['icon', 'type'],
          emits: ['click'],
          template: '<button type="button" v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>'
        }),
        BSelect: defineComponent({
          name: 'BSelect',
          inheritAttrs: false,
          props: ['value', 'placeholder', 'allowClear'],
          emits: ['update:value'],
          template:
            '<button type="button" class="b-select-stub" :data-value="value" v-bind="$attrs" @click="$emit(\'update:value\', \'ERROR\')"><slot /></button>'
        }),
        ASelectOption: defineComponent({
          name: 'ASelectOption',
          template: '<div><slot /></div>'
        }),
        ADatePicker: defineComponent({
          name: 'ADatePicker',
          inheritAttrs: false,
          props: ['value', 'placeholder', 'disabledDate', 'allowClear'],
          emits: ['update:value'],
          template: `
            <button
              type="button"
              class="date-picker-stub"
              :data-value="value"
              :data-allow-clear="String(allowClear)"
              v-bind="$attrs"
              @click="$emit('update:value', '2026-04-30')"
            ></button>
          `
        }),
        AInput: defineComponent({
          name: 'AInput',
          inheritAttrs: false,
          props: ['value', 'placeholder', 'allowClear'],
          emits: ['update:value'],
          template: '<button type="button" class="input-stub" :data-value="value" v-bind="$attrs" @click="$emit(\'update:value\', \'timeout\')"></button>'
        })
      }
    }
  });
}

describe('LogFilterBar layout', () => {
  it('renders level, keyword and date filters in a single toolbar row', () => {
    const wrapper = mountFilterBar();

    expect(wrapper.find('.b-select-stub').exists()).toBe(true);
    expect(wrapper.find('.input-stub').exists()).toBe(true);
    expect(wrapper.find('.date-picker-stub').exists()).toBe(true);
    expect(wrapper.find('.log-filter-bar__input').exists()).toBe(true);
    expect(wrapper.find('.log-filter-bar__date').exists()).toBe(true);
  });

  it('shows the header title, count and open-folder action', () => {
    const wrapper = mountFilterBar({ count: 3 });

    expect(wrapper.text()).toContain('运行日志');
    expect(wrapper.text()).toContain('共 3 条记录');
    expect(wrapper.text()).toContain('打开目录');
  });

  it('binds incoming props to the filter controls', () => {
    const wrapper = mountFilterBar({
      count: 3,
      availableDates: ['2026-04-29', '2026-04-30'],
      value: {
        level: 'ERROR',
        keyword: 'timeout',
        date: '2026-04-29'
      }
    });

    expect(wrapper.find('.b-select-stub').attributes('data-value')).toBe('ERROR');
    expect(wrapper.find('.input-stub').attributes('data-value')).toBe('timeout');
    expect(wrapper.find('.date-picker-stub').attributes('data-value')).toBe('2026-04-29');
  });

  it('disables clearing the selected date and exposes a disabled-date rule', () => {
    const wrapper = mountFilterBar({
      availableDates: ['2026-04-29'],
      value: {
        level: '',
        keyword: '',
        date: '2026-04-29'
      }
    });

    const datePicker = wrapper.getComponent({ name: 'ADatePicker' });
    const disabledDate = datePicker.props('disabledDate') as ((current: { format: (pattern: string) => string }) => boolean) | undefined;

    expect(wrapper.find('.date-picker-stub').attributes('data-allow-clear')).toBe('false');
    expect(typeof disabledDate).toBe('function');
    expect(disabledDate?.({ format: () => '2026-04-29' })).toBe(false);
    expect(disabledDate?.({ format: () => '2026-04-28' })).toBe(true);
  });

  it('emits model updates and change events when the user changes filters', async () => {
    const wrapper = mountFilterBar();

    await wrapper.find('.b-select-stub').trigger('click');
    await wrapper.setProps({ value: { level: 'ERROR', keyword: '', date: '' } });
    await wrapper.find('.input-stub').trigger('click');
    await wrapper.setProps({ value: { level: 'ERROR', keyword: 'timeout', date: '' } });
    await wrapper.find('.date-picker-stub').trigger('click');

    expect(wrapper.emitted('update:value')).toEqual([
      [{ level: 'ERROR', keyword: '', date: '' }],
      [{ level: 'ERROR', keyword: 'timeout', date: '' }],
      [{ level: 'ERROR', keyword: 'timeout', date: '2026-04-30' }]
    ]);
    expect(wrapper.emitted('change')).toEqual([
      [{ level: 'ERROR', keyword: '', date: '' }],
      [{ level: 'ERROR', keyword: 'timeout', date: '' }],
      [{ level: 'ERROR', keyword: 'timeout', date: '2026-04-30' }]
    ]);
  });

  it('ignores empty date updates so the selected day cannot be deleted', async () => {
    const wrapper = mountFilterBar({
      value: {
        level: '',
        keyword: '',
        date: '2026-04-30'
      }
    });

    await wrapper.getComponent({ name: 'ADatePicker' }).vm.$emit('update:value', '');

    expect(wrapper.emitted('update:value')).toBeUndefined();
    expect(wrapper.emitted('change')).toBeUndefined();
  });
});
