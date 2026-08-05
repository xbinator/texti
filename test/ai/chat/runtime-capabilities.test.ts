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
    const sourceDescriptor = {
      rendererToolNames: ['read_current_widget'],
      toolContext: { providerId: 'widget', resourceId: 'widget-a' }
    };
    const handleBridgeRequest = vi.fn(async (): Promise<unknown> => ({ ok: true }));
    registry.register('runtime-1', {
      tools: sourceTools,
      descriptor: sourceDescriptor,
      getToolContext: () => undefined,
      handleBridgeRequest
    });
    sourceTools.push(createTool('edit_file'));
    sourceDescriptor.toolContext.resourceId = 'widget-b';

    expect(registry.get('runtime-1')?.tools.map((tool) => tool.definition.name)).toEqual(['read_file']);
    expect(registry.get('runtime-1')?.descriptor?.toolContext).toEqual({ providerId: 'widget', resourceId: 'widget-a' });
    expect(Object.isFrozen(registry.get('runtime-1')?.descriptor?.toolContext)).toBe(true);
    expect(registry.delete('runtime-1')).toBe(true);
    expect(registry.get('runtime-1')).toBeUndefined();
  });
});
