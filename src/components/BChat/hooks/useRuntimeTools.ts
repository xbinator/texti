/**
 * @file useRuntimeTools.ts
 * @description ChatRuntime 内置工具创建和动态过滤 hook。
 */
import type { Message } from '../utils/types';
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
  READ_DIRECTORY_TOOL_NAME,
  SKILL_TOOL_NAME,
  WIDGET_TOOL_NAME
} from '@/ai/tools/builtin';
import { createSkillTool } from '@/ai/tools/builtin/SkillTool';
import { createOpenWidgetTool, createWidgetTool } from '@/ai/tools/builtin/WidgetTool';
import type { AIToolConfirmationAdapter } from '@/ai/tools/confirmation';
import { editorToolContextRegistry } from '@/ai/tools/context/editor';
import { webviewToolContextRegistry } from '@/ai/tools/context/webview';
import { createWidgetHttpClient, executeWidgetRuntime, type WidgetConsoleLevel, type WidgetLogLevel } from '@/components/BWidget/utils/widgetRuntime';
import { formatWidgetLogArgs } from '@/components/BWidget/utils/widgetRuntime/logger';
import { useNavigate } from '@/hooks/useNavigate';
import { logger } from '@/shared/logger';
import { native } from '@/shared/platform';
import { useSkillStore } from '@/stores/ai/skill';
import { useToolSettingsStore } from '@/stores/ai/toolSettings';
import { useWidgetStore } from '@/stores/ai/widget';
import { useRecentStore } from '@/stores/workspace/recent';
import { userChoice } from '../utils/messageHelper';
import { createRuntimeError } from '../utils/runtimeError';

/**
 * Runtime 工具 hook 配置。
 */
interface UseRuntimeToolsOptions {
  /** 当前消息列表。 */
  messages: Ref<Message[]>;
  /** 工具确认适配器。 */
  confirm: AIToolConfirmationAdapter;
  /** 获取当前活跃会话 ID。 */
  getSessionId: () => string | undefined;
  /** 当前会话最终生效的工作区根目录。 */
  workspaceRoot: Readonly<Ref<string | null>>;
  /** 同步读取当前会话最终生效的工作区根目录。 */
  getWorkspaceRoot: () => string | null;
  /** 在内置 WebView 中打开 URL。 */
  openWebview: (url: URL) => void;
}

/**
 * Runtime 工具 hook 返回值。
 */
interface UseRuntimeToolsReturn {
  /** 动态获取当前可用工具列表。 */
  getActiveTools: () => AIToolExecutor[];
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

  const allBuiltinTools = createBuiltinTools({
    confirm: options.confirm,
    skillStore,
    widgetStore,
    mcpStore: toolSettingsStore,
    getWorkspaceRoot: options.getWorkspaceRoot,
    isFileInRecent: (filePath: string) => {
      return Boolean(recentStore.recentFiles?.some((file) => file.path === filePath));
    },
    /**
     * 通过文件绝对路径查找文件 ID。
     * 封装 recentStore.getFileByPath。
     */
    findFileByPath: async (filePath: string) => {
      const file = await recentStore.getFileByPath(filePath);
      return file ? { id: file.id } : null;
    },
    /**
     * 通过文件 ID 获取编辑器上下文。
     * 封装 editorToolContextRegistry.getContext。
     */
    getEditorContext: (documentId: string) => {
      return editorToolContextRegistry.getContext(documentId);
    },
    getWebviewContext: () => webviewToolContextRegistry.getCurrentContext(),
    openDraft,
    /**
     * 通过文件路径打开文件标签页。
     * 封装 useNavigate().openFileByPath，返回 { id } 或 null。
     */
    openFileByPath,
    /**
     * 在内置 webview 中打开 URL。
     * 通过 Vue Router 导航到 webview-web 页面。
     */
    openInWebview: (url: string) => {
      options.openWebview(new URL(url));
    },
    /**
     * 在系统浏览器中打开 URL。
     * 通过 Electron shell.openExternal 实现。
     */
    openExternal: (url: string) => {
      native.openExternal(url);
    },
    getPendingQuestion: () => {
      const pendingQuestion = userChoice.findPending(options.messages.value);
      if (!pendingQuestion) return null;

      return {
        questionId: pendingQuestion.questionId,
        toolCallId: pendingQuestion.toolCallId
      };
    },
    getSessionId: options.getSessionId
  });

  /**
   * 动态获取当前可用的工具列表。
   * 每次调用时根据运行时状态（编辑器、MCP、Skill、Widget）过滤条件工具。
   * @returns 当前可用工具列表
   */
  function getActiveTools(): AIToolExecutor[] {
    const hasActiveEditor = Boolean(editorToolContextRegistry.getCurrentContext());
    const hasActiveWebview = Boolean(webviewToolContextRegistry.getCurrentContext());
    const hasWorkspace = Boolean(options.workspaceRoot.value);
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

    return [...baseBuiltinTools, ...dynamicTools].filter((tool) => {
      if (!isBuiltinToolName(tool.definition.name)) return false;
      if (tool.definition.name === 'read_current_document' && !hasActiveEditor) return false;
      if (tool.definition.name === READ_CURRENT_WEBPAGE_TOOL_NAME && !hasActiveWebview) return false;
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
