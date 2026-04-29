import { app, BrowserWindow } from 'electron';
import {
  registerAllIpcHandlers,
  initDatabase,
  closeDatabase,
  initStore,
  initLogger,
  initMainErrorCollector,
  cleanOldLogs,
  startLogMaintenanceTimer,
  setupAppMenu,
  sendMenuAction,
  getShortcutActionFromArgv,
  refreshPlatformShortcuts,
  setPlatformShortcutActionSender
} from './modules/index.mjs';
import { createWindow } from './window.mjs';

// 设置应用名称（开发模式下也生效）
app.setName('Tibis');

const startupShortcutAction = getShortcutActionFromArgv(process.argv);
let shouldContinueStartup = true;

/** 日志维护定时器句柄，用于 before-quit 时清理 */
let logMaintenanceTimer: ReturnType<typeof startLogMaintenanceTimer> | null = null;

if (process.platform === 'win32') {
  const gotSingleInstanceLock = app.requestSingleInstanceLock();

  if (!gotSingleInstanceLock) {
    shouldContinueStartup = false;
    app.quit();
  }
}

/**
 * 处理系统快捷入口动作，确保主窗口可见后再派发。
 * @param action - 系统快捷入口动作
 */
function handlePlatformShortcutAction(action: string | null): void {
  if (!action) return;

  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }

  sendMenuAction(action);
}

function handleActivate(): void {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
}

function handleWindowAllClosed(): void {
  closeDatabase();
  if (process.platform !== 'darwin') {
    app.quit();
  }
}

async function bootstrap(): Promise<void> {
  // 初始化日志 (仅控制台)
  initLogger();
  // 初始化主进程错误收集
  initMainErrorCollector();
  // 清理过期日志文件
  cleanOldLogs();
  // 启动日志维护定时器（每小时检查一次过期文件）
  logMaintenanceTimer = startLogMaintenanceTimer();
  setPlatformShortcutActionSender(sendMenuAction);

  // 初始化存储
  await initStore();
  // 初始化数据库
  await initDatabase();
  registerAllIpcHandlers();

  // 设置系统菜单
  setupAppMenu();
  refreshPlatformShortcuts();

  // 创建窗口
  createWindow();
  handlePlatformShortcutAction(startupShortcutAction);

  app.on('activate', handleActivate);
}

/**
 * 应用退出前清理日志维护定时器
 */
function cleanupLogMaintenance(): void {
  if (logMaintenanceTimer !== null) {
    clearInterval(logMaintenanceTimer);
    logMaintenanceTimer = null;
  }
}

app.on('second-instance', (_event, commandLine) => {
  handlePlatformShortcutAction(getShortcutActionFromArgv(commandLine));
});

if (shouldContinueStartup) {
  app.whenReady().then(bootstrap);
  app.on('window-all-closed', handleWindowAllClosed);
  app.on('before-quit', cleanupLogMaintenance);
}
