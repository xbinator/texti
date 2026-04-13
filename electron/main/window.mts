import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

export function isDev(): boolean {
  return process.env.NODE_ENV === 'development' || !app.isPackaged;
}

export function getPreloadPath(): string {
  return path.join(__dirname, '../preload/index.mjs');
}

export function getDistPath(): string {
  return path.join(__dirname, '../../dist/index.html');
}

export function getIconPath(): string {
  // 统一图标名
  const iconName = process.platform === 'darwin' ? 'app.icns' : 'app.png';

  if (isDev()) {
    // 开发环境：直接读取资源文件夹
    return path.join(__dirname, '../../resources/icons', iconName);
  }

  // 生产环境（打包后）
  if (process.platform === 'darwin') {
    // macOS 打包后图标在 app 包内的 Contents/Resources
    return path.join(process.resourcesPath, 'app.icns');
  }

  // Windows / Linux
  return path.join(process.resourcesPath, 'icons', iconName);
}

export function createWindow(): BrowserWindow {
  const iconPath = getIconPath();
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Texti',
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  };

  if (iconPath) {
    windowOptions.icon = iconPath;
  }

  mainWindow = new BrowserWindow(windowOptions);

  if (isDev()) {
    mainWindow.loadURL('http://localhost:1420');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(getDistPath());
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function getWindow(): BrowserWindow | null {
  return mainWindow;
}

export function getFocusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow();
}

export function getWindowFromWebContents(webContents: Electron.WebContents): BrowserWindow | null {
  return BrowserWindow.fromWebContents(webContents);
}
