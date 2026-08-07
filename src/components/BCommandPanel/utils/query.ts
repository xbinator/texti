/**
 * @file query.ts
 * @description 解析 BCommandPanel 输入内容，决定当前应使用的 source 与搜索词。
 */
import type { CommandPanelQueryRoute, CommandPanelScope } from '../types';

/** 查看命令菜单输入。 */
const HINT_INPUT = '?';
/** 模型命令前缀。 */
const MODEL_PREFIX_RE = /^model\s+(.*)$/;
/** 聊天命令前缀。 */
const CHAT_PREFIX_RE = /^chat\s+(.*)$/;

/**
 * 解析命令面板当前输入。
 * @param scope - 打开入口范围
 * @param input - 输入框原始内容
 * @returns source 路由和搜索词
 */
export function parseCommandPanelQuery(scope: CommandPanelScope, input: string): CommandPanelQueryRoute {
  const keyword = input.trim();

  if (scope === 'model') {
    return { sourceId: 'model', keyword };
  }

  if (keyword === HINT_INPUT) {
    return { sourceId: 'hint', keyword: '' };
  }

  const commandInput = input.trimStart();
  const modelMatch = MODEL_PREFIX_RE.exec(commandInput);

  if (modelMatch) {
    return { sourceId: 'model', keyword: (modelMatch[1] ?? '').trim() };
  }

  const chatMatch = CHAT_PREFIX_RE.exec(commandInput);

  if (chatMatch) {
    return { sourceId: 'chat', keyword: (chatMatch[1] ?? '').trim() };
  }

  return { sourceId: 'recent', keyword };
}
