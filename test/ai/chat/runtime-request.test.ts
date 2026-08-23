/**
 * @file runtime-request.test.ts
 * @description ChatRuntime 请求配置纯策略测试。
 */
import type { AIToolExecutor } from 'types/ai';
import type { ChatRuntimeModelSelection } from 'types/chat-runtime';
import { describe, expect, it } from 'vitest';
import { buildRuntimeRequestConfig } from '@/ai/chat/policies/runtimeRequest';

/**
 * 创建测试工具。
 * @param name - 工具名称
 * @returns 工具执行器
 */
function createTool(name: string): AIToolExecutor {
  return {
    definition: {
      name,
      description: name,
      source: 'builtin',
      riskLevel: 'read',
      parameters: { type: 'object', properties: {} }
    },
    execute: async () => ({ toolName: name, status: 'success', data: null })
  };
}

describe('buildRuntimeRequestConfig', (): void => {
  it('filters memory tools and includes current runtime metadata', (): void => {
    const result = buildRuntimeRequestConfig({
      model: { providerId: 'provider-1', modelId: 'model-2' },
      contextWindow: 32000,
      system: 'memory context',
      workspaceRoot: '/workspace',
      candidateTools: [createTool('edit_memory'), createTool('read_file')],
      toolSupport: true,
      memoryMode: 'relevant',
      skillContentHashes: { weather: 'hash-1' },
      tavily: { enabled: true, apiKey: 'test-key' },
      mcp: { servers: [], enabledServerIds: [], enabledTools: [], toolInstructions: '' }
    });
    const { model }: { model: ChatRuntimeModelSelection } = result.config;

    expect(result.rendererTools.map((tool) => tool.definition.name)).toEqual(['read_file']);
    expect(model).toEqual({ providerId: 'provider-1', modelId: 'model-2' });
    expect(result.config).toMatchObject({
      model: { providerId: 'provider-1', modelId: 'model-2' },
      contextWindow: 32000,
      system: 'memory context',
      workspaceRoot: '/workspace',
      skillContentHashes: { weather: 'hash-1' },
      tavily: { enabled: true, apiKey: 'test-key' }
    });
    expect(result.config.tools?.map((tool) => tool.name)).toEqual(['read_file']);
    expect(result.editMemoryExposed).toBe(false);
  });

  it('does not expose transport tools when the provider lacks tool support', (): void => {
    const result = buildRuntimeRequestConfig({
      model: { providerId: 'provider-1', modelId: 'model-2' },
      contextWindow: 8000,
      candidateTools: [createTool('read_file')],
      toolSupport: false,
      memoryMode: 'full',
      skillContentHashes: {}
    });

    expect(result.config.tools).toBeUndefined();
    expect(result.rendererTools).toEqual([]);
  });

  it('does not expose workspace discovery tools without a workspace root', (): void => {
    const result = buildRuntimeRequestConfig({
      model: { providerId: 'provider-1', modelId: 'model-2' },
      contextWindow: 8000,
      candidateTools: [createTool('read_directory'), createTool('glob'), createTool('grep'), createTool('read_file')],
      toolSupport: true,
      memoryMode: 'full',
      skillContentHashes: {}
    });

    expect(result.rendererTools.map((tool: AIToolExecutor): string => tool.definition.name)).toEqual(['read_file']);
    expect(result.config.tools?.map((tool): string => tool.name)).toEqual(['read_file']);
  });
});
