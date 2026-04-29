/**
 * @file log-filter-bar.component.test.ts
 * @description 验证日志过滤栏在不同宽度下的“更多筛选”折叠行为。
 */
/* @vitest-environment jsdom */

import { ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LogFilterBar from '@/views/settings/logger/components/LogFilterBar.vue';
import { useLogViewerStore } from '@/views/settings/logger/stores/logViewer';

/**
 * 响应式窗口宽度桩，用于驱动折叠断点测试。
 */
const windowWidth = ref(1440);

vi.mock('@vueuse/core', () => ({
  useWindowSize: () => ({
    width: windowWidth,
    height: ref(900)
  })
}));

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
          template: '<div class="b-select-stub" v-bind="$attrs"><slot /></div>'
        },
        ASelectOption: {
          template: '<div><slot /></div>'
        },
        ADatePicker: {
          inheritAttrs: false,
          props: ['value', 'placeholder'],
          template: '<div class="date-picker-stub" v-bind="$attrs"></div>'
        },
        AInputSearch: {
          inheritAttrs: false,
          props: ['value', 'placeholder', 'allowClear'],
          template: '<div class="input-search-stub" v-bind="$attrs"></div>'
        },
        ARadioGroup: {
          template: '<div class="radio-group-stub"><slot /></div>'
        },
        ARadioButton: {
          props: ['value'],
          template: '<button type="button"><slot /></button>'
        },
        APopover: {
          props: {
            open: {
              type: Boolean,
              required: false,
              default: false
            }
          },
          template: `
            <div class="popover-stub" :data-open="String(open)">
              <slot />
              <div class="popover-stub__content"><slot name="content" /></div>
            </div>
          `
        }
      }
    }
  });
}

describe('LogFilterBar responsive collapse', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    windowWidth.value = 1440;
  });

  it('keeps scope and date inline on wide layouts', () => {
    const wrapper = mountFilterBar();

    expect(wrapper.find('.log-filter-bar__inline-advanced').exists()).toBe(true);
    expect(wrapper.find('.log-filter-bar__more-trigger').exists()).toBe(false);
    expect(wrapper.find('.log-filter-bar__popover-content').exists()).toBe(false);
  });

  it('shows more-filters trigger and moves advanced filters into popover content on compact width', () => {
    windowWidth.value = 960;

    const wrapper = mountFilterBar();

    expect(wrapper.find('.log-filter-bar__more-trigger').exists()).toBe(true);
    expect(wrapper.find('.log-filter-bar__inline-advanced').exists()).toBe(false);
    expect(wrapper.find('.log-filter-bar__popover-content').exists()).toBe(true);
  });

  it('marks more-filters trigger as active when collapsed filters have values', () => {
    windowWidth.value = 960;

    const store = useLogViewerStore();
    store.filterScope = 'renderer';

    const wrapper = mountFilterBar();

    expect(wrapper.get('.log-filter-bar__more-trigger').classes()).toContain('log-filter-bar__more-trigger--active');
  });
});
