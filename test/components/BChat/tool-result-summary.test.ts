/**
 * @file tool-result-summary.test.ts
 * @description 验证聊天工具结果摘要中的可打开文件元数据。
 */
import type { AIToolExecutionResult } from 'types/ai';
import { describe, expect, it } from 'vitest';
import { getToolResultSummary } from '@/components/BChat/utils/toolResultSummary';

/**
 * 创建成功工具结果。
 * @param toolName - 工具名称
 * @param data - 工具返回数据
 * @returns 工具成功结果
 */
function successResult(toolName: string, data: Record<string, unknown>): AIToolExecutionResult<Record<string, unknown>> {
  return {
    toolName,
    status: 'success',
    data
  };
}

describe('toolResultSummary open file metadata', (): void => {
  it('leaves successful page-scoped results to registered presentation metadata', (): void => {
    expect(getToolResultSummary('read_current_webpage', successResult('read_current_webpage', { title: 'Example' }))).toBeNull();
  });

  it('marks write_file file tag as openable when a file is created', (): void => {
    const summary = getToolResultSummary('write_file', successResult('write_file', { path: '/workspace/docs/report.md', content: '# Report', created: true }));

    expect(summary).toEqual({
      text: '已创建文件',
      tags: [{ label: '文件', value: 'report.md', action: 'openFile', path: '/workspace/docs/report.md' }]
    });
  });

  it('marks edit_file file tag as openable', (): void => {
    const summary = getToolResultSummary('edit_file', successResult('edit_file', { path: '/workspace/src/app.ts', replacedCount: 2 }));

    expect(summary?.tags?.[0]).toEqual({
      label: '文件',
      value: 'app.ts',
      action: 'openFile',
      path: '/workspace/src/app.ts'
    });
  });

  it('marks open_resource file tag as openable only for file resources', (): void => {
    const fileSummary = getToolResultSummary('open_resource', successResult('open_resource', { resourceType: 'file', path: '/workspace/notes/today.md' }));
    const webSummary = getToolResultSummary('open_resource', successResult('open_resource', { resourceType: 'webview', path: 'https://example.com' }));

    expect(fileSummary?.tags).toEqual([{ label: '文件', value: 'today.md', action: 'openFile', path: '/workspace/notes/today.md' }]);
    expect(webSummary?.tags).toEqual([{ label: '网址', value: 'https://example.com' }]);
  });

  it('summarizes read_directory results with directory and entry counts', (): void => {
    const summary = getToolResultSummary(
      'read_directory',
      successResult('read_directory', {
        path: '/workspace/src',
        entries: [
          { name: 'components', path: '/workspace/src/components', type: 'directory' },
          { name: 'main.ts', path: '/workspace/src/main.ts', type: 'file' },
          { name: 'types.ts', path: '/workspace/src/types.ts', type: 'file' }
        ]
      })
    );

    expect(summary).toEqual({
      text: '已读取目录',
      tags: [
        { label: '目录', value: 'src' },
        { label: '条目', value: '3' },
        { label: '文件', value: '2' },
        { label: '子目录', value: '1' }
      ]
    });
  });

  it('summarizes grep results with match and truncation status', (): void => {
    const summary = getToolResultSummary(
      'grep',
      successResult('grep', {
        path: '/workspace/src',
        pattern: 'target',
        include: '**/*.ts',
        count: 2,
        truncated: true,
        incomplete: true,
        warnings: [{ path: '/workspace/src/blocked.ts', reason: 'permission denied' }],
        skippedWarningCount: 3,
        matches: [
          { path: '/workspace/src/a.ts', line: 1, text: 'target' },
          { path: '/workspace/src/b.ts', line: 4, text: 'target again' }
        ]
      })
    );

    expect(summary).toEqual({
      text: '搜索到 2 处匹配',
      tags: [
        { label: '路径', value: 'src' },
        { label: '模式', value: 'target' },
        { label: 'Include', value: '**/*.ts' },
        { label: '结果', value: '已截断' },
        { label: '状态', value: '部分结果' },
        { label: '警告', value: '4' }
      ]
    });
  });

  it('summarizes widget contract results without falling back to raw JSON', (): void => {
    const summary = getToolResultSummary(
      'widget',
      successResult('widget', {
        id: 'movie-on-list',
        name: '正在热映电影列表',
        description: '展示当前正在影院热映的电影列表',
        inputSchema: {
          type: 'object',
          properties: {}
        },
        dataSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            rating: { type: 'number' }
          }
        }
      })
    );

    expect(summary).toEqual({
      text: '已读取小组件: 正在热映电影列表\n展示当前正在影院热映的电影列表'
    });
  });
});
