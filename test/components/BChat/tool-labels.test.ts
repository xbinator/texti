/**
 * @file tool-labels.test.ts
 * @description 验证聊天工具调用的用户可读名称。
 */
import { describe, expect, it } from 'vitest';
import { getActionLabel } from '@/components/BChat/utils/toolLabels';

describe('toolLabels', (): void => {
  it('does not centrally label page-scoped tools', (): void => {
    expect(getActionLabel('operate_webpage')).toEqual({ alias: 'operate_webpage' });
    expect(getActionLabel('read_current_widget')).toEqual({ alias: 'read_current_widget' });
  });

  it('labels grep as content search', (): void => {
    expect(getActionLabel('grep')).toEqual({ alias: '搜索内容' });
  });

  it('labels remaining builtin tool names with readable aliases', (): void => {
    expect(getActionLabel('glob')).toEqual({ alias: '查找文件' });
    expect(getActionLabel('delegate_task')).toEqual({ alias: '委派任务' });
    expect(getActionLabel('open_widget')).toEqual({ alias: '打开小组件' });
    expect(getActionLabel('stage_file_write')).toEqual({ alias: '暂存写入文件' });
    expect(getActionLabel('stage_file_edit')).toEqual({ alias: '暂存修改文件' });
    expect(getActionLabel('ask_user_choice')).toEqual({ alias: '提问' });
  });
});
