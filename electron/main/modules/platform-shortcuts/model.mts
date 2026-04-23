/**
 * @file model.mts
 * @description 生成跨平台快捷入口所需的安全动作模型。
 */

/**
 * 最近文件的最小输入信息。
 */
export interface RecentFileShortcutInput {
  /** 文件唯一标识 */
  id: string;
  /** 文件名 */
  name: string;
  /** 文件路径，未保存文件为空 */
  path: string | null;
}

/**
 * 系统快捷入口展示的最近文件摘要。
 */
export interface RecentFileShortcut {
  /** 文件唯一标识 */
  id: string;
  /** 菜单展示标题 */
  title: string;
  /** 菜单辅助说明 */
  subtitle: string;
  /** 点击后发送给渲染进程的动作 */
  action: string;
}

/**
 * 系统快捷入口动作。
 */
export interface PlatformShortcutAction {
  /** 菜单展示标题 */
  title: string;
  /** 菜单辅助说明 */
  subtitle: string;
  /** 点击后发送给渲染进程的动作 */
  action: string;
}

const SUPPORTED_ACTION_PATTERN = /^file:(new|recent|openRecent:[A-Za-z0-9_-]+)$/;
const MAX_TITLE_LENGTH = 27;

/**
 * 裁剪系统菜单标题，避免 Dock 菜单和 Jump List 出现过长文本。
 * @param title - 原始标题
 * @returns 适合系统快捷入口展示的标题
 */
function clipTitle(title: string): string {
  if (title.length <= MAX_TITLE_LENGTH) return title;

  return `${title.slice(0, MAX_TITLE_LENGTH - 3)}...`;
}

/**
 * 构建最近文件快捷入口摘要，避免把文件正文同步到主进程菜单模型。
 * @param files - 最近文件列表
 * @param limit - 最大展示数量
 * @returns 最近文件快捷入口摘要
 */
export function buildRecentFileShortcuts(files: RecentFileShortcutInput[], limit: number): RecentFileShortcut[] {
  return files.slice(0, limit).map((file) => {
    const fallbackTitle = file.path ? file.path.split(/[\\/]/).pop() || file.id : file.id;
    const title = clipTitle(file.name.trim() || fallbackTitle);

    return {
      id: file.id,
      title,
      subtitle: file.path ?? '未保存文件',
      action: `file:openRecent:${file.id}`
    };
  });
}

/**
 * 按展示顺序构建基础动作和最近文件动作。
 * @param recentFiles - 最近文件快捷入口摘要
 * @returns 系统快捷入口动作列表
 */
export function buildShortcutActions(recentFiles: RecentFileShortcut[]): PlatformShortcutAction[] {
  return [
    { title: '新建', subtitle: '新建文档', action: 'file:new' },
    { title: '打开最近的文件', subtitle: '打开最近文件列表', action: 'file:recent' },
    ...recentFiles.map((file) => ({
      title: file.title,
      subtitle: file.subtitle,
      action: file.action
    }))
  ];
}

/**
 * 从命令行参数中解析 Windows 任务栏动作。
 * @param argv - 命令行参数数组
 * @returns 支持的动作，不存在或不受支持时返回 null
 */
export function parseShortcutActionArg(argv: string[]): string | null {
  const actionArg = argv.find((arg) => arg.startsWith('--action='));
  if (!actionArg) return null;

  const action = actionArg.slice('--action='.length);

  return SUPPORTED_ACTION_PATTERN.test(action) ? action : null;
}
