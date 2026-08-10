/**
 * @file session.mts
 * @description MCP 会话生命周期管理，替代原 runtime.mts。
 */
import type { MCPClientWrapper, MCPToolCallOptions } from './client.mjs';
import type { MCPDiscoveryRefreshResult, MCPServerConfig } from 'types/ai';
import { log } from '../logger/service.mjs';
import { createMcpClient } from './client.mjs';
import { clearAllDiscoveryCache, createDiscoverySuccessResult, createDiscoveryFailureResult, deleteDiscoveryCache, getDiscoveryCache } from './discovery.mjs';
import { classifyMcpError } from './errors.mjs';
import { registerNotificationHandlers } from './notifications.mjs';
import { TibisOAuthProvider, AuthorizationPendingError, OAuthCallbackServer, clearOAuthCredentials, loadOAuthData } from './oauth/index.mjs';
import { setStatus, clearAllStatus, deleteStatus, getStatuses } from './status.mjs';
import { createTransport } from './transport.mjs';

/**
 * 支持 finishAuth 的 transport 窄接口。
 */
interface FinishAuthable {
  finishAuth(code: string): Promise<void>;
}

/**
 * 类型守卫：判断 transport 是否支持 finishAuth。
 * @param t - 待检查对象
 * @returns 是否支持 finishAuth
 */
function isFinishAuthable(t: unknown): t is FinishAuthable {
  return t !== null && typeof t === 'object' && typeof (t as FinishAuthable).finishAuth === 'function';
}

/**
 * 活跃的 MCP 客户端会话。
 */
const sessionsByServerId = new Map<string, MCPClientWrapper>();

/**
 * 工具变更通知回调列表。
 */
const toolsChangedListeners = new Set<(serverId: string) => void>();

/**
 * 注册工具变更通知回调。
 * @param callback - 回调函数
 * @returns 取消注册函数
 */
export function onToolsChanged(callback: (serverId: string) => void): () => void {
  toolsChangedListeners.add(callback);
  return () => toolsChangedListeners.delete(callback);
}

/**
 * 通知所有监听者工具列表已变更。
 * @param serverId - MCP server ID
 */
function notifyToolsChanged(serverId: string): void {
  for (const callback of toolsChangedListeners) {
    try {
      callback(serverId);
    } catch (error) {
      log.error(`Tools changed listener error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * 判断 server 是否可尝试连接。
 * @param server - MCP server 配置
 * @returns 不可连接时的错误消息，空表示可连接
 */
function getServerRunnableError(server: MCPServerConfig): string {
  if (!server.enabled) {
    return `MCP server is disabled: ${server.id}`;
  }
  if (server.transport === 'stdio' && !server.command.trim()) {
    return `MCP server command is empty: ${server.id}`;
  }
  if ((server.transport === 'streamableHTTP' || server.transport === 'sse') && !server.url?.trim()) {
    return `MCP server URL is empty: ${server.id}`;
  }
  return '';
}

/**
 * 关闭并移除指定 server 的会话。
 * @param serverId - server ID
 */
async function closeSession(serverId: string): Promise<void> {
  const wrapper = sessionsByServerId.get(serverId);
  if (!wrapper) return;
  sessionsByServerId.delete(serverId);
  try {
    await wrapper.disconnect();
  } catch (error) {
    log.error(`Error closing MCP session ${serverId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 连接指定 MCP server 并刷新 discovery cache。
 * @param server - MCP server 配置
 * @param abortSignal - 调用方总截止时间或主动取消信号
 * @returns discovery 刷新结果
 */
export async function connectMcpServer(server: MCPServerConfig, abortSignal?: AbortSignal): Promise<MCPDiscoveryRefreshResult> {
  abortSignal?.throwIfAborted();
  const runnableError = getServerRunnableError(server);
  if (runnableError) {
    setStatus(server.id, server.enabled ? 'failed' : 'disabled', undefined, runnableError);
    return createDiscoveryFailureResult(server.id, 'LOCAL_EXEC_FAILED', runnableError);
  }

  setStatus(server.id, 'connecting', 'refreshing');

  let connectingWrapper: MCPClientWrapper | undefined;
  let disconnectingWrapper: Promise<void> | undefined;

  /**
   * 至多关闭一次尚未发布到 session map 的连接包装器。
   * @returns 关闭操作完成
   */
  function closeConnectingWrapper(): Promise<void> {
    if (!connectingWrapper) return Promise.resolve();
    disconnectingWrapper ??= connectingWrapper.disconnect().catch((): void => undefined);
    return disconnectingWrapper;
  }

  const disconnectOnAbort = (): void => {
    closeConnectingWrapper().catch((): void => undefined);
  };
  abortSignal?.addEventListener('abort', disconnectOnAbort, { once: true });

  try {
    let authProvider: TibisOAuthProvider | undefined;
    if ((server.transport === 'streamableHTTP' || server.transport === 'sse') && server.oauth !== undefined) {
      authProvider = new TibisOAuthProvider(server);
    }

    const transport = createTransport(server, {
      authProvider,
      timeout: server.connectTimeoutMs
    });

    const wrapper = await createMcpClient(server, transport);
    connectingWrapper = wrapper;
    await wrapper.connect();
    abortSignal?.throwIfAborted();

    const tools = await wrapper.listTools();
    abortSignal?.throwIfAborted();

    await closeSession(server.id);
    sessionsByServerId.set(server.id, wrapper);

    if (server.watchToolChanges !== false) {
      // 每次连接都创建新的 Client + Transport 实例，通知处理器绑定在新 Client 上。
      // 旧 Client 随 closeSession 被丢弃，因此不会出现重复触发的问题。
      registerNotificationHandlers(wrapper.client, server.id, {
        onToolsChanged: async (serverId: string) => {
          log.info(`MCP tools changed notification for ${serverId}`);
          const sessionWrapper = sessionsByServerId.get(serverId);
          if (sessionWrapper?.isConnected()) {
            try {
              const updatedTools = await sessionWrapper.listTools();
              createDiscoverySuccessResult(serverId, updatedTools, Date.now());
              setStatus(serverId, 'connected', 'ready');
              notifyToolsChanged(serverId);
            } catch (error) {
              log.error(`Failed to refresh tools after change notification: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }
      });
    }

    setStatus(server.id, 'connected', 'ready');
    return createDiscoverySuccessResult(server.id, tools, Date.now());
  } catch (error) {
    // 包装器可能已发布后才在通知注册等尾部步骤失败，先移除自身，避免后续复用已关闭连接。
    if (connectingWrapper && sessionsByServerId.get(server.id) === connectingWrapper) {
      sessionsByServerId.delete(server.id);
    }
    await closeConnectingWrapper();
    const classified = classifyMcpError(error);

    if (error instanceof AuthorizationPendingError) {
      setStatus(server.id, 'needs_auth', undefined, 'OAuth authorization required');
      return createDiscoveryFailureResult(server.id, 'AUTH_REQUIRED', 'OAuth authorization required');
    }

    setStatus(server.id, classified.status, 'failed', classified.message);

    return createDiscoveryFailureResult(server.id, classified.code, classified.message);
  } finally {
    abortSignal?.removeEventListener('abort', disconnectOnAbort);
  }
}

/**
 * 断开指定 MCP server。
 * @param serverId - server ID
 */
export async function disconnectMcpServer(serverId: string): Promise<void> {
  await closeSession(serverId);
  deleteDiscoveryCache(serverId);
  setStatus(serverId, 'idle', 'idle');
}

/**
 * 完全遗忘指定 MCP server 的进程内资源。
 * 删除或禁用配置时使用，不保留可见 idle 状态。
 * @param serverId - server ID
 */
export async function forgetMcpServer(serverId: string): Promise<void> {
  await closeSession(serverId);
  deleteDiscoveryCache(serverId);
  deleteStatus(serverId);
}

/**
 * 获取当前活跃 MCP 会话数量，用于生命周期诊断与压力验证。
 * @returns 活跃会话数量
 */
export function getMcpSessionCount(): number {
  return sessionsByServerId.size;
}

/**
 * 重启指定 MCP server。
 * @param server - MCP server 配置
 * @returns discovery 刷新结果
 */
export async function restartMcpServer(server: MCPServerConfig): Promise<MCPDiscoveryRefreshResult> {
  await closeSession(server.id);
  return connectMcpServer(server);
}

/**
 * 刷新指定 MCP server 的 discovery cache。
 * @param server - MCP server 配置
 * @returns discovery 刷新结果
 */
export async function refreshMcpDiscovery(server: MCPServerConfig): Promise<MCPDiscoveryRefreshResult> {
  const wrapper = sessionsByServerId.get(server.id);
  if (wrapper?.isConnected()) {
    try {
      setStatus(server.id, 'connected', 'refreshing');
      const tools = await wrapper.listTools();
      setStatus(server.id, 'connected', 'ready');
      return createDiscoverySuccessResult(server.id, tools, Date.now());
    } catch (error) {
      const classified = classifyMcpError(error);
      setStatus(server.id, classified.status, 'failed', classified.message);
      return createDiscoveryFailureResult(server.id, classified.code, classified.message);
    }
  }
  return connectMcpServer(server);
}

/**
 * 在已连接的会话上执行 MCP tool。
 * @param server - MCP server 配置
 * @param toolName - MCP tool 名称
 * @param input - tool 输入
 * @param options - 工具中止与 progress 回调
 * @returns MCP tool 调用结果
 */
export async function executeMcpTool(server: MCPServerConfig, toolName: string, input: unknown, options: MCPToolCallOptions = {}): Promise<unknown> {
  options.signal?.throwIfAborted();
  let wrapper = sessionsByServerId.get(server.id);

  if (!wrapper || !wrapper.isConnected()) {
    const result = await connectMcpServer(server, options.signal);
    options.signal?.throwIfAborted();
    if (!result.ok) {
      throw new Error(result.message ?? `MCP server failed to connect: ${server.id}`);
    }
    wrapper = sessionsByServerId.get(server.id);
  }

  if (!wrapper) {
    throw new Error(`MCP session not found: ${server.id}`);
  }

  try {
    return await wrapper.callTool(toolName, input, options);
  } catch (error) {
    const classified = classifyMcpError(error);
    if (classified.status === 'failed') {
      await closeSession(server.id);
      setStatus(server.id, 'failed', 'failed', classified.message);
    }
    throw error;
  }
}

/**
 * 启动 OAuth 认证流程。
 * finishAuth 后重新连接建立已认证会话；如果已有有效 token 直接连接成功则保留会话。
 * @param server - MCP server 配置
 * @returns 授权 URL（空字符串表示无需浏览器授权）
 */
export async function startOAuth(server: MCPServerConfig): Promise<{ authorizationUrl: string }> {
  const provider = new TibisOAuthProvider(server);
  const callbackServer = new OAuthCallbackServer();

  try {
    const transport = createTransport(server, {
      authProvider: provider,
      timeout: server.connectTimeoutMs
    });

    const wrapper = await createMcpClient(server, transport);

    try {
      await wrapper.connect();
    } catch (connectError) {
      if (connectError instanceof AuthorizationPendingError) {
        const authorizationUrl = connectError.authorizationUrl.toString();

        const oauthData = loadOAuthData(server.id);
        const state = oauthData?.state ?? new URL(authorizationUrl).searchParams.get('state') ?? '';
        const callbackResult = await callbackServer.waitForCallback(state);

        if (!isFinishAuthable(transport)) {
          throw new Error('Transport does not support finishAuth');
        }
        await transport.finishAuth(callbackResult.code);

        try {
          await closeSession(server.id);
          sessionsByServerId.set(server.id, wrapper);
          await wrapper.connect();
        } catch (reconnectError) {
          sessionsByServerId.delete(server.id);
          const classified = classifyMcpError(reconnectError);
          setStatus(server.id, classified.status, 'failed', classified.message);
          throw reconnectError;
        }

        setStatus(server.id, 'connected', 'ready');

        const tools = await wrapper.listTools();
        createDiscoverySuccessResult(server.id, tools, Date.now());

        return { authorizationUrl };
      }
      throw connectError;
    }

    await closeSession(server.id);
    sessionsByServerId.set(server.id, wrapper);

    const tools = await wrapper.listTools();
    createDiscoverySuccessResult(server.id, tools, Date.now());

    setStatus(server.id, 'connected', 'ready');
    return { authorizationUrl: '' };
  } finally {
    callbackServer.stop();
  }
}

/**
 * 清除指定 server 的 OAuth 凭据。
 * @param serverId - MCP server ID
 */
export async function clearOAuth(serverId: string): Promise<void> {
  await closeSession(serverId);
  await clearOAuthCredentials(serverId);
  setStatus(serverId, 'idle', 'idle');
}

/**
 * 获取 MCP server 状态。
 * @param serverIds - server ID 列表
 * @returns 状态列表
 */
export function getMcpStatus(serverIds: string[]) {
  return getStatuses(serverIds);
}

/**
 * 获取 discovery cache。
 * @param serverId - 可选 server ID
 * @returns discovery cache
 */
export function getMcpDiscoveryCache(serverId?: string) {
  return getDiscoveryCache(serverId);
}

/**
 * 重置所有 MCP 会话与状态，主要用于测试。
 */
export async function resetMcpState(): Promise<void> {
  const serverIds = [...sessionsByServerId.keys()];
  await Promise.all(serverIds.map((id) => closeSession(id)));
  clearAllStatus();
  clearAllDiscoveryCache();
}
