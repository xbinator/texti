import { app, Menu, MenuItemConstructorOptions, BrowserWindow } from 'electron';
import { getWindow } from '../../window.mjs';

export function setupAppMenu(): void {
  const isMac = process.platform === 'darwin';

  const getTargetWebContents = () => {
    const win = BrowserWindow.getFocusedWindow() ?? getWindow() ?? BrowserWindow.getAllWindows()[0];
    return win?.webContents;
  };

  const sendAction = (action: string) => {
    const webContents = getTargetWebContents();
    if (webContents) {
      webContents.send('menu:action', action);
    }
  };

  const template: MenuItemConstructorOptions[] = [];

  // macOS 特有的应用菜单
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' as const, label: `关于 ${app.name}` },
        { type: 'separator' as const },
        { role: 'services' as const, label: '服务' },
        { type: 'separator' as const },
        { role: 'hide' as const, label: `隐藏 ${app.name}` },
        { role: 'hideOthers' as const, label: '隐藏其他' },
        { role: 'unhide' as const, label: '全部显示' },
        { type: 'separator' as const },
        { role: 'quit' as const, label: `退出 ${app.name}` }
      ]
    });
  }

  // 文件菜单（所有平台）
  template.push({
    label: '文件',
    submenu: [
      { label: '新建', accelerator: 'CmdOrCtrl+Alt+N', click: () => sendAction('file:new') },
      { type: 'separator' as const },
      { label: '打开...', accelerator: 'CmdOrCtrl+Shift+O', click: () => sendAction('file:open') },
      { label: '打开最近的文件', accelerator: 'CmdOrCtrl+R', click: () => sendAction('file:recent') },
      { type: 'separator' as const },
      { label: '复制为新文件', accelerator: 'CmdOrCtrl+Alt+D', click: () => sendAction('file:duplicate') },
      { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => sendAction('file:save') },
      { label: '另存为...', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendAction('file:saveAs') },
      { type: 'separator' as const },
      { label: '重命名', accelerator: 'F2', click: () => sendAction('file:rename') },
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
      { label: '剪切', accelerator: 'CmdOrCtrl+X', click: () => getTargetWebContents()?.cut() },
      { label: '复制', accelerator: 'CmdOrCtrl+C', click: () => getTargetWebContents()?.copy() },
      { label: '粘贴', accelerator: 'CmdOrCtrl+V', click: () => getTargetWebContents()?.paste() },
      { label: '全选', accelerator: 'CmdOrCtrl+A', click: () => getTargetWebContents()?.selectAll() },
      { type: 'separator' as const },
      { label: '复制为纯文本', click: () => sendAction('edit:copy-plain-text') },
      { label: '复制为 Markdown', click: () => sendAction('edit:copy-markdown') },
      { label: '复制为 HTML 代码', click: () => sendAction('edit:copy-html') }
    ]
  });

  // 视图菜单（所有平台）
  template.push({
    label: '视图',
    submenu: [
      { id: 'view:source', type: 'checkbox', label: '源代码模式', accelerator: 'CmdOrCtrl+E', click: () => sendAction('view:toggleSource') },
      { id: 'view:outline', type: 'checkbox', label: '大纲', click: () => sendAction('view:toggleOutline') },
      { type: 'separator' as const },
      {
        label: '主题',
        submenu: [
          { id: 'theme:light', type: 'checkbox', label: '浅色模式', click: () => sendAction('theme:light') },
          { id: 'theme:dark', type: 'checkbox', label: '深色模式', click: () => sendAction('theme:dark') },
          { id: 'theme:system', type: 'checkbox', label: '跟随系统', click: () => sendAction('theme:system') }
        ]
      },
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
      },
      { role: 'toggleDevTools' as const, label: '切换开发者工具' },
      { type: 'separator' as const },
      { role: 'togglefullscreen' as const, label: '切换全屏' }
    ]
  });

  // 帮助菜单（所有平台）
  template.push({
    label: '帮助',
    submenu: [{ label: '快捷键', accelerator: 'CmdOrCtrl+/', click: () => sendAction('help:shortcuts') }]
  });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
