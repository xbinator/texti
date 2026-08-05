/**
 * @file index.test.ts
 * @description MCP 设置页保存编辑器原始 JSON 的组件测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { defineComponent, type PropType } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MCPServerConfig } from '@/shared/storage/tool-settings';
import McpSettingsPage from '@/views/settings/tools/mcp/index.vue';

/** 工具设置 store mock。 */
const storeMock = vi.hoisted(() => ({
  mcp: {
    servers: [] as MCPServerConfig[]
  },
  addMcpServer: vi.fn<(server: MCPServerConfig) => Promise<void>>(),
  getMcpServerById: vi.fn<(serverId: string) => MCPServerConfig | undefined>(),
  loadSettings: vi.fn<() => Promise<void>>(),
  removeMcpServer: vi.fn<(serverId: string) => Promise<void>>(),
  updateMcpServer: vi.fn<(serverId: string, patch: Partial<MCPServerConfig>) => Promise<void>>()
}));

/** Electron MCP API mock。 */
const electronApiMock = vi.hoisted(() => ({
  clearMcpOAuth: vi.fn<(serverId: string) => Promise<void>>(),
  getMcpDiscoveryCache: vi.fn<(serverId?: string) => Promise<null>>(),
  getMcpStatus: vi.fn<(serverIds: string[]) => Promise<unknown[]>>(),
  hasElectronAPI: vi.fn<() => boolean>(),
  refreshMcpDiscovery: vi.fn<(server: MCPServerConfig) => Promise<{ ok: boolean }>>(),
  restartMcpServer: vi.fn<(server: MCPServerConfig) => Promise<{ ok: boolean }>>(),
  startMcpOAuth: vi.fn<(server: MCPServerConfig) => Promise<{ authorizationUrl: string }>>()
}));

vi.mock('@/stores/ai/toolSettings', () => ({
  useToolSettingsStore: vi.fn(() => storeMock)
}));

vi.mock('@/shared/platform/electron-api', () => ({
  getElectronAPI: vi.fn(() => electronApiMock),
  hasElectronAPI: electronApiMock.hasElectronAPI
}));

/** 设置页测试替身。 */
const SettingsPageStub = defineComponent({
  name: 'SettingsPage',
  props: {
    title: { type: String, required: true }
  },
  template: '<main><slot name="extra"></slot><slot></slot></main>'
});

/** 设置分区测试替身。 */
const SettingsSectionStub = defineComponent({
  name: 'SettingsSection',
  props: {
    title: { type: String, required: true }
  },
  template: '<section><slot></slot></section>'
});

/** 按钮测试替身。 */
const BButtonStub = defineComponent({
  name: 'BButton',
  emits: ['click'],
  template: '<button type="button" @click="$emit(\'click\', $event)"><slot></slot></button>'
});

/** MCP server 卡片测试替身。 */
const ServerCardStub = defineComponent({
  name: 'ServerCard',
  props: {
    server: { type: Object as PropType<MCPServerConfig>, required: true }
  },
  emits: ['edit', 'restart'],
  template: `
    <article class="server-card-stub">
      <button class="edit-server" @click="$emit('edit', server)">{{ server.name }}</button>
      <button class="restart-server" @click="$emit('restart', server)">restart</button>
    </article>
  `
});

/** MCP server 编辑器测试替身。 */
const ServerEditorStub = defineComponent({
  name: 'ServerEditor',
  props: {
    open: { type: Boolean, required: true },
    server: { type: Object as PropType<MCPServerConfig | null>, default: null }
  },
  emits: ['cancel', 'confirm', 'update:open'],
  template: '<div class="server-editor-stub"></div>'
});

/**
 * 创建 MCP server 测试配置。
 * @returns MCP server 配置
 */
function createServer(): MCPServerConfig {
  return {
    id: 'coffee-server',
    name: 'Coffee Server',
    enabled: true,
    transport: 'stdio',
    command: 'npx',
    args: ['coffee-server'],
    env: {},
    headers: {},
    toolAllowlist: [],
    connectTimeoutMs: 20_000,
    toolCallTimeoutMs: 30_000
  };
}

/**
 * 挂载 MCP 设置页。
 * @returns 组件包装器
 */
function mountMcpSettingsPage(): VueWrapper {
  return mount(McpSettingsPage, {
    global: {
      stubs: {
        BButton: BButtonStub,
        ServerCard: ServerCardStub,
        ServerEditor: ServerEditorStub,
        SettingsPage: SettingsPageStub,
        SettingsSection: SettingsSectionStub
      }
    }
  });
}

describe('McpSettingsPage', (): void => {
  beforeEach((): void => {
    storeMock.mcp = { servers: [] };
    storeMock.addMcpServer.mockReset();
    storeMock.getMcpServerById.mockReset();
    storeMock.loadSettings.mockReset();
    storeMock.removeMcpServer.mockReset();
    storeMock.updateMcpServer.mockReset();
    storeMock.addMcpServer.mockResolvedValue(undefined);
    storeMock.loadSettings.mockResolvedValue(undefined);
    storeMock.removeMcpServer.mockResolvedValue(undefined);
    storeMock.updateMcpServer.mockResolvedValue(undefined);
    electronApiMock.clearMcpOAuth.mockReset();
    electronApiMock.getMcpDiscoveryCache.mockReset();
    electronApiMock.getMcpStatus.mockReset();
    electronApiMock.hasElectronAPI.mockReset();
    electronApiMock.refreshMcpDiscovery.mockReset();
    electronApiMock.restartMcpServer.mockReset();
    electronApiMock.startMcpOAuth.mockReset();
    electronApiMock.getMcpDiscoveryCache.mockResolvedValue(null);
    electronApiMock.getMcpStatus.mockResolvedValue([]);
    electronApiMock.hasElectronAPI.mockReturnValue(false);
    electronApiMock.refreshMcpDiscovery.mockResolvedValue({ ok: false });
    electronApiMock.restartMcpServer.mockResolvedValue({ ok: false });
    electronApiMock.startMcpOAuth.mockResolvedValue({ authorizationUrl: 'https://example.com/oauth' });
  });

  it('stores the original editor JSON when adding an MCP server', async (): Promise<void> => {
    const rawJson = '{ "mcpServers": { "coffee": { "command": "npx", "args": ["coffee-server"] } } }';
    const wrapper = mountMcpSettingsPage();

    wrapper.findComponent(ServerEditorStub).vm.$emit('confirm', rawJson);
    await flushPromises();

    expect(storeMock.addMcpServer).toHaveBeenCalledWith(expect.objectContaining({ editorJsonText: rawJson }));
    wrapper.unmount();
  });

  it('stores the original editor JSON when updating an MCP server', async (): Promise<void> => {
    const server = createServer();
    const rawJson = '{ "name": "Coffee Server", "command": "npx", "args": ["coffee-server"] }';
    storeMock.mcp = { servers: [server] };
    storeMock.getMcpServerById.mockReturnValue(server);
    const wrapper = mountMcpSettingsPage();

    wrapper.findComponent(ServerCardStub).vm.$emit('edit', server);
    wrapper.findComponent(ServerEditorStub).vm.$emit('confirm', rawJson);
    await flushPromises();

    expect(storeMock.updateMcpServer).toHaveBeenCalledWith(server.id, expect.objectContaining({ editorJsonText: rawJson }));
    wrapper.unmount();
  });

  it('omits editor JSON when sending MCP server to Electron restart API', async (): Promise<void> => {
    const server: MCPServerConfig = {
      ...createServer(),
      editorJsonText: '{ "mcpServers": { "coffee": { "command": "npx" } } }'
    };
    storeMock.mcp = { servers: [server] };
    electronApiMock.hasElectronAPI.mockReturnValue(true);
    const wrapper = mountMcpSettingsPage();

    await flushPromises();
    electronApiMock.restartMcpServer.mockClear();
    wrapper.find('.restart-server').trigger('click');
    await flushPromises();

    expect(electronApiMock.restartMcpServer).toHaveBeenCalledTimes(1);
    expect(electronApiMock.restartMcpServer.mock.calls[0]?.[0]).not.toHaveProperty('editorJsonText');
    wrapper.unmount();
  });
});
