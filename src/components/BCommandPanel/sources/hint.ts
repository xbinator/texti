/**
 * @file hint.ts
 * @description BCommandPanel 命令菜单 source，输入 ? 时展示可用命令。
 */
import type { CommandPanelGroup, CommandPanelSource } from '../types';

/** 命令菜单分组 key。 */
const HINT_GROUP_KEY = 'hint';

/**
 * 创建命令菜单 source。
 * @returns 命令菜单 source
 */
export function createHintSource(): CommandPanelSource {
  return {
    id: 'hint',
    load: (): void => undefined,
    search: (): CommandPanelGroup[] => [
      {
        key: HINT_GROUP_KEY,
        items: [
          {
            key: 'hint:model',
            kind: 'jump' as const,
            title: 'model',
            description: '切换当前使用的模型',
            hideIcon: true,
            routeInput: 'model'
          },
          {
            key: 'hint:chat',
            kind: 'jump' as const,
            title: 'chat',
            description: '搜索聊天历史会话',
            hideIcon: true,
            routeInput: 'chat'
          }
        ]
      }
    ]
  };
}
