/**
 * @file menu.mts
 * @description 应用系统菜单构建与菜单动作派发。
 */
import { app, Menu, MenuItemConstructorOptions, BrowserWindow } from 'electron';
import { env } from '../../env.mjs';
import { getWindow, isDev } from '../../window.mjs';

const pendingActions: string[] = [];

/**
 * 应用菜单构建选项。
 */
interface AppMenuBuildOptions {
  /** 是否显示重新加载相关开发菜单。 */
  enableReloadMenu?: boolean;
}

/**
 * 判断当前运行环境是否允许显示刷新菜单。
 * @returns 是否显示重新加载相关菜单项
 */
function shouldEnableReloadMenu(): boolean {
  return isDev() && env.TIBIS_ENABLE_RELOAD_MENU;
}

/**
 * 确保窗口可见并聚焦，避免系统快捷入口触发后用户没有可见反馈。
 * @param win - 需要展示的浏览器窗口
 */
function ensureWindowVisible(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

/**
 * 刷新等待页面加载完成后发送的菜单动作。
 * @param win - 接收动作的浏览器窗口
 */
function flushPendingActions(win: BrowserWindow): void {
  while (pendingActions.length > 0) {
    const action = pendingActions.shift();
    if (action) win.webContents.send('ui:menuAction', action);
  }
}

/**
 * 注册页面加载完成后的等待动作刷新逻辑。
 * @param win - 接收动作的浏览器窗口
 */
function registerPendingActionFlush(win: BrowserWindow): void {
  win.webContents.once('did-finish-load', () => {
    flushPendingActions(win);
  });
}

/**
 * 向当前可用窗口发送应用菜单动作。
 * @param action - 菜单动作标识
 */
export function sendMenuAction(action: string): void {
  const win = BrowserWindow.getFocusedWindow() ?? getWindow() ?? BrowserWindow.getAllWindows()[0];

  if (!win) {
    pendingActions.push(action);
    return;
  }

  ensureWindowVisible(win);

  if (win.webContents.isLoadingMainFrame()) {
    pendingActions.push(action);
    registerPendingActionFlush(win);
    return;
  }

  flushPendingActions(win);
  win.webContents.send('ui:menuAction', action);
}

/**
 * 构建应用系统菜单模板。
 * @param isMac - 是否为 macOS 平台
 * @param appName - 应用名称
 * @param options - 应用菜单构建选项
 * @returns Electron 菜单模板
 */
export function buildAppMenuTemplate(isMac: boolean, appName: string, options: AppMenuBuildOptions = {}): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];
  const viewSubmenu: MenuItemConstructorOptions[] = [
    { id: 'view:source', type: 'checkbox', label: '源代码模式', accelerator: 'CmdOrCtrl+E', click: () => sendMenuAction('view:toggleSource') },
    { id: 'view:outline', type: 'checkbox', label: '大纲', click: () => sendMenuAction('view:toggleOutline') },
    { type: 'separator' as const },
    {
      label: '配色方案',
      submenu: [
        { id: 'theme:system', type: 'checkbox', label: '跟随系统', click: () => sendMenuAction('theme:system') },
        { id: 'theme:light', type: 'checkbox', label: '浅色主题', click: () => sendMenuAction('theme:light') },
        { id: 'theme:dark', type: 'checkbox', label: '深色主题', click: () => sendMenuAction('theme:dark') }
      ]
    },
    {
      label: '页宽',
      submenu: [
        { id: 'view:pageWidth:default', type: 'checkbox', label: '默认', click: () => sendMenuAction('view:pageWidth:default') },
        { id: 'view:pageWidth:wide', type: 'checkbox', label: '较宽', click: () => sendMenuAction('view:pageWidth:wide') },
        { id: 'view:pageWidth:full', type: 'checkbox', label: '全宽', click: () => sendMenuAction('view:pageWidth:full') }
      ]
    }
  ];

  // macOS 特有的应用菜单
  if (isMac) {
    template.push({
      label: appName,
      submenu: [
        { role: 'about' as const, label: `关于 ${appName}` },
        { type: 'separator' as const },
        { role: 'services' as const, label: '服务' },
        { type: 'separator' as const },
        { role: 'hide' as const, label: `隐藏 ${appName}` },
        { role: 'hideOthers' as const, label: '隐藏其他' },
        { role: 'unhide' as const, label: '全部显示' },
        { type: 'separator' as const },
        { role: 'quit' as const, label: `退出 ${appName}` }
      ]
    });
  }

  // 文件菜单（所有平台）
  template.push({
    label: '文件',
    submenu: [
      { label: '新建', accelerator: 'CmdOrCtrl+Alt+N', click: () => sendMenuAction('file:new') },
      { type: 'separator' as const },
      { label: '打开...', accelerator: 'CmdOrCtrl+Shift+O', click: () => sendMenuAction('file:open') },
      { label: '打开最近的文件', accelerator: 'CmdOrCtrl+R', click: () => sendMenuAction('file:recent') },
      { type: 'separator' as const },
      { label: '复制为新文件', accelerator: 'CmdOrCtrl+Alt+D', click: () => sendMenuAction('file:duplicate') },
      { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => sendMenuAction('file:save') },
      { label: '另存为...', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenuAction('file:saveAs') },
      { type: 'separator' as const },
      { label: '重命名', accelerator: 'F2', click: () => sendMenuAction('file:rename') },
      { type: 'separator' as const },
      { role: 'close' as const, label: '关闭' }
    ]
  });

  // 编辑菜单（所有平台）- 包含标准的复制、粘贴等
  template.push({
    label: '编辑',
    submenu: [
      { role: 'undo' as const, label: '撤销', accelerator: 'CmdOrCtrl+Z' },
      { role: 'redo' as const, label: '重做', accelerator: 'CmdOrCtrl+Shift+Z' },
      { type: 'separator' as const },
      { role: 'cut' as const, label: '剪切', accelerator: 'CmdOrCtrl+X' },
      { role: 'copy' as const, label: '复制', accelerator: 'CmdOrCtrl+C' },
      { role: 'paste' as const, label: '粘贴', accelerator: 'CmdOrCtrl+V' },
      { role: 'selectAll' as const, label: '全选', accelerator: 'CmdOrCtrl+A' },
      { type: 'separator' as const },
      { label: '复制为纯文本', click: () => sendMenuAction('edit:copy-plain-text') },
      { label: '复制为 Markdown', click: () => sendMenuAction('edit:copy-markdown') },
      { label: '复制为 HTML 代码', click: () => sendMenuAction('edit:copy-html') }
    ]
  });

  if (options.enableReloadMenu === true) {
    viewSubmenu.push(
      { type: 'separator' as const },
      {
        label: '重新加载',
        accelerator: 'CmdOrCtrl+R',
        click: () => {
          const win = BrowserWindow.getFocusedWindow();
          if (win) win.reload();
        }
      },
      {
        label: '强制重新加载',
        accelerator: 'CmdOrCtrl+Shift+R',
        click: () => {
          const win = BrowserWindow.getFocusedWindow();
          if (win) win.webContents.reloadIgnoringCache();
        }
      }
    );
  }

  viewSubmenu.push({ type: 'separator' as const }, { role: 'togglefullscreen' as const, label: '切换全屏' });

  // 视图菜单（所有平台）
  template.push({
    label: '视图',
    submenu: viewSubmenu
  });

  // 帮助菜单（所有平台）
  template.push({
    label: '帮助',
    submenu: [
      { label: '快捷键', accelerator: 'CmdOrCtrl+/', click: () => sendMenuAction('help:shortcuts') },
      { label: '检查更新', click: () => sendMenuAction('help:checkUpdate') },
      { type: 'separator' as const },
      { role: 'toggleDevTools' as const, label: '切换开发者工具' }
    ]
  });

  return template;
}

/**
 * 设置应用系统菜单。
 */
export function setupAppMenu(): void {
  const isMac = process.platform === 'darwin';
  const template = buildAppMenuTemplate(isMac, app.name, { enableReloadMenu: shouldEnableReloadMenu() });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
