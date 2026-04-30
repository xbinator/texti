/**
 * @file log-filter-bar.component.test.ts
 * @description 验证日志过滤栏的基础筛选布局与绑定。
 */
/* @vitest-environment jsdom */
import { createPinia, setActivePinia } from 'pinia';
import { mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LogFilterBar from '@/views/settings/logger/components/LogFilterBar.vue';
import { useLogViewerStore } from '@/views/settings/logger/stores/logViewer';

vi.mock('@/shared/logger', () => ({
  logger: {
    getLogs: vi.fn().mockResolvedValue([]),
    openLogFolder: vi.fn()
  }
}));

/**
 * 挂载过滤栏组件。
 * @returns 挂载结果。
 */
function mountFilterBar(): VueWrapper {
  return mount(LogFilterBar, {
    global: {
      stubs: {
        BButton: {
          inheritAttrs: false,
          props: ['icon', 'type'],
          emits: ['click'],
          template: '<button type="button" v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>'
        },
        BSelect: {
          inheritAttrs: false,
          props: ['value', 'placeholder', 'allowClear'],
          template: '<div class="b-select-stub" :data-value="value" v-bind="$attrs"><slot /></div>'
        },
        ASelectOption: {
          template: '<div><slot /></div>'
        },
        ADatePicker: {
          inheritAttrs: false,
          props: ['value', 'placeholder'],
          template: '<div class="date-picker-stub" :data-value="value" v-bind="$attrs"></div>'
        },
        AInput: {
          inheritAttrs: false,
          props: ['value', 'placeholder', 'allowClear'],
          template: '<div class="input-stub" :data-value="value" v-bind="$attrs"></div>'
        }
      }
    }
  });
}

describe('LogFilterBar layout', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('renders level, keyword and date filters in a single toolbar row', () => {
    const wrapper = mountFilterBar();

    expect(wrapper.find('.b-select-stub').exists()).toBe(true);
    expect(wrapper.find('.input-stub').exists()).toBe(true);
    expect(wrapper.find('.date-picker-stub').exists()).toBe(true);
    expect(wrapper.find('.log-filter-bar__input').exists()).toBe(true);
    expect(wrapper.find('.log-filter-bar__date').exists()).toBe(true);
  });

  it('shows the header title, count and open-folder action', () => {
    const wrapper = mountFilterBar();

    expect(wrapper.text()).toContain('运行日志');
    expect(wrapper.text()).toContain('共 0 条记录');
    expect(wrapper.text()).toContain('打开目录');
  });

  it('binds current store filter values to the filter controls', () => {
    const store = useLogViewerStore();
    store.filterLevel = 'ERROR';
    store.keyword = 'timeout';
    store.selectedDate = '2026-04-29';

    const wrapper = mountFilterBar();

    expect(wrapper.find('.b-select-stub').attributes('data-value')).toBe('ERROR');
    expect(wrapper.find('.input-stub').attributes('data-value')).toBe('timeout');
    expect(wrapper.find('.date-picker-stub').attributes('data-value')).toBe('2026-04-29');
  });
});
