/**
 * @file use-runtime-tools.test.ts
 * @description BChat Runtime 工具动态过滤测试。
 */
import type { AIToolExecutor } from 'types/ai';
import type { ChatToolBinding } from 'types/chat-runtime';
import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createOpenWidgetTool, type OpenWidgetRuntimeState, type OpenWidgetToolOptions } from '@/ai/tools/builtin/WidgetTool';
import { useRuntimeTools } from '@/components/BChat/hooks/useRuntimeTools';
import { getToolNamesByExposure, getToolRegistryEntry } from '../../../shared/ai/tools/index.js';

const builtinMockState = vi.hoisted(() => {
  /** 内置工具工厂测试选项。 */
  interface BuiltinToolOptionsFixture {
    /** 读取绑定的会话 ID。 */
    getSessionId?: () => string | undefined;
    /** 读取绑定的工作区根目录。 */
    getWorkspaceRoot?: () => string | null;
  }

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
    createBuiltinTools: vi.fn<(options?: BuiltinToolOptionsFixture) => ReturnType<typeof createExecutor>[]>(() => [
      createExecutor('open_resource'),
      createExecutor('read_directory'),
      createExecutor('glob'),
      createExecutor('grep')
    ])
  };
});

const activeChatToolsMock = vi.hoisted(() => ({
  getActiveBinding: vi.fn<() => ChatToolBinding | undefined>(() => undefined),
  getBoundTools: vi.fn<(_binding: ChatToolBinding) => AIToolExecutor[]>(() => []),
  getHiddenToolNames: vi.fn<(_binding: ChatToolBinding) => readonly string[]>(() => []),
  dispatchAppBridge: vi.fn()
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
    ['open_resource', 'read_directory', 'glob', 'grep', 'skill', 'widget', 'open_widget'].includes(toolName)
  ),
  OPEN_RESOURCE_TOOL_NAME: 'open_resource',
  READ_DIRECTORY_TOOL_NAME: 'read_directory',
  GLOB_TOOL_NAME: 'glob',
  GREP_TOOL_NAME: 'grep',
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

vi.mock('@/hooks/useChat/useContextRegistry', () => ({
  useActiveChatContext: () => activeChatToolsMock
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
function createRuntimeTools(workspaceRoot = ref<string | null>('/workspace'), sessionId = ref<string>('session-1')): ReturnType<typeof useRuntimeTools> {
  return useRuntimeTools({
    createConfirmationAdapter: () => ({ confirm: vi.fn(async (): Promise<true> => true) }),
    getSessionId: (): string => sessionId.value,
    openWebview: vi.fn(),
    workspaceRoot,
    getWorkspaceRoot: (): string | null => workspaceRoot.value,
    getPendingQuestion: (): null => null
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
    activeChatToolsMock.getActiveBinding.mockReturnValue(undefined);
    activeChatToolsMock.getBoundTools.mockReturnValue([]);
    activeChatToolsMock.getHiddenToolNames.mockReturnValue([]);
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

  it('only exposes WebView tools while a WebView provider is active', (): void => {
    const runtimeTools = createRuntimeTools();

    expect(readActiveToolNames(runtimeTools.getActiveTools)).toEqual(expect.arrayContaining(['open_resource']));
    expect(readActiveToolNames(runtimeTools.getActiveTools)).not.toEqual(expect.arrayContaining(['read_current_webpage', 'operate_current_webpage']));

    activeChatToolsMock.getActiveBinding.mockReturnValue({ providerId: 'webview', resourceId: 'webview-a' });
    activeChatToolsMock.getBoundTools.mockReturnValue([
      builtinMockState.createExecutor('read_current_webpage'),
      builtinMockState.createExecutor('operate_current_webpage')
    ]);
    activeChatToolsMock.getHiddenToolNames.mockReturnValue(['open_resource']);

    const activeToolNames = readActiveToolNames(runtimeTools.getActiveTools);
    expect(activeToolNames).toEqual(expect.arrayContaining(['read_current_webpage', 'operate_current_webpage']));
    expect(activeToolNames).not.toContain('open_resource');
  });

  it('uses the injected session workspace when exposing workspace-scoped discovery tools', (): void => {
    const workspaceRoot = ref<string | null>(null);
    const runtimeTools = createRuntimeTools(workspaceRoot);

    const noWorkspaceToolNames = readActiveToolNames(runtimeTools.getActiveTools);
    expect(noWorkspaceToolNames).not.toContain('read_directory');
    expect(noWorkspaceToolNames).not.toContain('glob');
    expect(noWorkspaceToolNames).not.toContain('grep');

    workspaceRoot.value = '/private/tmp/project';

    expect(readActiveToolNames(runtimeTools.getActiveTools)).toEqual(expect.arrayContaining(['read_directory', 'glob', 'grep']));
  });

  it('does not add page tools when a provider only registers environment context', (): void => {
    const runtimeTools = createRuntimeTools();

    activeChatToolsMock.getActiveBinding.mockReturnValue({ providerId: 'widget', resourceId: 'widget-a' });
    activeChatToolsMock.getBoundTools.mockReturnValue([]);

    expect(readActiveToolNames(runtimeTools.getActiveTools)).toEqual(expect.arrayContaining(['open_resource']));
  });

  it('binds builtin callbacks to the immutable Runtime session and workspace', (): void => {
    const workspaceRoot = ref<string | null>('/workspace-a');
    const sessionId = ref<string>('session-a');
    const runtimeTools = createRuntimeTools(workspaceRoot, sessionId);

    runtimeTools.getActiveTools({
      sessionId: 'session-a',
      runtimeId: 'runtime-a',
      workspaceRoot: '/workspace-a'
    });
    sessionId.value = 'session-b';
    workspaceRoot.value = '/workspace-b';

    const boundOptions = builtinMockState.createBuiltinTools.mock.calls.at(-1)?.[0];
    expect(boundOptions?.getSessionId?.()).toBe('session-a');
    expect(boundOptions?.getWorkspaceRoot?.()).toBe('/workspace-a');
  });

  it('merges tools from the exact generic binding and applies hidden names', (): void => {
    const binding = { providerId: 'webview', resourceId: 'webview-a' };
    activeChatToolsMock.getBoundTools.mockImplementation((value: ChatToolBinding): AIToolExecutor[] =>
      value.providerId === 'webview' && value.resourceId === 'webview-a'
        ? [builtinMockState.createExecutor('read_current_webpage'), builtinMockState.createExecutor('operate_current_webpage')]
        : []
    );
    activeChatToolsMock.getHiddenToolNames.mockReturnValue(['open_resource']);
    const runtimeTools = createRuntimeTools();

    const activeToolNames = runtimeTools
      .getActiveTools({
        sessionId: 'session-a',
        runtimeId: 'runtime-a',
        workspaceRoot: '/workspace-a',
        toolContext: binding
      })
      .map((tool) => tool.definition.name);

    expect(activeToolNames).toEqual(expect.arrayContaining(['read_current_webpage', 'operate_current_webpage']));
    expect(activeToolNames).not.toContain('open_resource');
    expect(activeChatToolsMock.getActiveBinding).not.toHaveBeenCalled();
  });

  it('accepts a newly registered page tool without a central builtin-name entry', (): void => {
    const binding = { providerId: 'test-page', resourceId: 'page-a' };
    activeChatToolsMock.getBoundTools.mockReturnValue([builtinMockState.createExecutor('inspect_test_page')]);
    const runtimeTools = createRuntimeTools();

    const activeToolNames = runtimeTools
      .getActiveTools({
        sessionId: 'session-a',
        runtimeId: 'runtime-a',
        workspaceRoot: '/workspace-a',
        toolContext: binding
      })
      .map((tool) => tool.definition.name);

    expect(activeToolNames).toContain('inspect_test_page');
  });

  it('applies page hidden names to application tools created dynamically', (): void => {
    const binding = { providerId: 'future-page', resourceId: 'page-a' };
    storeMockState.widgetStore.initialized = true;
    storeMockState.widgetStore.getEnabledWidgets.mockReturnValue([{ id: 'weather', enabled: true, parseError: undefined }]);
    activeChatToolsMock.getHiddenToolNames.mockReturnValue(['open_widget']);
    const runtimeTools = createRuntimeTools();

    const activeToolNames = runtimeTools
      .getActiveTools({
        sessionId: 'session-a',
        runtimeId: 'runtime-a',
        workspaceRoot: '/workspace-a',
        toolContext: binding
      })
      .map((tool) => tool.definition.name);

    expect(activeToolNames).not.toContain('open_widget');
    expect(activeToolNames).toContain('widget');
  });

  it('does not fall back to the current page for a bound Runtime without a tool context', (): void => {
    activeChatToolsMock.getActiveBinding.mockReturnValue({ providerId: 'webview', resourceId: 'webview-current' });
    activeChatToolsMock.getBoundTools.mockReturnValue([builtinMockState.createExecutor('read_current_webpage')]);
    const runtimeTools = createRuntimeTools();

    const activeToolNames = runtimeTools
      .getActiveTools({
        sessionId: 'session-a',
        runtimeId: 'runtime-a',
        workspaceRoot: '/workspace-a'
      })
      .map((tool) => tool.definition.name);

    expect(activeToolNames).not.toContain('read_current_webpage');
    expect(activeToolNames).toContain('open_resource');
    expect(activeChatToolsMock.getActiveBinding).not.toHaveBeenCalled();
    expect(activeChatToolsMock.getBoundTools).not.toHaveBeenCalled();
  });

  it('rejects a page tool that conflicts with an application tool name', (): void => {
    const binding = { providerId: 'future-page', resourceId: 'page-a' };
    activeChatToolsMock.getBoundTools.mockReturnValue([builtinMockState.createExecutor('open_resource')]);
    const runtimeTools = createRuntimeTools();

    expect(() =>
      runtimeTools.getActiveTools({
        sessionId: 'session-a',
        runtimeId: 'runtime-a',
        workspaceRoot: '/workspace-a',
        toolContext: binding
      })
    ).toThrow('Page tool conflicts with application tool: open_resource');
  });

  it('does not let hidden names disguise a page override of an application tool', (): void => {
    const binding = { providerId: 'future-page', resourceId: 'page-a' };
    activeChatToolsMock.getBoundTools.mockReturnValue([builtinMockState.createExecutor('open_resource')]);
    activeChatToolsMock.getHiddenToolNames.mockReturnValue(['open_resource']);
    const runtimeTools = createRuntimeTools();

    expect(() =>
      runtimeTools.getActiveTools({
        sessionId: 'session-a',
        runtimeId: 'runtime-a',
        workspaceRoot: '/workspace-a',
        toolContext: binding
      })
    ).toThrow('Page tool conflicts with application tool: open_resource');
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
    builtinMockState.createBuiltinTools.mockReturnValueOnce([builtinMockState.createExecutor('read_directory'), staleOpenWidgetTool]);
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
