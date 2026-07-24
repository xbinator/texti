/**
 * @file index.mts
 * @description 模块入口，统一注册所有 IPC handler 并导出服务实例。
 */
import { registerAIHandlers } from './ai/ipc.mjs';
import { registerChatAgentHandlers } from './chat/agents/ipc.mjs';
import { registerChatHandlers } from './chat/ipc.mjs';
import { registerChatRuntimeHandlers } from './chat/runtime/ipc.mjs';
import { registerDatabaseHandlers } from './database/ipc.mjs';
import { registerDialogHandlers } from './dialog/ipc.mjs';
import { registerExportHandlers } from './export/ipc.mjs';
import { registerFileHandlers } from './file/ipc.mjs';
import { registerImageHandlers } from './image/ipc.mjs';
import { registerLoggerHandlers, registerLogFileHandlers } from './logger/ipc.mjs';
import { registerMcpHandlers } from './mcp/ipc.mjs';
import { registerRequestHandlers } from './request/ipc.mjs';
import { registerShellCommandHandlers } from './shell/ipc.mjs';
import { registerStoreHandlers } from './store/ipc.mjs';
import { registerUiHandlers } from './ui/ipc.mjs';
import { registerUpdaterHandlers } from './updater/ipc.mjs';
import { registerWebviewHandlers } from './webview/ipc.mjs';
import { registerWorkspaceHandlers } from './workspace/ipc.mjs';

export function registerAllIpcHandlers() {
  registerDialogHandlers();
  registerExportHandlers();
  registerFileHandlers();
  registerUiHandlers();
  registerDatabaseHandlers();
  registerChatHandlers();
  registerChatAgentHandlers();
  registerChatRuntimeHandlers();
  registerStoreHandlers();
  registerRequestHandlers();
  registerShellCommandHandlers();
  registerAIHandlers();
  registerMcpHandlers();
  registerLoggerHandlers();
  registerLogFileHandlers();
  registerWebviewHandlers();
  registerImageHandlers();
  registerWorkspaceHandlers();
  registerUpdaterHandlers();
}

export {
  registerDialogHandlers,
  registerExportHandlers,
  registerFileHandlers,
  registerUiHandlers,
  registerDatabaseHandlers,
  registerChatHandlers,
  registerChatAgentHandlers,
  registerChatRuntimeHandlers,
  registerStoreHandlers,
  registerRequestHandlers,
  registerShellCommandHandlers,
  registerAIHandlers,
  registerMcpHandlers,
  registerLoggerHandlers,
  registerWebviewHandlers,
  registerLogFileHandlers,
  registerImageHandlers,
  registerWorkspaceHandlers,
  registerUpdaterHandlers
};

export { aiService } from './ai/service.mjs';

export { chatAgentDelegationService } from './chat/agents/service.mjs';

export { initLogger, initMainErrorCollector, log, cleanOldLogs, startLogMaintenanceTimer } from './logger/service.mjs';

export { initDatabase, closeDatabase, dbExecute, dbSelect, transaction, getDbPath } from './database/service.mjs';

export { initStore, getStore } from './store/service.mjs';

export { setupAppMenu, sendMenuAction } from './ui/menu.mjs';

export { getShortcutActionFromArgv, refreshShortcuts, setShortcutActionSender } from './ui/shortcuts.mjs';
