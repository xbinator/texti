/**
 * @file ipc.mts
 * @description MCP runtime IPC 处理器。
 */
import type { MCPServerConfig } from 'types/ai';
import { ipcMain, BrowserWindow } from 'electron';
import {
  connectMcpServer,
  disconnectMcpServer,
  forgetMcpServer,
  getMcpDiscoveryCache,
  getMcpStatus,
  refreshMcpDiscovery,
  restartMcpServer,
  startOAuth,
  clearOAuth,
  onToolsChanged
} from './session.mjs';

/**
 * 防止重复注册 IPC handle 和监听器的标志。
 */
let handlersRegistered = false;

/**
 * 注册 MCP runtime IPC 通道。
 * 幂等：多次调用不会重复注册 handle 和监听器。
 */
export function registerMcpHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;
  ipcMain.handle('tools:mcp:get-status', (_event, serverIds: string[]) => getMcpStatus(serverIds));
  ipcMain.handle('tools:mcp:get-discovery-cache', (_event, serverId?: string) => getMcpDiscoveryCache(serverId));
  ipcMain.handle('tools:mcp:refresh-discovery', async (_event, server: MCPServerConfig) => refreshMcpDiscovery(server));
  ipcMain.handle('tools:mcp:connect', async (_event, server: MCPServerConfig) => connectMcpServer(server));
  ipcMain.handle('tools:mcp:disconnect', (_event, serverId: string) => disconnectMcpServer(serverId));
  ipcMain.handle('tools:mcp:forget', (_event, serverId: string) => forgetMcpServer(serverId));
  ipcMain.handle('tools:mcp:restart', async (_event, server: MCPServerConfig) => restartMcpServer(server));

  ipcMain.handle('tools:mcp:oauth:start', async (_event, server: MCPServerConfig) => {
    const result = await startOAuth(server);
    if (result.authorizationUrl) {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('tools:mcp:oauth:open-url', result.authorizationUrl);
      }
    }
    return result;
  });
  ipcMain.handle('tools:mcp:oauth:clear', async (_event, serverId: string) => clearOAuth(serverId));

  onToolsChanged((serverId: string) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('tools:mcp:tools-changed', { serverId });
    }
  });
}
