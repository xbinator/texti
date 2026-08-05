/**
 * @file parseMCPServer.test.ts
 * @description 验证 MCP Server JSON 配置解析对远程 transport 与 headers 的兼容。
 */
import { describe, expect, it } from 'vitest';
import { parseMCPServerEditorDraft } from '@/views/settings/tools/mcp/utils/parseMCPServer';

/**
 * 带请求头的 MCP server 草稿。
 */
interface HeaderAwareMcpServerDraft {
  /** 远程 MCP 请求头 */
  headers: Record<string, string>;
}

describe('parseMCPServerEditorDraft', () => {
  it('parses streamablehttp type and headers from wrapped MCP server config', (): void => {
    const result = parseMCPServerEditorDraft(
      JSON.stringify({
        mcpServers: {
          'my-coffee': {
            type: 'streamablehttp',
            url: 'https://gwmcp.lkcoffee.com/order/user/mcp',
            headers: {
              Authorization: 'Bearer test-token'
            }
          }
        }
      })
    );

    const draft = result.draft as typeof result.draft & HeaderAwareMcpServerDraft;

    expect(result.error).toBe('');
    expect(draft?.name).toBe('my-coffee');
    expect(draft?.transport).toBe('streamableHTTP');
    expect(draft?.url).toBe('https://gwmcp.lkcoffee.com/order/user/mcp');
    expect(draft?.headers).toEqual({
      Authorization: 'Bearer test-token'
    });
  });

  it('rejects wrapped MCP server config with multiple servers', (): void => {
    const result = parseMCPServerEditorDraft(
      JSON.stringify({
        mcpServers: {
          first: {
            command: 'npx',
            args: ['first-server']
          },
          second: {
            command: 'npx',
            args: ['second-server']
          }
        }
      })
    );

    expect(result.draft).toBeNull();
    expect(result.error).toBe('mcpServers 一次只能包含一个 server 配置，请拆分后分别添加。');
  });
});
