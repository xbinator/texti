/**
 * @file log-timeline.component.test.ts
 * @description 验证日志时间轴组件的新布局结构，确保左侧信息列、中轴圆点和右侧消息卡片存在。
 */
/* @vitest-environment jsdom */

import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { LogEntry } from '@/shared/logger/types';
import LogTimeline from '@/views/settings/logger/components/LogTimeline.vue';

/**
 * 创建测试日志条目。
 * @param overrides - 覆盖字段。
 * @returns 日志条目。
 */
function createEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: '2026-04-29 14:32:11.123',
    scope: 'renderer',
    level: 'ERROR',
    message: 'Failed to fetch ad list: connection timeout (retry 3/3)',
    ...overrides
  };
}

/**
 * 挂载时间轴组件。
 * @param entries - 日志列表。
 * @returns 挂载结果。
 */
function mountTimeline(entries: LogEntry[]): VueWrapper {
  return mount(LogTimeline, {
    props: { entries },
    global: {
      stubs: {
        ATag: {
          props: ['color'],
          template: '<span class="tag-stub" :data-color="color"><slot /></span>'
        }
      }
    }
  });
}

describe('LogTimeline layout', () => {
  it('renders time and scope in the left column and wraps level plus message inside a content card', () => {
    const wrapper = mountTimeline([
      createEntry(),
      createEntry({
        timestamp: '2026-04-29 14:31:58.456',
        scope: 'main',
        level: 'WARN',
        message: 'Cache hit rate below threshold: 42% (expected >=60%)'
      })
    ]);

    const firstItem = wrapper.get('.log-timeline__item');
    const lastItem = wrapper.findAll('.log-timeline__item')[1];

    expect(firstItem.classes()).toContain('log-timeline__item--first');
    expect(lastItem.classes()).toContain('log-timeline__item--last');
    expect(firstItem.get('.log-timeline__meta').text()).toContain('14:32:11');
    expect(firstItem.get('.log-timeline__meta').text()).toContain('渲染进程');
    expect(firstItem.find('.log-timeline__axis-track').exists()).toBe(true);
    expect(firstItem.find('.log-timeline__axis-anchor').exists()).toBe(true);
    expect(firstItem.find('.log-timeline__axis-dot').classes()).toContain('log-timeline__axis-dot--error');
    expect(firstItem.get('.log-timeline__card').text()).toContain('错误');
    expect(firstItem.get('.log-timeline__card').text()).toContain('Failed to fetch ad list');
  });
});
