/**
 * @file use-runtime-request-config.test.ts
 * @description BChat Runtime 请求准备 IO hook 测试。
 */
import type { AIToolExecutor } from 'types/ai';
import type { ChatRuntimeModelSelection } from 'types/chat-runtime';
import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useRuntimeRequestConfig } from '@/components/BChat/hooks/useRuntimeRequestConfig';
import type { Message } from '@/components/BChat/utils/types';

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

/** 测试用户消息。 */
const USER_MESSAGE: Message = {
  id: 'user-1',
  role: 'user',
  content: '记住这个偏好',
  references: [
    {
      token: '{{file-ref:/notes/a.md}}',
      path: '/notes/a.md',
      startLine: 0,
      endLine: 0,
      selectedContent: '',
      fullContent: ''
    }
  ],
  parts: [],
  createdAt: '2026-07-11T00:00:00.000Z'
};

describe('useRuntimeRequestConfig', (): void => {
  it('synchronizes resources before resolving a complete request', async (): Promise<void> => {
    const order: string[] = [];
    const hook = useRuntimeRequestConfig({
      contextWindow: ref(32000),
      workspaceRoot: ref('/workspace'),
      resolveServiceConfig: vi.fn(async () => {
        order.push('service');
        return { providerId: 'provider', modelId: 'model', toolSupport: { supported: true, reason: 'supported' } };
      }),
      assertWorkspaceAvailable: vi.fn(async (): Promise<void> => {
        order.push('workspace');
      }),
      syncAIResources: vi.fn(async (): Promise<void> => {
        order.push('sync');
      }),
      getActiveTools: vi.fn(() => [createTool('edit_memory')]),
      getSkillContentHashes: vi.fn(() => ({ weather: 'hash-1' })),
      resolveSkillSnapshots: vi.fn(async () => []),
      resolveRuntimeSystemPrompt: vi.fn(async () => 'system'),
      resolveRuntimeTavilyConfig: vi.fn(() => undefined),
      resolveRuntimeMcpRequestConfig: vi.fn(() => undefined),
      onMissingServiceConfig: vi.fn()
    });

    const prepared = await hook.prepareRuntimeRequest(USER_MESSAGE, [
      {
        id: 'file-1',
        type: 'file',
        filename: 'b.md',
        mime: 'text/markdown',
        url: 'file:///notes/b.md',
        path: '/notes/b.md',
        sourceText: { start: 0, end: 10, value: '@b.md' }
      }
    ]);

    expect(order).toEqual(['service', 'workspace', 'sync']);
    const preparedModel: ChatRuntimeModelSelection | undefined = prepared?.config.model;
    expect(preparedModel).toBeDefined();
    expect(prepared?.config.model).toEqual({ providerId: 'provider', modelId: 'model' });
    expect(prepared?.config.skillContentHashes).toEqual({ weather: 'hash-1' });
    expect(prepared?.memorySelection).toMatchObject({ mode: 'full', references: ['/notes/a.md', '/notes/b.md'] });
  });

  it('reports missing model configuration without synchronizing resources', async (): Promise<void> => {
    const onMissingServiceConfig = vi.fn();
    const syncAIResources = vi.fn();
    const hook = useRuntimeRequestConfig({
      contextWindow: ref(8000),
      workspaceRoot: ref(''),
      resolveServiceConfig: vi.fn(async () => undefined),
      syncAIResources,
      getActiveTools: vi.fn(() => []),
      getSkillContentHashes: vi.fn(() => ({})),
      resolveSkillSnapshots: vi.fn(async () => []),
      resolveRuntimeSystemPrompt: vi.fn(async () => undefined),
      resolveRuntimeTavilyConfig: vi.fn(() => undefined),
      resolveRuntimeMcpRequestConfig: vi.fn(() => undefined),
      onMissingServiceConfig
    });

    expect(await hook.prepareRuntimeRequest(USER_MESSAGE)).toBeNull();
    expect(onMissingServiceConfig).toHaveBeenCalledOnce();
    expect(syncAIResources).not.toHaveBeenCalled();
  });

  it('resolves structured Skill references and targets only their source user message', async (): Promise<void> => {
    const skillSnapshot = {
      name: 'weather',
      content: 'Use the weather workflow.',
      contentHash: 'hash-weather',
      filePath: '/skills/weather/SKILL.md'
    };
    const resolveSkillSnapshots = vi.fn(async () => [skillSnapshot]);
    const hook = useRuntimeRequestConfig({
      contextWindow: ref(16000),
      workspaceRoot: ref('/workspace'),
      resolveServiceConfig: vi.fn(async () => ({ providerId: 'provider', modelId: 'model', toolSupport: { supported: false, reason: 'unsupported' } })),
      syncAIResources: vi.fn(async (): Promise<void> => undefined),
      getActiveTools: vi.fn(() => []),
      getSkillContentHashes: vi.fn(() => ({ weather: 'hash-weather' })),
      resolveSkillSnapshots,
      resolveRuntimeSystemPrompt: vi.fn(async () => undefined),
      resolveRuntimeTavilyConfig: vi.fn(() => undefined),
      resolveRuntimeMcpRequestConfig: vi.fn(() => undefined),
      onMissingServiceConfig: vi.fn()
    });
    const selectedMessage: Message = {
      ...USER_MESSAGE,
      parts: [
        {
          id: 'skill-reference-1',
          type: 'skill_reference',
          name: 'weather',
          sourceText: { start: 0, end: 12, value: '{{$weather}}' }
        },
        {
          id: 'skill-reference-2',
          type: 'skill_reference',
          name: 'weather',
          sourceText: { start: 13, end: 25, value: '{{$weather}}' }
        }
      ]
    };

    const prepared = await hook.prepareRuntimeRequest(selectedMessage);

    expect(resolveSkillSnapshots).toHaveBeenCalledWith(['weather', 'weather']);
    expect(prepared?.config.runtimeContext).toEqual({
      skill: {
        targetMessageId: 'user-1',
        snapshots: [skillSnapshot]
      }
    });
  });
});
