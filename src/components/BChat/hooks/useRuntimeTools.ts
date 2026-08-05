/**
 * @file useRuntimeTools.ts
 * @description ChatRuntime 内置工具创建和动态过滤 hook。
 */
import type { AIToolExecutor } from 'types/ai';
import type { ChatRuntimeSkillSnapshot } from 'types/chat-runtime';
import type { Ref } from 'vue';
import { uniq } from 'lodash-es';
import type { SkillDefinition } from '@/ai/skill/types';
import {
  createBuiltinTools,
  isBuiltinToolName,
  OPEN_WIDGET_TOOL_NAME,
  OPERATE_WEBPAGE_TOOL_NAME,
  OPEN_RESOURCE_TOOL_NAME,
  READ_CURRENT_WEBPAGE_TOOL_NAME,
  READ_CURRENT_WIDGET_TOOL_NAME,
  READ_DIRECTORY_TOOL_NAME,
  SKILL_TOOL_NAME,
  WIDGET_TOOL_NAME
} from '@/ai/tools/builtin';
import { createSkillTool } from '@/ai/tools/builtin/SkillTool';
import { createOpenWidgetTool, createWidgetTool } from '@/ai/tools/builtin/WidgetTool';
import type { AIToolConfirmationAdapter } from '@/ai/tools/confirmation';
import { editorToolContextRegistry } from '@/ai/tools/context/editor';
import { webviewToolContextRegistry } from '@/ai/tools/context/webview';
import { widgetToolContextRegistry } from '@/ai/tools/context/widget';
import { createWidgetHttpClient, executeWidgetRuntime, type WidgetConsoleLevel, type WidgetLogLevel } from '@/components/BWidget/utils/widgetRuntime';
import { formatWidgetLogArgs } from '@/components/BWidget/utils/widgetRuntime/logger';
import { useNavigate } from '@/hooks/useNavigate';
import { logger } from '@/shared/logger';
import { native } from '@/shared/platform';
import { useSkillStore } from '@/stores/ai/skill';
import { useToolSettingsStore } from '@/stores/ai/toolSettings';
import { useWidgetStore } from '@/stores/ai/widget';
import { useRecentStore } from '@/stores/workspace/recent';
import { createRuntimeError } from '../utils/runtimeError';

/** Runtime 工具发现时冻结的资源身份。 */
export interface RuntimeToolResourceBinding {
  /** 请求准备时冻结的工作区根目录。 */
  readonly workspaceRoot?: string | null;
  /** 请求准备时冻结的文档 ID。 */
  readonly documentId?: string;
  /** 请求准备时冻结的 WebView 标签 ID。 */
  readonly webviewId?: string;
  /** 请求准备时冻结的 Widget 编辑页 ID。 */
  readonly widgetId?: string;
}

/** Runtime 工具绑定后不可变的执行身份。 */
export interface RuntimeToolBinding extends RuntimeToolResourceBinding {
  /** 持久化会话 ID。 */
  readonly sessionId: string;
  /** 主进程 Runtime ID。 */
  readonly runtimeId: string;
  /** 请求准备时冻结的工作区根目录。 */
  readonly workspaceRoot: string | null;
}

/** Runtime 工具发现或执行可接受的绑定输入。 */
export type RuntimeToolDiscoveryBinding = RuntimeToolResourceBinding | RuntimeToolBinding;

/** 待回答 Question 的最小快照。 */
interface PendingQuestionSnapshot {
  /** Question 业务 ID。 */
  questionId: string;
  /** 发起 Question 的工具调用 ID。 */
  toolCallId: string;
}

/**
 * Runtime 工具 hook 配置。
 */
interface UseRuntimeToolsOptions {
  /** 按 Runtime 绑定创建工具确认适配器。 */
  createConfirmationAdapter: (binding?: RuntimeToolBinding) => AIToolConfirmationAdapter;
  /** 获取当前活跃会话 ID。 */
  getSessionId: () => string | undefined;
  /** 当前会话最终生效的工作区根目录。 */
  workspaceRoot: Readonly<Ref<string | null>>;
  /** 同步读取当前会话最终生效的工作区根目录。 */
  getWorkspaceRoot: () => string | null;
  /** 按会话读取待回答 Question，避免绑定执行器读取可见页面消息。 */
  getPendingQuestion: (sessionId: string) => PendingQuestionSnapshot | null;
  /** 在内置 WebView 中打开 URL。 */
  openWebview: (url: URL) => void;
}

/**
 * Runtime 工具 hook 返回值。
 */
interface UseRuntimeToolsReturn {
  /** 动态获取当前可用工具列表。 */
  getActiveTools: (binding?: RuntimeToolDiscoveryBinding) => AIToolExecutor[];
  /** 发送请求前同步 Skill 与 Widget 磁盘定义。 */
  syncAIResources: () => Promise<void>;
  /** 获取当前已启用 Skill 的内容版本。 */
  getSkillContentHashes: () => Record<string, string>;
  /** 解析本轮显式选择的 Skill 内容快照。 */
  resolveSkillSnapshots: (names: string[]) => Promise<ChatRuntimeSkillSnapshot[]>;
  /** 创建并打开未保存草稿。 */
  openDraft: ReturnType<typeof useNavigate>['openDraft'];
  /** 通过文件路径打开文件标签页。 */
  openFileByPath: ReturnType<typeof useNavigate>['openFileByPath'];
}

/**
 * 管理 ChatRuntime 内置工具创建和运行时可用性过滤。
 * @param options - Runtime 工具 hook 配置
 * @returns Runtime 工具能力
 */
export function useRuntimeTools(options: UseRuntimeToolsOptions): UseRuntimeToolsReturn {
  const skillStore = useSkillStore();
  const widgetStore = useWidgetStore();
  const toolSettingsStore = useToolSettingsStore();
  const recentStore = useRecentStore();
  const { openDraft, openFileByPath } = useNavigate();
  /** open_widget 前置执行阶段复用的托管 HTTP 客户端。 */
  const widgetHttpClient = createWidgetHttpClient();
  /**
   * 把 open_widget 预执行阶段的小组件日志写入应用日志。
   * @param level - 日志级别
   * @param args - 原始日志参数
   */
  async function handleWidgetLogger(level: WidgetLogLevel, args: unknown[]): Promise<void> {
    await logger[level](`[widget] ${formatWidgetLogArgs(args)}`);
  }

  /**
   * 把 open_widget 预执行阶段的小组件 console 转发到 DevTools。
   * @param level - console 级别
   * @param args - 原始 console 参数
   */
  function handleWidgetConsole(level: WidgetConsoleLevel, args: unknown[]): void {
    console[level](...args);
  }

  /** open_widget 前置执行阶段复用的运行态宿主能力。 */
  const openWidgetRuntimeHost = {
    http: widgetHttpClient,
    onLogger: handleWidgetLogger,
    onConsole: handleWidgetConsole
  };

  /**
   * 判断工具绑定是否包含可执行 Runtime 身份。
   * @param binding - 工具发现或执行绑定
   * @returns 是否为完整 Runtime 工具绑定
   */
  function isRuntimeToolBinding(binding: RuntimeToolDiscoveryBinding | undefined): binding is RuntimeToolBinding {
    return Boolean(
      binding && 'sessionId' in binding && 'runtimeId' in binding && typeof binding.sessionId === 'string' && typeof binding.runtimeId === 'string'
    );
  }

  /**
   * 为候选工具创建本次调用专属的内置执行器。
   * @param binding - 可选的不可变 Runtime 身份；缺省时仅用于请求前工具发现
   * @returns 新创建的内置工具执行器
   */
  function createBoundTools(binding?: RuntimeToolDiscoveryBinding): AIToolExecutor[] {
    const runtimeBinding = isRuntimeToolBinding(binding) ? binding : undefined;
    const boundSessionId = runtimeBinding?.sessionId;
    const boundWorkspaceRoot = binding?.workspaceRoot;
    const getSessionId = boundSessionId ? (): string => boundSessionId : options.getSessionId;
    const getWorkspaceRoot = binding && boundWorkspaceRoot !== undefined ? (): string | null => boundWorkspaceRoot : options.getWorkspaceRoot;

    /** @returns Runtime 绑定的 WebView 上下文；未绑定时读取当前上下文。 */
    function getWebviewContext(): unknown {
      if (!binding) return webviewToolContextRegistry.getCurrentContext();
      if (!binding.webviewId) return undefined;
      return webviewToolContextRegistry.getContext(binding.webviewId);
    }

    /** @returns Runtime 绑定的 Widget 编辑器上下文；未绑定时读取当前上下文。 */
    function getWidgetContext(): unknown {
      if (!binding) return widgetToolContextRegistry.getCurrentContext();
      if (!binding.widgetId) return undefined;
      return widgetToolContextRegistry.getContext(binding.widgetId);
    }

    return createBuiltinTools({
      confirm: options.createConfirmationAdapter(runtimeBinding),
      skillStore,
      widgetStore,
      mcpStore: toolSettingsStore,
      getWorkspaceRoot,
      isFileInRecent: (filePath: string): boolean => {
        return Boolean(recentStore.recentFiles?.some((file): boolean => file.path === filePath));
      },
      getWebviewContext,
      getWidgetContext,
      openDraft,
      openFileByPath,
      /**
       * 在内置 WebView 中打开 URL。
       * @param url - 目标 URL
       */
      openInWebview: (url: string): void => {
        options.openWebview(new URL(url));
      },
      /**
       * 在系统浏览器中打开 URL。
       * @param url - 目标 URL
       */
      openExternal: (url: string): void => {
        native.openExternal(url);
      },
      getPendingQuestion: (): PendingQuestionSnapshot | null => {
        const sessionId = getSessionId();
        return sessionId ? options.getPendingQuestion(sessionId) : null;
      },
      getSessionId
    });
  }

  /**
   * 动态获取当前可用的工具列表。
   * 每次调用时根据运行时状态（编辑器、MCP、Skill、Widget）过滤条件工具。
   * @returns 当前可用工具列表
   */
  function getActiveTools(binding?: RuntimeToolDiscoveryBinding): AIToolExecutor[] {
    const allBuiltinTools = createBoundTools(binding);
    const hasActiveEditor = binding
      ? Boolean(binding.documentId && editorToolContextRegistry.getContext(binding.documentId))
      : Boolean(editorToolContextRegistry.getCurrentContext());
    const hasActiveWebview = binding
      ? Boolean(binding.webviewId && webviewToolContextRegistry.getContext(binding.webviewId))
      : Boolean(webviewToolContextRegistry.getCurrentContext());
    const hasActiveWidget = binding
      ? Boolean(binding.widgetId && widgetToolContextRegistry.getContext(binding.widgetId))
      : Boolean(widgetToolContextRegistry.getCurrentContext());
    const hasWorkspace = Boolean(binding && binding.workspaceRoot !== undefined ? binding.workspaceRoot : options.workspaceRoot.value);
    const enabledWidgets = widgetStore.initialized ? widgetStore.getEnabledWidgets() : [];
    const hasActiveWidgets = widgetStore.initialized && enabledWidgets.length > 0;
    const baseBuiltinTools = hasActiveWidgets
      ? allBuiltinTools.filter((tool: AIToolExecutor): boolean => tool.definition.name !== OPEN_WIDGET_TOOL_NAME)
      : allBuiltinTools;

    // skillStore 在 onMounted 中异步初始化，allBuiltinTools 创建时 skillStore.initialized 为 false，
    // 因此需要在每次获取工具时动态判断是否需要追加 Skill 工具。
    const dynamicTools: AIToolExecutor[] = [];
    if (skillStore.initialized && skillStore.getEnabledSkills().length > 0) {
      const hasSkillTool = allBuiltinTools.some((tool) => tool.definition.name === SKILL_TOOL_NAME);
      if (!hasSkillTool) {
        dynamicTools.push(createSkillTool(skillStore));
      }
    }
    if (hasActiveWidgets) {
      const hasWidgetTool = baseBuiltinTools.some((tool) => tool.definition.name === WIDGET_TOOL_NAME);
      if (!hasWidgetTool) {
        dynamicTools.push(createWidgetTool(widgetStore));
      }
      dynamicTools.push(
        createOpenWidgetTool(widgetStore, {
          executeWidget: ({ state }) => executeWidgetRuntime(state, openWidgetRuntimeHost)
        })
      );
    }

    return [...baseBuiltinTools, ...dynamicTools].filter((tool: AIToolExecutor): boolean => {
      if (!isBuiltinToolName(tool.definition.name)) return false;
      if (tool.definition.name === 'read_current_document' && !hasActiveEditor) return false;
      if (tool.definition.name === READ_CURRENT_WEBPAGE_TOOL_NAME && !hasActiveWebview) return false;
      if (tool.definition.name === READ_CURRENT_WIDGET_TOOL_NAME && !hasActiveWidget) return false;
      if (tool.definition.name === OPERATE_WEBPAGE_TOOL_NAME && !hasActiveWebview) return false;
      if (tool.definition.name === OPEN_RESOURCE_TOOL_NAME && hasActiveWebview) return false;
      if (tool.definition.name === READ_DIRECTORY_TOOL_NAME && !hasWorkspace) return false;
      return true;
    });
  }

  /**
   * 发送请求前同步 Skill 与 Widget 磁盘定义。
   */
  async function syncAIResources(): Promise<void> {
    await Promise.allSettled([skillStore.waitForInit(), widgetStore.waitForInit()]);
    const results = await Promise.allSettled([skillStore.syncDirtyFromDisk(), widgetStore.syncDirtyFromDisk()]);

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('AI resource synchronization failed:', result.reason);
      }
    }
  }

  /**
   * 获取当前已启用 Skill 的内容版本。
   * @returns Skill 名称到内容 hash 的映射
   */
  function getSkillContentHashes(): Record<string, string> {
    return Object.fromEntries(
      skillStore
        .getEnabledSkills()
        .filter((skill): boolean => typeof skill.contentHash === 'string' && skill.contentHash.length > 0)
        .map((skill): [string, string] => [skill.name, skill.contentHash as string])
    );
  }

  /**
   * 按首次出现顺序解析本轮显式选择的 Skill 最新内容。
   * @param names - 结构化 SkillReference 中的名称
   * @returns 去重后的 Runtime Skill 快照
   */
  async function resolveSkillSnapshots(names: string[]): Promise<ChatRuntimeSkillSnapshot[]> {
    const uniqueNames = uniq(names);
    const skills = await Promise.all(uniqueNames.map((name: string) => skillStore.resolveLatestSkill(name)));

    return skills.map((skill: SkillDefinition | undefined, index: number): ChatRuntimeSkillSnapshot => {
      const name = uniqueNames[index];
      if (!skill || skill.parseError || !skill.contentHash) {
        throw createRuntimeError({
          code: 'SKILL_UNAVAILABLE',
          message: `技能“${name}”已删除或解析失败，无法发送本轮消息`
        });
      }

      return {
        name: skill.name,
        content: skill.content,
        contentHash: skill.contentHash,
        filePath: skill.filePath
      };
    });
  }

  return {
    getActiveTools,
    syncAIResources,
    getSkillContentHashes,
    resolveSkillSnapshots,
    openDraft,
    openFileByPath
  };
}
