/**
 * @file query.ts
 * @description 解析 BCommandPanel 输入内容，决定当前应使用的 source 与搜索词。
 */
import type { CommandPanelQueryRoute, CommandPanelScope } from '../types';

/** 跳转命令前缀。 */
const JUMP_PREFIX = '>';
/** 查看命令提示前缀。 */
const HINT_PREFIX = '?';

/**
 * 解析命令面板当前输入。
 * @param scope - 打开入口范围
 * @param input - 输入框原始内容
 * @returns source 路由和搜索词
 */
export function parseCommandPanelQuery(scope: CommandPanelScope, input: string): CommandPanelQueryRoute {
  const value = input.trim();

  if (scope === 'model') {
    return { sourceId: 'model', keyword: value };
  }

  if (value.startsWith(HINT_PREFIX)) {
    return { sourceId: 'hint', keyword: value.slice(HINT_PREFIX.length).trim() };
  }

  if (!value.startsWith(JUMP_PREFIX)) {
    return { sourceId: 'recent', keyword: value };
  }

  const jumpBody = value.slice(JUMP_PREFIX.length).trimStart();
  const modelMatch = /^model(?:\s+(.*)|\s*)$/.exec(jumpBody);

  if (modelMatch) {
    return { sourceId: 'model', keyword: (modelMatch[1] ?? '').trim() };
  }

  const chatMatch = /^chat(?:\s+(.*)|\s*)$/.exec(jumpBody);

  if (chatMatch) {
    return { sourceId: 'chat', keyword: (chatMatch[1] ?? '').trim() };
  }

  return { sourceId: 'jump', keyword: jumpBody.trim() };
}
