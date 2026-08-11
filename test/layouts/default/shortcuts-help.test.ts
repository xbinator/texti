/**
 * @file shortcuts-help.test.ts
 * @description 验证快捷键帮助抽屉覆盖欢迎页快捷入口。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 读取快捷键帮助抽屉源码。
 * @returns 快捷键帮助抽屉 Vue 单文件组件源码
 */
function readShortcutsHelpSource(): string {
  return readFileSync('src/layouts/default/components/ShortcutsHelp.vue', 'utf8');
}

describe('ShortcutsHelp', (): void => {
  it('lists the welcome new chat shortcut', (): void => {
    const source = readShortcutsHelpSource();

    expect(source).toContain("title: '对话操作'");
    expect(source).toContain("{ label: '切换聊天侧栏', shortcut: EditorShortcuts.CHAT_SIDER_TOGGLE }");
    expect(source).toContain("{ label: '新对话', shortcut: EditorShortcuts.CHAT_NEW }");
  });
});
