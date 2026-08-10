/**
 * @file status.mts
 * @description MCP 服务器运行状态管理与合法转换校验。
 */
import type { MCPRuntimeStatus, MCPStatusResponse } from 'types/ai';

/**
 * 合法状态转换表。
 */
const STATUS_TRANSITIONS: Record<MCPRuntimeStatus, MCPRuntimeStatus[]> = {
  idle: ['connecting', 'idle'],
  connecting: ['connected', 'failed', 'needs_auth', 'needs_client_registration'],
  connected: ['failed', 'idle'],
  failed: ['connecting', 'idle'],
  disabled: ['idle'],
  needs_auth: ['connecting', 'disabled'],
  needs_client_registration: ['disabled']
};

/**
 * runtime 状态与 sandbox 状态的映射。
 */
const SANDBOX_STATUS_MAP: Record<MCPRuntimeStatus, MCPStatusResponse['sandboxStatus']> = {
  idle: 'idle',
  connecting: 'starting',
  connected: 'running',
  failed: 'failed',
  disabled: 'idle',
  needs_auth: 'idle',
  needs_client_registration: 'idle'
};

const statusByServerId = new Map<string, MCPStatusResponse>();

/**
 * 检查状态转换是否合法。
 * @param from - 当前状态
 * @param to - 目标状态
 * @returns 是否允许转换
 */
export function canTransition(from: MCPRuntimeStatus, to: MCPRuntimeStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * 获取指定 server 的状态，不存在时返回 idle。
 * @param serverId - server ID
 * @returns MCP 状态响应
 */
export function getStatus(serverId: string): MCPStatusResponse {
  return (
    statusByServerId.get(serverId) ?? {
      serverId,
      runtimeStatus: 'idle',
      sandboxStatus: 'idle',
      discoveryStatus: 'idle'
    }
  );
}

/**
 * 设置指定 server 的运行状态。
 * @param serverId - server ID
 * @param runtimeStatus - 运行状态
 * @param discoveryStatus - 发现状态
 * @param message - 可选状态说明
 */
/**
 * 根据 runtime 状态推断 discovery 状态。
 * @param runtimeStatus - runtime 状态
 * @returns discovery 状态
 */
function inferDiscoveryStatus(runtimeStatus: MCPRuntimeStatus): MCPStatusResponse['discoveryStatus'] {
  if (runtimeStatus === 'connected') return 'ready';
  if (runtimeStatus === 'connecting') return 'refreshing';
  if (runtimeStatus === 'failed') return 'failed';
  return 'idle';
}

export function setStatus(serverId: string, runtimeStatus: MCPRuntimeStatus, discoveryStatus?: MCPStatusResponse['discoveryStatus'], message?: string): void {
  const current = statusByServerId.get(serverId);
  if (current && !canTransition(current.runtimeStatus, runtimeStatus)) {
    const transitionMsg = `[MCP] Invalid status transition for ${serverId}: ${current.runtimeStatus} → ${runtimeStatus}`;

    console.warn(transitionMsg);
  }
  statusByServerId.set(serverId, {
    serverId,
    runtimeStatus,
    sandboxStatus: SANDBOX_STATUS_MAP[runtimeStatus],
    discoveryStatus: discoveryStatus ?? inferDiscoveryStatus(runtimeStatus),
    ...(message ? { message } : {})
  });
}

/**
 * 删除指定 server 的运行状态。
 * @param serverId - server ID
 */
export function deleteStatus(serverId: string): void {
  statusByServerId.delete(serverId);
}

/**
 * 获取当前实际缓存的状态数量，用于生命周期诊断与压力验证。
 * @returns 状态缓存条目数
 */
export function getStatusCount(): number {
  return statusByServerId.size;
}

/**
 * 清除所有状态，主要用于测试。
 */
export function clearAllStatus(): void {
  statusByServerId.clear();
}

/**
 * 批量获取状态。
 * @param serverIds - server ID 列表
 * @returns 状态列表
 */
export function getStatuses(serverIds: string[]): MCPStatusResponse[] {
  return serverIds.map(getStatus);
}
