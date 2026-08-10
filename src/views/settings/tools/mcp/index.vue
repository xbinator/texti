<!--
  @file index.vue
  @description MCP 工具设置页，负责管理 MCP server 配置。
-->
<template>
  <SettingsPage :title="MENU_ITEMS.mcp.label">
    <template #extra>
      <BButton icon="lucide:plus" type="primary" size="small" @click="handleOpenAddModal">添加</BButton>
    </template>
    <SettingsSection title="MCP Servers">
      <div class="settings__toolbar">
        <div class="settings__hint">配置会保存为全局设置，聊天侧只消费默认启用项。</div>
      </div>

      <div v-if="store.mcp.servers.length === 0" class="settings__empty">暂无 MCP server 配置。</div>

      <ServerCard
        v-for="server in store.mcp.servers"
        :key="server.id"
        :server="server"
        :status="getServerStatus(server.id)"
        :discovered-tools="getDiscoveredTools(server.id)"
        :refreshing="refreshingServerId === server.id"
        @edit="handleEditServer"
        @patch="handleServerPatch"
        @remove="handleRemoveServer"
        @restart="handleRefreshDiscovery"
        @oauth-start="handleStartOAuth"
        @oauth-clear="handleClearOAuth"
      />
    </SettingsSection>

    <ServerEditor v-model:open="addModalVisible" :server="editingServer" @cancel="handleCancelAdd" @confirm="handleConfirmAdd" />
  </SettingsPage>
</template>

<script setup lang="ts">
import type { MCPStatusResponse } from 'types/ai';
import { computed, onMounted, ref } from 'vue';
import { nanoid } from 'nanoid';
import { getElectronAPI, hasElectronAPI } from '@/shared/platform/electron-api';
import type { MCPServerConfig, MCPDiscoveredToolSnapshot, MCPServerDiscoveryCache } from '@/shared/storage/tool-settings';
import { DEFAULT_MCP_CONNECT_TIMEOUT_MS, DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS } from '@/shared/storage/tool-settings';
import { useToolSettingsStore } from '@/stores/ai/toolSettings';
import { asyncTo } from '@/utils/asyncTo';
import SettingsPage from '@/views/settings/_components/SettingsPage.vue';
import SettingsSection from '@/views/settings/_components/SettingsSection.vue';
import { MENU_ITEMS } from '@/views/settings/constants';
import ServerCard from './components/ServerCard.vue';
import ServerEditor from './components/ServerEditor.vue';
import { startMcpOAuthFlow } from './utils/oauth';
import { parseMCPServerEditorDraft } from './utils/parseMCPServer';

const store = useToolSettingsStore();
const refreshingServerId = ref<string | null>(null);
const statusByServerId = ref<Record<string, MCPStatusResponse>>({});
const discoveryByServerId = ref<Record<string, MCPServerDiscoveryCache>>({});
const addModalVisible = ref(false);

/**
 * 当前编辑的 server ID，非空时为编辑模式。
 */
const editingServerId = ref<string | null>(null);

/**
 * 当前正在编辑的 server。
 */
const editingServer = computed<MCPServerConfig | null>(() => {
  if (!editingServerId.value) {
    return null;
  }

  return store.getMcpServerById(editingServerId.value) ?? null;
});

/**
 * 刷新当前页面展示的 MCP server 状态。
 */
async function refreshStatuses(): Promise<void> {
  if (!hasElectronAPI() || store.mcp.servers.length === 0) {
    statusByServerId.value = {};
    return;
  }

  const statuses = await getElectronAPI().getMcpStatus(store.mcp.servers.map((server) => server.id));
  statusByServerId.value = Object.fromEntries(statuses.map((status) => [status.serverId, status]));
}

/**
 * 读取指定 server 的状态。
 * @param serverId - MCP server ID
 * @returns server 运行状态
 */
function getServerStatus(serverId: string): MCPStatusResponse | null {
  return statusByServerId.value[serverId] ?? null;
}

/**
 * 获取指定 server 已发现的工具列表。
 * @param serverId - MCP server ID
 * @returns 工具列表
 */
function getDiscoveredTools(serverId: string): MCPDiscoveredToolSnapshot[] {
  return discoveryByServerId.value[serverId]?.tools ?? [];
}

/**
 * 请求异步刷新 server 状态，并在失败时静默保留当前页面状态。
 */
function requestStatusRefresh(): void {
  refreshStatuses().catch(() => {
    // 列表操作不应因状态轮询失败而打断。
  });
}

/**
 * 关闭弹窗并清理编辑态。
 */
function closeEditorModal(): void {
  addModalVisible.value = false;
  editingServerId.value = null;
}

/**
 * 打开添加 MCP server 的弹窗。
 */
function handleOpenAddModal(): void {
  editingServerId.value = null;
  addModalVisible.value = true;
}

/**
 * 打开编辑 MCP server 的弹窗。
 * @param server - MCP server 配置
 */
function handleEditServer(server: MCPServerConfig): void {
  editingServerId.value = server.id;
  addModalVisible.value = true;
}

/**
 * 取消添加/编辑操作，关闭弹窗。
 */
function handleCancelAdd(): void {
  closeEditorModal();
}

/**
 * 更新 MCP server。
 * @param serverId - MCP server ID
 * @param patch - 更新字段
 */
async function handleServerPatch(serverId: string, patch: Partial<MCPServerConfig>): Promise<void> {
  const [updateError] = await asyncTo(store.updateMcpServer(serverId, patch));
  if (updateError) return;

  if (patch.enabled === false && hasElectronAPI()) {
    await asyncTo(getElectronAPI().forgetMcpServer(serverId));
  }
  requestStatusRefresh();
}

/**
 * 删除 MCP server。
 * @param serverId - MCP server ID
 */
async function handleRemoveServer(serverId: string): Promise<void> {
  const [removeError] = await asyncTo(store.removeMcpServer(serverId));
  if (removeError) return;

  if (hasElectronAPI()) {
    await asyncTo(getElectronAPI().forgetMcpServer(serverId));
  }
  const nextStatuses = { ...statusByServerId.value };
  delete nextStatuses[serverId];
  statusByServerId.value = nextStatuses;
  const nextDiscovery = { ...discoveryByServerId.value };
  delete nextDiscovery[serverId];
  discoveryByServerId.value = nextDiscovery;
}

/**
 * 将 MCPServerConfig 浅拷贝为普通对象，用于跨 IPC 传输。
 * Pinia store 中的 server 是 reactive proxy，无法通过 contextBridge 结构化克隆。
 * @param server - MCP server 配置
 * @returns 普通 JS 对象副本
 */
function toPlainMcpServer(server: MCPServerConfig): MCPServerConfig {
  const runtimeServer: MCPServerConfig = { ...server };
  delete runtimeServer.editorJsonText;

  return {
    ...runtimeServer,
    args: [...runtimeServer.args],
    env: { ...runtimeServer.env },
    headers: { ...runtimeServer.headers },
    toolAllowlist: [...runtimeServer.toolAllowlist],
    oauth: runtimeServer.oauth ? { ...runtimeServer.oauth } : undefined
  };
}

/**
 * 判断 MCP server 配置是否足够用于 discovery 刷新。
 * @param server - MCP server 配置
 * @returns 是否可刷新 discovery
 */
function isServerRunnable(server: MCPServerConfig): boolean {
  if (!server.enabled) return false;
  if (server.transport === 'stdio') return server.command.trim().length > 0;
  return Boolean(server.url?.trim());
}

/**
 * 写入单个 server 的 discovery cache 到页面状态。
 * @param cache - discovery cache
 */
function setDiscoveryCache(cache: MCPServerDiscoveryCache): void {
  discoveryByServerId.value = {
    ...discoveryByServerId.value,
    [cache.serverId]: cache
  };
}

/**
 * 刷新指定 server 的 discovery cache。
 * @param server - MCP server 配置
 */
async function refreshDiscoveryCache(server: MCPServerConfig): Promise<void> {
  if (!hasElectronAPI()) return;

  const cache = await getElectronAPI().getMcpDiscoveryCache(server.id);
  if (cache && !Array.isArray(cache)) {
    setDiscoveryCache(cache);
    return;
  }

  if (!isServerRunnable(server)) {
    return;
  }

  const result = await getElectronAPI().refreshMcpDiscovery(toPlainMcpServer(server));
  if (result.ok && result.cache) {
    setDiscoveryCache(result.cache);
  }
}

/**
 * 触发指定 server 的 discovery 刷新。
 * @param server - MCP server 配置
 */
async function handleRefreshDiscovery(server: MCPServerConfig): Promise<void> {
  if (!hasElectronAPI()) {
    statusByServerId.value = {
      ...statusByServerId.value,
      [server.id]: {
        serverId: server.id,
        runtimeStatus: 'failed',
        sandboxStatus: 'failed',
        discoveryStatus: 'failed',
        message: 'Electron API is not available'
      }
    };
    return;
  }

  refreshingServerId.value = server.id;
  try {
    const result = await getElectronAPI().restartMcpServer(toPlainMcpServer(server));
    if (result.ok && result.cache) {
      setDiscoveryCache(result.cache);
    }
    await refreshStatuses();
  } finally {
    refreshingServerId.value = null;
  }
}

/**
 * 确认添加或编辑 MCP server。
 * 接收编辑器原始 JSON 文本，解析后保存并自动连接服务器加载工具列表。
 * @param jsonText - 编辑器中的原始 JSON 文本
 */
async function handleConfirmAdd(jsonText: string): Promise<void> {
  const result = parseMCPServerEditorDraft(jsonText);
  if (!result.draft) {
    return;
  }
  const { draft } = result;
  const isRemote = draft.transport === 'streamableHTTP' || draft.transport === 'sse';

  if (editingServerId.value) {
    const serverId = editingServerId.value;
    await store.updateMcpServer(editingServerId.value, {
      ...draft,
      editorJsonText: jsonText,
      oauth: isRemote && draft.enableOAuth ? {} : undefined
    });
    const updatedServer = store.getMcpServerById(serverId);
    closeEditorModal();
    if (updatedServer) {
      await handleRefreshDiscovery(updatedServer);
    }
    return;
  }

  const server: MCPServerConfig = {
    ...draft,
    id: nanoid(),
    enabled: true,
    connectTimeoutMs: DEFAULT_MCP_CONNECT_TIMEOUT_MS,
    editorJsonText: jsonText,
    toolCallTimeoutMs: draft.toolCallTimeoutMs ?? DEFAULT_MCP_TOOL_CALL_TIMEOUT_MS,
    oauth: isRemote && draft.enableOAuth ? {} : undefined
  };
  await store.addMcpServer(server);
  closeEditorModal();
  await handleRefreshDiscovery(server);
}

/**
 * 启动 OAuth 认证流程。
 * @param server - MCP server 配置
 */
async function handleStartOAuth(server: MCPServerConfig): Promise<void> {
  if (!hasElectronAPI()) return;
  try {
    await startMcpOAuthFlow(getElectronAPI(), toPlainMcpServer(server));
    await refreshStatuses();
  } catch (error) {
    console.error('OAuth failed:', error);
  }
}

/**
 * 清除 OAuth 凭据。
 * @param serverId - MCP server ID
 */
async function handleClearOAuth(serverId: string): Promise<void> {
  if (!hasElectronAPI()) return;
  try {
    await getElectronAPI().clearMcpOAuth(serverId);
    await refreshStatuses();
  } catch (error) {
    console.error('Clear OAuth failed:', error);
  }
}

onMounted(async () => {
  await store.loadSettings();
  await refreshStatuses();
  await Promise.all(store.mcp.servers.map((server) => refreshDiscoveryCache(server)));
});
</script>

<style scoped lang="less">
.settings__toolbar {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
}

.settings__hint,
.settings__empty {
  font-size: 12px;
  color: var(--text-secondary);
}

.settings__empty {
  padding: 16px;
}
</style>
