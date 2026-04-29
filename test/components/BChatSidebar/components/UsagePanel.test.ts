/* @vitest-environment jsdom */
/**
 * @file UsagePanel.test.ts
 * @description UsagePanel state rendering and layout guard tests.
 */
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import UsagePanel from '@/components/BChatSidebar/components/UsagePanel.vue';

describe('UsagePanel', () => {
  test('renders a loading state before usage data arrives', () => {
    const wrapper = mount(UsagePanel, {
      props: {
        loading: true
      }
    });

    expect(wrapper.find('[data-testid="usage-panel-loading"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="usage-panel-data"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="usage-panel-empty"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="usage-panel-error"]').exists()).toBe(false);
  });

  test('renders persisted usage numbers when data is available', () => {
    const wrapper = mount(UsagePanel, {
      props: {
        loading: false,
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20
        }
      }
    });

    expect(wrapper.find('[data-testid="usage-panel-data"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('12');
    expect(wrapper.text()).toContain('8');
    expect(wrapper.text()).toContain('20');
  });

  test('renders an empty state when there is no persisted usage', () => {
    const wrapper = mount(UsagePanel, {
      props: {
        loading: false
      }
    });

    expect(wrapper.find('[data-testid="usage-panel-empty"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="usage-panel-data"]').exists()).toBe(false);
  });

  test('renders an inline error state when the usage lookup fails', () => {
    const wrapper = mount(UsagePanel, {
      props: {
        loading: false,
        error: 'Unable to load usage'
      }
    });

    expect(wrapper.find('[data-testid="usage-panel-error"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Unable to load usage');
  });
});
