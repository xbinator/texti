/**
 * @file log-timeline.component.test.ts
 * @description 验证日志时间轴单项组件的新布局结构，确保左侧信息列、中轴圆点和右侧消息卡片存在。
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
 * 挂载时间轴单项组件。
 * @param entry - 日志条目。
 * @param flags - 位置标记。
 * @returns 挂载结果。
 */
function mountTimeline(entry: LogEntry, flags: { isFirst?: boolean; isLast?: boolean; isOnly?: boolean } = {}): VueWrapper {
  return mount(LogTimeline, {
    props: {
      entry,
      ...flags
    },
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
    const wrapper = mountTimeline(createEntry(), { isFirst: true, isLast: true, isOnly: false });

    const item = wrapper.get('.log-timeline__item');

    expect(item.classes()).toContain('log-timeline__item--first');
    expect(item.classes()).toContain('log-timeline__item--last');
    expect(item.get('.log-timeline__meta').text()).toContain('14:32:11');
    expect(item.get('.log-timeline__meta').text()).toContain('渲染进程');
    expect(item.find('.log-timeline__axis-track').exists()).toBe(true);
    expect(item.find('.log-timeline__axis-anchor').exists()).toBe(true);
    expect(item.find('.log-timeline__axis-dot').classes()).toContain('log-timeline__axis-dot--error');
    expect(item.get('.log-timeline__card').text()).toContain('错误');
    expect(item.get('.log-timeline__card').text()).toContain('Failed to fetch ad list');
  });
});
