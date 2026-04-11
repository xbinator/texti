import { registerAIHandlers } from './ai/ipc.mjs';
import { registerDatabaseHandlers } from './database/ipc.mjs';
import { registerDialogHandlers } from './dialog/ipc.mjs';
import { registerFileHandlers } from './file/ipc.mjs';
import { registerShellHandlers } from './shell/ipc.mjs';
import { registerStoreHandlers } from './store/ipc.mjs';
import { registerWindowHandlers } from './window/ipc.mjs';

export function registerAllIpcHandlers(): void {
  registerDialogHandlers();
  registerFileHandlers();
  registerWindowHandlers();
  registerDatabaseHandlers();
  registerStoreHandlers();
  registerShellHandlers();
  registerAIHandlers();
}

export {
  registerDialogHandlers,
  registerFileHandlers,
  registerWindowHandlers,
  registerDatabaseHandlers,
  registerStoreHandlers,
  registerShellHandlers,
  registerAIHandlers
};

export { aiService } from './ai/service.mjs';
export type { AIRequest, ProviderConfig, ProviderRequestFormat } from './ai/service.mjs';

export { initDatabase, closeDatabase, dbExecute, dbSelect, getDbPath } from './database/service.mjs';

export { initStore, getStore } from './store/service.mjs';
export { migrateFromTauri } from './store/migration.mjs';
