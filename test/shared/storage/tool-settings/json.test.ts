/**
 * @file json.test.ts
 * @description 工具设置 JSON 存储层测试，验证 Tavily 与 MCP 共用 settings.json。
 */
import { describe, expect, it, vi } from 'vitest';
import type { SettingsFileContent } from '@/shared/storage/providers/types';
import type { MCPToolSettings, TavilyToolSettings } from '@/shared/storage/tool-settings';
import { toolSettingsStorage } from '@/shared/storage/tool-settings';

/** settingsFileStorage 的测试替身。 */
const mockSettingsFileStorage = vi.hoisted(() => ({
  read: vi.fn<() => Promise<SettingsFileContent>>(),
  update: vi.fn<(transformer: (current: SettingsFileContent) => SettingsFileContent) => Promise<SettingsFileContent>>()
}));

vi.mock('@/shared/storage/settings', () => ({
  settingsFileStorage: mockSettingsFileStorage
}));

/**
 * 创建 settings.json 测试数据。
 * @param tavily - Tavily 工具设置
 * @param mcp - MCP 工具设置
 * @returns settings.json 内容
 */
function createSettingsFile(tavily: TavilyToolSettings, mcp: MCPToolSettings = { servers: [] }): SettingsFileContent {
  return {
    version: 1,
    providers: [],
    mcp,
    tavily
  } as unknown as SettingsFileContent;
}

describe('toolSettingsStorage', () => {
  it('loads Tavily and MCP settings from settings.json', async (): Promise<void> => {
    mockSettingsFileStorage.read.mockResolvedValue(createSettingsFile({ enabled: true, apiKey: 'tvly-test-key' }));

    const settings = await toolSettingsStorage.loadSettings();

    expect(settings.tavily).toEqual({ enabled: true, apiKey: 'tvly-test-key' });
    expect(settings.mcp).toEqual({ servers: [] });
  });

  it('saves Tavily and MCP settings into settings.json', async (): Promise<void> => {
    mockSettingsFileStorage.update.mockImplementation(async (transformer) => {
      return transformer(createSettingsFile({ enabled: false, apiKey: '' }));
    });

    const settings = await toolSettingsStorage.saveSettings({
      tavily: { enabled: true, apiKey: 'tvly-next-key' },
      mcp: { servers: [] }
    });
    const transformer = mockSettingsFileStorage.update.mock.calls[0]?.[0];
    const nextFile = transformer?.(createSettingsFile({ enabled: false, apiKey: '' }));

    expect(settings.tavily).toEqual({ enabled: true, apiKey: 'tvly-next-key' });
    expect(nextFile?.tavily).toEqual({ enabled: true, apiKey: 'tvly-next-key' });
    expect(nextFile?.mcp).toEqual({ servers: [] });
  });

  it('preserves remote MCP server headers while normalizing settings', async (): Promise<void> => {
    mockSettingsFileStorage.read.mockResolvedValue(
      createSettingsFile({ enabled: false, apiKey: '' }, {
        servers: [
          {
            id: 'coffee-server',
            name: 'Coffee Server',
            enabled: true,
            transport: 'streamableHTTP',
            url: 'https://gwmcp.lkcoffee.com/order/user/mcp',
            command: '',
            args: [],
            env: {},
            headers: {
              Authorization: 'Bearer test-token'
            },
            toolAllowlist: [],
            connectTimeoutMs: 30000,
            toolCallTimeoutMs: 60000
          }
        ]
      } as unknown as MCPToolSettings)
    );

    const settings = await toolSettingsStorage.loadSettings();

    expect(settings.mcp.servers[0]).toMatchObject({
      headers: {
        Authorization: 'Bearer test-token'
      }
    });
  });

  it('preserves MCP server editor JSON while normalizing settings', async (): Promise<void> => {
    const editorJsonText = `{
  "mcpServers": {
    "my-coffee": {
      "type": "streamablehttp",
      "url": "https://gwmcp.lkcoffee.com/order/user/mcp",
      "x-vendor-field": "kept"
    }
  }
}`;

    mockSettingsFileStorage.read.mockResolvedValue(
      createSettingsFile({ enabled: false, apiKey: '' }, {
        servers: [
          {
            id: 'coffee-server',
            name: 'Coffee Server',
            enabled: true,
            transport: 'streamableHTTP',
            url: 'https://gwmcp.lkcoffee.com/order/user/mcp',
            command: '',
            args: [],
            env: {},
            headers: {},
            toolAllowlist: [],
            connectTimeoutMs: 30000,
            toolCallTimeoutMs: 60000,
            editorJsonText
          }
        ]
      } as unknown as MCPToolSettings)
    );

    const settings = await toolSettingsStorage.loadSettings();

    expect(settings.mcp.servers[0]).toMatchObject({
      editorJsonText
    });
  });
});
