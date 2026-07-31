/**
 * @file use-runtime-tools.test.ts
 * @description BChat Runtime 工具动态过滤测试。
 */
import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createOpenWidgetTool, type OpenWidgetRuntimeState, type OpenWidgetToolOptions } from '@/ai/tools/builtin/WidgetTool';
import type { WebviewToolContext } from '@/ai/tools/context/webview';
import { useRuntimeTools } from '@/components/BChat/hooks/useRuntimeTools';
import type { Message } from '@/components/BChat/utils/types';
import { getToolNamesByExposure, getToolRegistryEntry } from '../../../shared/ai/tools/index.js';

const builtinMockState = vi.hoisted(() => {
  /**
   * 创建最小工具执行器夹具。
   * @param name - 工具名称
   * @returns 工具执行器夹具
   */
  function createExecutor(name: string): {
    definition: {
      name: string;
      description: string;
      source: 'builtin';
      riskLevel: 'read';
      parameters: { type: 'object'; properties: Record<string, unknown> };
    };
    execute: () => Promise<{ toolName: string; status: 'success'; data: null }>;
  } {
    return {
      definition: {
        name,
        description: name,
        source: 'builtin',
        riskLevel: 'read',
        parameters: { type: 'object', properties: {} }
      },
      execute: async (): Promise<{ toolName: string; status: 'success'; data: null }> => ({ toolName: name, status: 'success', data: null })
    };
  }

  return {
    createExecutor,
    createBuiltinTools: vi.fn(() => [
      createExecutor('read_current_webpage'),
      createExecutor('operate_webpage'),
      createExecutor('open_resource'),
      createExecutor('read_directory')
    ])
  };
});

const registryMockState = vi.hoisted(() => ({
  editorToolContextRegistry: {
    getCurrentContext: vi.fn(() => undefined),
    getContext: vi.fn(() => undefined)
  },
  webviewToolContextRegistry: {
    getCurrentContext: vi.fn((): unknown => undefined)
  }
}));

const storeMockState = vi.hoisted(() => ({
  skillStore: {
    initialized: false,
    getEnabledSkills: vi.fn(() => []),
    resolveLatestSkill: vi.fn(),
    resolveLatestEnabledSkill: vi.fn(),
    waitForInit: vi.fn(() => Promise.resolve()),
    syncFromDisk: vi.fn(() => Promise.resolve()),
    syncDirtyFromDisk: vi.fn(() => Promise.resolve())
  },
  widgetStore: {
    initialized: false,
    getEnabledWidgets: vi.fn<() => unknown[]>(() => []),
    waitForInit: vi.fn(() => Promise.resolve()),
    syncFromDisk: vi.fn(() => Promise.resolve()),
    syncDirtyFromDisk: vi.fn(() => Promise.resolve())
  },
  toolSettingsStore: {
    hasEnabledMcpServers: false
  },
  recentStore: {
    recentFiles: [],
    getFileByPath: vi.fn(() => Promise.resolve(null))
  }
}));

const workspaceMockState = vi.hoisted(() => ({
  workspaceRoot: { value: '/workspace' },
  getWorkspaceRoot: vi.fn(() => '/workspace')
}));

const widgetRuntimeMockState = vi.hoisted(() => {
  const httpClient = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn()
  };
  const executeWidgetRuntime = vi.fn(
    async (state: unknown): Promise<{ state: unknown; execution: { status: 'success'; output: undefined } }> => ({
      state,
      execution: { status: 'success', output: undefined }
    })
  );

  return {
    httpClient,
    createWidgetHttpClient: vi.fn(() => httpClient),
    executeWidgetRuntime
  };
});

vi.mock('@/ai/tools/builtin', () => ({
  createBuiltinTools: builtinMockState.createBuiltinTools,
  isBuiltinToolName: vi.fn((toolName: string): boolean =>
    ['read_current_webpage', 'operate_webpage', 'open_resource', 'read_directory', 'skill', 'widget', 'open_widget'].includes(toolName)
  ),
  OPERATE_WEBPAGE_TOOL_NAME: 'operate_webpage',
  OPEN_RESOURCE_TOOL_NAME: 'open_resource',
  READ_CURRENT_WEBPAGE_TOOL_NAME: 'read_current_webpage',
  READ_DIRECTORY_TOOL_NAME: 'read_directory',
  OPEN_WIDGET_TOOL_NAME: 'open_widget',
  SKILL_TOOL_NAME: 'skill',
  WIDGET_TOOL_NAME: 'widget'
}));

vi.mock('@/ai/tools/builtin/SkillTool', () => ({
  createSkillTool: vi.fn()
}));

vi.mock('@/ai/tools/builtin/WidgetTool', () => ({
  createOpenWidgetTool: vi.fn(() => ({
    definition: {
      name: 'open_widget',
      description: 'open_widget',
      source: 'builtin',
      riskLevel: 'read',
      parameters: { type: 'object', properties: {} }
    },
    execute: async (): Promise<{ toolName: string; status: 'success'; data: null }> => ({ toolName: 'open_widget', status: 'success', data: null })
  })),
  createWidgetTool: vi.fn(() => ({
    definition: {
      name: 'widget',
      description: 'widget',
      source: 'builtin',
      riskLevel: 'read',
      parameters: { type: 'object', properties: {} }
    },
    execute: async (): Promise<{ toolName: string; status: 'success'; data: null }> => ({ toolName: 'widget', status: 'success', data: null })
  }))
}));

vi.mock('@/components/BWidget/utils/widgetRuntime', () => ({
  createWidgetHttpClient: widgetRuntimeMockState.createWidgetHttpClient,
  executeWidgetRuntime: widgetRuntimeMockState.executeWidgetRuntime
}));

vi.mock('@/ai/tools/context/editor', () => ({
  editorToolContextRegistry: registryMockState.editorToolContextRegistry
}));

vi.mock('@/ai/tools/context/webview', () => ({
  webviewToolContextRegistry: registryMockState.webviewToolContextRegistry
}));

vi.mock('@/hooks/useNavigate', () => ({
  useNavigate: vi.fn(() => ({
    openDraft: vi.fn(),
    openFileByPath: vi.fn()
  }))
}));

vi.mock('@/hooks/useWorkspaceRoot', () => ({
  useWorkspaceRoot: vi.fn(() => workspaceMockState)
}));

vi.mock('@/shared/platform', () => ({
  native: {
    openExternal: vi.fn()
  }
}));

vi.mock('@/stores/ai/skill', () => ({
  useSkillStore: vi.fn(() => storeMockState.skillStore)
}));

vi.mock('@/stores/ai/widget', () => ({
  useWidgetStore: vi.fn(() => storeMockState.widgetStore)
}));

vi.mock('@/stores/ai/toolSettings', () => ({
  useToolSettingsStore: vi.fn(() => storeMockState.toolSettingsStore)
}));

vi.mock('@/stores/workspace/recent', () => ({
  useRecentStore: vi.fn(() => storeMockState.recentStore)
}));

/**
 * 创建 Runtime 工具 hook。
 * @returns Runtime 工具 hook 返回值
 */
function createRuntimeTools(workspaceRoot = ref<string | null>('/workspace')): ReturnType<typeof useRuntimeTools> {
  return useRuntimeTools({
    messages: ref<Message[]>([]),
    confirm: { confirm: vi.fn(async (): Promise<true> => true) },
    getSessionId: (): string => 'session-1',
    openWebview: vi.fn(),
    workspaceRoot,
    getWorkspaceRoot: (): string | null => workspaceRoot.value
  });
}

/**
 * 获取活跃工具名称。
 * @param getActiveTools - 活跃工具读取函数
 * @returns 工具名称数组
 */
function readActiveToolNames(getActiveTools: ReturnType<typeof useRuntimeTools>['getActiveTools']): string[] {
  return getActiveTools().map((tool) => tool.definition.name);
}

/**
 * 读取最近创建的 open_widget 工具选项。
 * @returns open_widget 工具创建选项
 */
function readLatestOpenWidgetOptions(): OpenWidgetToolOptions {
  const options = vi.mocked(createOpenWidgetTool).mock.calls.at(-1)?.[1];

  if (!options) {
    throw new Error('open_widget 工具未创建');
  }

  return options;
}

describe('useRuntimeTools', () => {
  it('derives the default disabled boundary from the real shared registry', (): void => {
    const defaultToolNames = getToolNamesByExposure('chat-default');

    expect(defaultToolNames).not.toContain('delegate_task');
    expect(getToolRegistryEntry('delegate_task')).toMatchObject({
      exposure: 'internal',
      executionClass: 'deferred-coordination'
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    registryMockState.webviewToolContextRegistry.getCurrentContext.mockReturnValue(undefined);
    storeMockState.skillStore.initialized = false;
    storeMockState.skillStore.getEnabledSkills.mockReturnValue([]);
    storeMockState.skillStore.resolveLatestSkill.mockReset();
    storeMockState.skillStore.resolveLatestEnabledSkill.mockReset();
    storeMockState.skillStore.syncDirtyFromDisk.mockClear();
    storeMockState.skillStore.syncFromDisk.mockClear();
    storeMockState.widgetStore.initialized = false;
    storeMockState.widgetStore.getEnabledWidgets.mockReturnValue([]);
    storeMockState.widgetStore.syncDirtyFromDisk.mockClear();
    storeMockState.widgetStore.syncFromDisk.mockClear();
  });

  it('only exposes WebView tools while a WebView context is active', (): void => {
    const runtimeTools = createRuntimeTools();

    expect(readActiveToolNames(runtimeTools.getActiveTools)).toEqual(expect.arrayContaining(['open_resource']));
    expect(readActiveToolNames(runtimeTools.getActiveTools)).not.toEqual(expect.arrayContaining(['read_current_webpage', 'operate_webpage']));

    const webviewContext: WebviewToolContext = {
      readPageSnapshot: vi.fn(),
      operatePage: vi.fn()
    };
    registryMockState.webviewToolContextRegistry.getCurrentContext.mockReturnValue(webviewContext);

    const activeToolNames = readActiveToolNames(runtimeTools.getActiveTools);
    expect(activeToolNames).toEqual(expect.arrayContaining(['read_current_webpage', 'operate_webpage']));
    expect(activeToolNames).not.toContain('open_resource');
  });

  it('uses the injected session workspace when exposing directory tools', (): void => {
    const workspaceRoot = ref<string | null>(null);
    const runtimeTools = createRuntimeTools(workspaceRoot);

    expect(readActiveToolNames(runtimeTools.getActiveTools)).not.toContain('read_directory');

    workspaceRoot.value = '/private/tmp/project';

    expect(readActiveToolNames(runtimeTools.getActiveTools)).toContain('read_directory');
  });

  it('dynamically exposes widget tools after widget store is initialized', (): void => {
    storeMockState.widgetStore.initialized = true;
    storeMockState.widgetStore.getEnabledWidgets.mockReturnValue([
      {
        id: 'weather',
        enabled: true,
        parseError: undefined
      }
    ]);

    const runtimeTools = createRuntimeTools();

    expect(readActiveToolNames(runtimeTools.getActiveTools)).toContain('widget');
    expect(readActiveToolNames(runtimeTools.getActiveTools)).toContain('open_widget');
  });

  it('synchronizes dirty Skill and Widget stores before request tool discovery', async (): Promise<void> => {
    const runtimeTools = createRuntimeTools();

    await runtimeTools.syncAIResources();

    expect(storeMockState.skillStore.waitForInit).toHaveBeenCalledTimes(1);
    expect(storeMockState.widgetStore.waitForInit).toHaveBeenCalledTimes(1);
    expect(storeMockState.skillStore.syncDirtyFromDisk).toHaveBeenCalledTimes(1);
    expect(storeMockState.widgetStore.syncDirtyFromDisk).toHaveBeenCalledTimes(1);
    expect(storeMockState.skillStore.syncFromDisk).not.toHaveBeenCalled();
    expect(storeMockState.widgetStore.syncFromDisk).not.toHaveBeenCalled();
  });

  it('deduplicates explicitly selected Skills and allows disabled definitions', async (): Promise<void> => {
    storeMockState.skillStore.resolveLatestSkill.mockImplementation(async (name: string) => ({
      name,
      description: name,
      content: `${name} instructions`,
      contentHash: `${name}-hash`,
      filePath: `/skills/${name}/SKILL.md`,
      dirPath: `/skills/${name}`,
      source: 'global',
      enabled: false,
      parsedAt: 1
    }));
    const runtimeTools = createRuntimeTools();

    const snapshots = await runtimeTools.resolveSkillSnapshots(['weather', 'search', 'weather']);

    expect(storeMockState.skillStore.resolveLatestSkill).toHaveBeenCalledTimes(2);
    expect(storeMockState.skillStore.resolveLatestEnabledSkill).not.toHaveBeenCalled();
    expect(snapshots.map((snapshot) => snapshot.name)).toEqual(['weather', 'search']);
    expect(snapshots[0]).toMatchObject({ content: 'weather instructions', contentHash: 'weather-hash' });
  });

  it('rejects a selected Skill that is no longer available', async (): Promise<void> => {
    storeMockState.skillStore.resolveLatestSkill.mockResolvedValue(undefined);
    const runtimeTools = createRuntimeTools();

    await expect(runtimeTools.resolveSkillSnapshots(['missing'])).rejects.toMatchObject({
      code: 'SKILL_UNAVAILABLE',
      message: expect.stringContaining('技能“missing”已删除或解析失败')
    });
  });

  it('replaces prebuilt open_widget with the renderer executable widget tool', (): void => {
    const staleOpenWidgetTool = builtinMockState.createExecutor('open_widget');
    builtinMockState.createBuiltinTools.mockReturnValueOnce([builtinMockState.createExecutor('read_current_webpage'), staleOpenWidgetTool]);
    storeMockState.widgetStore.initialized = true;
    storeMockState.widgetStore.getEnabledWidgets.mockReturnValue([
      {
        id: 'weather',
        enabled: true,
        parseError: undefined
      }
    ]);

    const runtimeTools = createRuntimeTools();
    const openWidgetTools = runtimeTools.getActiveTools().filter((tool): boolean => tool.definition.name === 'open_widget');

    expect(openWidgetTools).toHaveLength(1);
    expect(openWidgetTools[0]).not.toBe(staleOpenWidgetTool);
    expect(createOpenWidgetTool).toHaveBeenCalledWith(
      storeMockState.widgetStore,
      expect.objectContaining({
        executeWidget: expect.any(Function)
      })
    );
  });

  it('passes a managed widget runtime host to the open_widget execute lifecycle', async (): Promise<void> => {
    storeMockState.widgetStore.initialized = true;
    storeMockState.widgetStore.getEnabledWidgets.mockReturnValue([
      {
        id: 'weather',
        enabled: true,
        parseError: undefined
      }
    ]);

    const runtimeTools = createRuntimeTools();
    runtimeTools.getActiveTools();
    const options = readLatestOpenWidgetOptions();
    const state: OpenWidgetRuntimeState = {
      value: {} as OpenWidgetRuntimeState['value'],
      renderContext: {
        input: {},
        output: undefined,
        data: {}
      }
    };

    await options.executeWidget?.({ state });

    expect(widgetRuntimeMockState.createWidgetHttpClient).toHaveBeenCalledTimes(1);
    expect(widgetRuntimeMockState.executeWidgetRuntime).toHaveBeenCalledWith(state, {
      http: widgetRuntimeMockState.httpClient,
      onLogger: expect.any(Function),
      onConsole: expect.any(Function)
    });
  });
});
