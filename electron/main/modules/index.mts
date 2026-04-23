import { registerAIHandlers } from './ai/ipc.mjs';
import { registerDatabaseHandlers } from './database/ipc.mjs';
import { registerDialogHandlers } from './dialog/ipc.mjs';
import { registerFileHandlers } from './file/ipc.mjs';
import { registerLoggerHandlers } from './logger/ipc.mjs';
import { registerMenuHandlers } from './menu/ipc.mjs';
import { registerPlatformShortcutHandlers } from './platform-shortcuts/ipc.mjs';
import { registerShellHandlers } from './shell/ipc.mjs';
import { registerStoreHandlers } from './store/ipc.mjs';
import { registerWindowHandlers } from './window/ipc.mjs';

export function registerAllIpcHandlers() {
  registerDialogHandlers();
  registerFileHandlers();
  registerWindowHandlers();
  registerDatabaseHandlers();
  registerStoreHandlers();
  registerShellHandlers();
  registerAIHandlers();
  registerLoggerHandlers();
  registerMenuHandlers();
  registerPlatformShortcutHandlers();
}

export {
  registerDialogHandlers,
  registerFileHandlers,
  registerWindowHandlers,
  registerDatabaseHandlers,
  registerStoreHandlers,
  registerShellHandlers,
  registerAIHandlers,
  registerLoggerHandlers,
  registerPlatformShortcutHandlers
};

export { aiService } from './ai/service.mjs';

export { initLogger, log } from './logger/service.mjs';

export { initDatabase, closeDatabase, dbExecute, dbSelect, getDbPath } from './database/service.mjs';

export { initStore, getStore } from './store/service.mjs';

export { setupAppMenu, sendMenuAction } from './menu/service.mjs';

export { getShortcutActionFromArgv, refreshPlatformShortcuts, setPlatformShortcutActionSender } from './platform-shortcuts/service.mjs';
