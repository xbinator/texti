import { app, BrowserWindow, ipcMain } from 'electron';
import {
  createPendingOpenFileQueue,
  resolveOpenFilePathsFromArgv,
  shouldCloseDatabaseOnWindowAllClosed,
  shouldDeferShortcutActionUntilBootstrapReady,
  shouldQuitOnWindowAllClosed
} from './lifecycle.mjs';
import {
  registerAllIpcHandlers,
  initDatabase,
  closeDatabase,
  initStore,
  initLogger,
  initMainErrorCollector,
  chatAgentDelegationService,
  cleanOldLogs,
  startLogMaintenanceTimer,
  setupAppMenu,
  sendMenuAction,
  getShortcutActionFromArgv,
  refreshShortcuts,
  setShortcutActionSender
} from './modules/index.mjs';
import { runShellPtySmoke } from './modules/shell/native-smoke.mjs';
import { createWindow } from './window.mjs';

// 设置应用名称（开发模式下也生效）
app.setName('Tibis');

const startupShortcutAction = getShortcutActionFromArgv(process.argv);
const startupOpenFilePaths = resolveOpenFilePathsFromArgv(process.argv);
const shellPtySmokeRequested = process.argv.includes('--shell-pty-smoke');
let shouldContinueStartup = true;

/** 日志维护定时器句柄，用于 before-quit 时清理 */
let logMaintenanceTimer: ReturnType<typeof startLogMaintenanceTimer> | null = null;

/** 通过系统“打开方式”或命令行传入、等待渲染进程消费的文件路径。 */
const pendingOpenFileQueue = createPendingOpenFileQueue();
/** 主进程是否已完成资源初始化、IPC 注册和首个窗口创建 */
let bootstrapReady = false;
/** bootstrap 完成前收到的系统快捷入口动作队列 */
const pendingShortcutActions: string[] = [];

if (process.platform === 'win32' && !shellPtySmokeRequested) {
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
function handleShortcutAction(action: string | null): void {
  if (!action) return;

  if (shouldDeferShortcutActionUntilBootstrapReady(bootstrapReady)) {
    pendingShortcutActions.push(action);
    return;
  }

  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }

  sendMenuAction(action);
}

/**
 * 派发 bootstrap 完成前积压的系统快捷入口动作。
 */
function flushPendingShortcutActions(): void {
  while (pendingShortcutActions.length > 0) {
    handleShortcutAction(pendingShortcutActions.shift() ?? null);
  }
}

/**
 * 通知当前窗口有待打开文件可消费。
 */
function notifyOpenFilesAvailable(): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('app:open-file');
  });
}

/**
 * 处理系统传入的待打开文件路径。
 * @param filePath - 系统传入的文件路径
 */
function handleSystemOpenFilePath(filePath: string): void {
  pendingOpenFileQueue.enqueue(filePath);

  if (!bootstrapReady) return;

  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }

  notifyOpenFilesAvailable();
}

function handleActivate(): void {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
}

function handleWindowAllClosed(): void {
  if (shouldCloseDatabaseOnWindowAllClosed(process.platform)) {
    closeDatabase();
  }
  if (shouldQuitOnWindowAllClosed(process.platform)) {
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
  setShortcutActionSender(sendMenuAction);

  // 初始化存储
  await initStore();
  // 初始化数据库
  await initDatabase();
  // Runtime 事实只保留进程内 continuation context；IPC 开放前中断旧进程遗留的活动 Checkpoint。
  chatAgentDelegationService.interruptUnrecoverableCheckpoints();
  registerAllIpcHandlers();
  ipcMain.handle('app:consume-open-files', () => pendingOpenFileQueue.consume());

  // 设置系统菜单
  setupAppMenu();
  refreshShortcuts();

  startupOpenFilePaths.forEach((filePath) => pendingOpenFileQueue.enqueue(filePath));

  // 创建窗口
  createWindow();
  bootstrapReady = true;

  handleShortcutAction(startupShortcutAction);
  flushPendingShortcutActions();
  if (pendingOpenFileQueue.hasPending()) {
    notifyOpenFilesAvailable();
  }

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

/**
 * 应用真正退出前释放主进程持有的资源。
 */
function handleBeforeQuit(): void {
  cleanupLogMaintenance();
  closeDatabase();
}

app.on('second-instance', (_event, commandLine) => {
  handleShortcutAction(getShortcutActionFromArgv(commandLine));
  resolveOpenFilePathsFromArgv(commandLine).forEach(handleSystemOpenFilePath);
});

/**
 * 处理 macOS "文件右键 → 打开方式 → Tibis" 传入的文件路径。
 * macOS 系统在用户通过"打开方式"选择本应用或双击关联文件时触发此事件。
 * 需要调用 event.preventDefault() 阻止默认行为。
 */
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  handleSystemOpenFilePath(filePath);
});

if (shellPtySmokeRequested) {
  app.whenReady().then((): Promise<void> => {
    return runShellPtySmoke().then((result): void => {
      const output = `${result.message}\n`;
      if (result.ok) process.stdout.write(output);
      else process.stderr.write(output);
      app.exit(result.ok ? 0 : 1);
    });
  });
} else if (shouldContinueStartup) {
  app.whenReady().then(bootstrap);
  app.on('window-all-closed', handleWindowAllClosed);
  app.on('before-quit', handleBeforeQuit);
}
