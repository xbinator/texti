/**
 * @file platformShortcuts.test.ts
 * @description 验证系统快捷入口的最近文件摘要、命令行参数和菜单模型生成。
 */
import { describe, expect, test } from 'vitest';
import {
  buildRecentFileShortcuts,
  buildShortcutActions,
  parseShortcutActionArg,
  type RecentFileShortcutInput
} from '../../electron/main/modules/platform-shortcuts/model.mjs';

describe('platform shortcut model', () => {
  test('builds bounded recent file shortcuts without document content', () => {
    const storedFiles: Array<RecentFileShortcutInput & { content: string }> = [
      { id: 'a', name: 'Alpha.md', path: '/tmp/alpha.md', content: 'secret' },
      { id: 'b', name: 'Beta.md', path: null, content: 'draft' },
      { id: 'c', name: '', path: '/tmp/gamma.md', content: 'hidden' },
      { id: 'd', name: 'Delta.md', path: '/tmp/delta.md', content: 'hidden' }
    ];

    const shortcuts = buildRecentFileShortcuts(storedFiles, 2);

    expect(shortcuts).toEqual([
      { id: 'a', title: 'Alpha.md', subtitle: '/tmp/alpha.md', action: 'file:openRecent:a' },
      { id: 'b', title: 'Beta.md', subtitle: '未保存文件', action: 'file:openRecent:b' }
    ]);
  });

  test('builds base actions and recent file actions in display order', () => {
    const actions = buildShortcutActions([{ id: 'a', title: 'Alpha.md', subtitle: '/tmp/alpha.md', action: 'file:openRecent:a' }]);

    expect(actions.map((action) => action.action)).toEqual(['file:new', 'file:recent', 'file:openRecent:a']);
  });

  test('parses supported shortcut action arguments only', () => {
    expect(parseShortcutActionArg(['--action=file:new'])).toBe('file:new');
    expect(parseShortcutActionArg(['--foo=bar', '--action=file:openRecent:a'])).toBe('file:openRecent:a');
    expect(parseShortcutActionArg(['--action=theme:dark'])).toBeNull();
  });

  test('clips long titles in the model layer', () => {
    const [shortcut] = buildRecentFileShortcuts([{ id: 'a', name: 'abcdefghijklmnopqrstuvwxyz.md', path: '/tmp/abcdefghijklmnopqrstuvwxyz.md' }], 1);

    expect(shortcut.title).toBe('abcdefghijklmnopqrstuvwx...');
  });
});
