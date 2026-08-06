/**
 * @file runtime-capabilities.test.ts
 * @description Runtime renderer capability registry 测试。
 */
import type { AIToolExecutor } from 'types/ai';
import { describe, expect, it, vi } from 'vitest';
import { createRuntimeCapabilityRegistry } from '@/ai/chat/runtimeCapabilities';

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

describe('runtime capability registry', (): void => {
  it('freezes capabilities by runtime and releases them explicitly', (): void => {
    const registry = createRuntimeCapabilityRegistry();
    const sourceTools = [createTool('read_file')];
    const redactInputPaths = ['payload.secret'];
    const sourceDescriptor = {
      rendererTools: [{ name: 'inspect_registered_page', history: { mode: 'latest-only' as const, redactInputPaths } }],
      toolContext: { providerId: 'page', resourceId: 'page-a' }
    };
    const handleBridgeRequest = vi.fn(async (): Promise<unknown> => ({ ok: true }));
    registry.register('runtime-1', {
      tools: sourceTools,
      descriptor: sourceDescriptor,
      getToolContext: () => undefined,
      handleBridgeRequest
    });
    sourceTools.push(createTool('edit_file'));
    sourceDescriptor.toolContext.resourceId = 'page-b';
    redactInputPaths.push('payload.newSecret');

    expect(registry.get('runtime-1')?.tools.map((tool) => tool.definition.name)).toEqual(['read_file']);
    expect(registry.get('runtime-1')?.descriptor?.toolContext).toEqual({ providerId: 'page', resourceId: 'page-a' });
    expect(registry.get('runtime-1')?.descriptor?.rendererTools).toEqual([
      { name: 'inspect_registered_page', history: { mode: 'latest-only', redactInputPaths: ['payload.secret'] } }
    ]);
    expect(Object.isFrozen(registry.get('runtime-1')?.descriptor?.rendererTools[0]?.history?.redactInputPaths)).toBe(true);
    expect(Object.isFrozen(registry.get('runtime-1')?.descriptor?.toolContext)).toBe(true);
    expect(registry.delete('runtime-1')).toBe(true);
    expect(registry.get('runtime-1')).toBeUndefined();
  });

  it('rejects duplicate renderer tool descriptors', (): void => {
    const registry = createRuntimeCapabilityRegistry();

    expect(() =>
      registry.register('runtime-1', {
        tools: [],
        descriptor: { rendererTools: [{ name: 'inspect_page' }, { name: 'inspect_page' }] },
        getToolContext: () => undefined,
        handleBridgeRequest: async (): Promise<undefined> => undefined
      })
    ).toThrow('Duplicate renderer tool descriptor: inspect_page');
  });
});
