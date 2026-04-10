/**
 * Electron 主进程入口文件
 * 负责创建应用窗口、设置 IPC 通信、初始化数据库和存储
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { initDatabase, closeDatabase, dbExecute, dbSelect } from './database.mjs';
import { migrateFromTauri } from './migration.mjs';
import { initStore, getStore } from './store.mjs';

// 获取当前文件的目录路径（ESM 模式下替代 __dirname）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 主窗口实例引用
let mainWindow: BrowserWindow | null = null;

/**
 * 创建主应用窗口
 * 配置窗口尺寸、标题栏样式、预加载脚本等
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Texti',
    // macOS 使用无边框窗口，自定义标题栏
    frame: false,
    // 隐藏默认标题栏
    titleBarStyle: 'hidden',
    // trafficLightPosition: macOS 窗口控制按钮位置（标题栏高度36px，垂直居中）
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'), // 预加载脚本路径
      contextIsolation: true, // 启用上下文隔离（安全要求）
      nodeIntegration: false, // 禁用 Node 集成（安全要求）
      sandbox: false // 禁用沙箱以允许某些原生操作
    }
  });

  // 检测是否为开发模式（未打包或环境变量标记）
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    // 开发模式：加载 Vite 开发服务器
    mainWindow.loadURL('http://localhost:1420');
    mainWindow.webContents.openDevTools(); // 自动打开开发者工具
  } else {
    // 生产模式：加载打包后的 HTML 文件
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  // 窗口关闭时清理引用
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * 设置 IPC 通信处理器
 * 处理来自渲染进程的各种请求：文件操作、数据库、存储、窗口控制等
 */
function setupIpcHandlers(): void {
  // 打开文件对话框
  ipcMain.handle('dialog:openFile', async (_event, options?: { filters?: Array<{ name: string; extensions: string[] }> }) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: options?.filters || [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    });

    if (result.canceled || !result.filePaths.length) {
      return { canceled: true, filePath: null, content: '' };
    }

    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, 'utf-8');
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).slice(1);

    return { canceled: false, filePath, content, fileName, ext };
  });

  // 保存文件对话框
  ipcMain.handle(
    'dialog:saveFile',
    async (_event, content: string, filePath?: string, options?: { filters?: Array<{ name: string; extensions: string[] }>; defaultPath?: string }) => {
      if (filePath) {
        await fs.writeFile(filePath, content, 'utf-8');
        return filePath;
      }

      const result = await dialog.showSaveDialog({
        filters: options?.filters || [{ name: 'Markdown', extensions: ['md'] }],
        defaultPath: options?.defaultPath || 'untitled.md'
      });

      if (result.canceled || !result.filePath) {
        return null;
      }

      await fs.writeFile(result.filePath, content, 'utf-8');
      return result.filePath;
    }
  );

  // 直接写入文件（用于已知路径的保存）
  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    await fs.writeFile(filePath, content, 'utf-8');
  });

  // 设置窗口标题
  ipcMain.handle('window:setTitle', async (_event, title: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      win.setTitle(title);
    }
  });

  // 执行数据库写操作（INSERT/UPDATE/DELETE）
  ipcMain.handle('db:execute', async (_event, sql: string, params?: unknown[]) => {
    return dbExecute(sql, params);
  });

  // 执行数据库查询操作（SELECT）
  ipcMain.handle('db:select', async (_event, sql: string, params?: unknown[]) => {
    return dbSelect(sql, params);
  });

  // 从安全存储读取数据
  ipcMain.handle('store:get', async (_event, key: string) => {
    return getStore().get(key);
  });

  // 写入安全存储
  ipcMain.handle('store:set', async (_event, key: string, value: unknown) => {
    getStore().set(key, value);
  });

  // 删除安全存储中的数据
  ipcMain.handle('store:delete', async (_event, key: string) => {
    getStore().delete(key);
  });

  // 使用系统默认浏览器打开外部链接
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    await shell.openExternal(url);
  });

  // 最小化窗口
  ipcMain.handle('window:minimize', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      win.minimize();
    }
  });

  // 最大化/恢复窗口
  ipcMain.handle('window:maximize', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  // 关闭窗口
  ipcMain.handle('window:close', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      win.close();
    }
  });

  // 查询窗口是否已最大化
  ipcMain.handle('window:isMaximized', async () => {
    const win = BrowserWindow.getFocusedWindow();
    return win ? win.isMaximized() : false;
  });
}

// 应用就绪后初始化
app.whenReady().then(async () => {
  await initStore(); // 初始化安全存储
  migrateFromTauri(); // 从 Tauri 迁移数据
  await initDatabase(); // 初始化 SQLite 数据库
  setupIpcHandlers(); // 设置 IPC 处理器
  createWindow(); // 创建主窗口

  // macOS: 点击 dock 图标时重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 所有窗口关闭时清理资源
app.on('window-all-closed', () => {
  closeDatabase(); // 关闭数据库连接
  if (process.platform !== 'darwin') {
    app.quit(); // 非 macOS 平台退出应用
  }
});
