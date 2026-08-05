/**
 * @file settings-file.test.ts
 * @description ChatRuntime MCP settings 文件归一化测试。
 */
import { describe, expect, it } from 'vitest';
import { normalizeRuntimeMcpSettings, redactMcpEditorJson } from '../../../../../../electron/main/modules/chat/runtime/tools/settings-file.mjs';

describe('normalizeRuntimeMcpSettings', (): void => {
  it('preserves MCP server editor JSON in runtime settings storage', (): void => {
    const editorJsonText = `{
  "mcpServers": {
    "coffee": {
      "command": "npx",
      "args": ["-y", "coffee-server"],
      "x-vendor-field": "kept"
    }
  }
}`;

    const settings = normalizeRuntimeMcpSettings({
      servers: [
        {
          id: 'coffee-server',
          name: 'Coffee Server',
          enabled: true,
          editorJsonText,
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'coffee-server'],
          env: {},
          headers: {},
          toolAllowlist: [],
          connectTimeoutMs: 20_000,
          toolCallTimeoutMs: 30_000
        }
      ]
    });

    expect(settings.servers[0]?.editorJsonText).toBe(editorJsonText);
  });

  it('redacts MCP server editor JSON from tool-readable settings', (): void => {
    const settings = redactMcpEditorJson({
      servers: [
        {
          id: 'coffee-server',
          name: 'Coffee Server',
          enabled: true,
          editorJsonText: '{ "mcpServers": { "coffee": { "command": "npx" } } }',
          transport: 'stdio',
          command: 'npx',
          args: ['coffee-server'],
          env: {},
          headers: {},
          toolAllowlist: [],
          connectTimeoutMs: 20_000,
          toolCallTimeoutMs: 30_000
        }
      ]
    });

    expect(settings.servers[0]).not.toHaveProperty('editorJsonText');
    expect(settings.servers[0]).toMatchObject({
      id: 'coffee-server',
      command: 'npx'
    });
  });
});
