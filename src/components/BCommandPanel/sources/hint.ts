/**
 * @file hint.ts
 * @description BCommandPanel 命令提示 source，输入 ? 时展示可用前缀。
 */
import type { CommandPanelGroup, CommandPanelSource } from '../types';

/** 命令提示分组 key。 */
const HINT_GROUP_KEY = 'hint';

/**
 * 创建命令提示 source，固定返回 > 跳转项。
 * @returns 命令提示 source
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
            key: 'hint:jump',
            kind: 'jump' as const,
            title: '>',
            description: '运行命令',
            hideIcon: true,
            routeInput: '>'
          }
        ]
      }
    ]
  };
}
