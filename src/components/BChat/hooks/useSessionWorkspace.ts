/**
 * @file useSessionWorkspace.ts
 * @description 管理聊天会话的工作区覆盖目录、草稿选择和运行前目录校验。
 */
import type { ComputedRef, Ref } from 'vue';
import { computed, ref, watch } from 'vue';
import { native } from '@/shared/platform';
import { useChatSessionStore } from '@/stores/chat/session';
import { asyncTo } from '@/utils/asyncTo';

/** 会话工作区 composable 的输入。 */
interface UseSessionWorkspaceOptions {
  /** 当前聊天会话 ID；空值表示尚未持久化的新会话草稿。 */
  activeSessionId: Readonly<Ref<string | null>>;
  /** 全局默认的 Tibis 工作区根目录。 */
  defaultWorkspaceRoot: Readonly<Ref<string | null>>;
}

/** 会话工作区 composable 的公开能力。 */
interface UseSessionWorkspaceReturn {
  /** 当前 Runtime 应使用的会话覆盖目录或默认工作区。 */
  workspaceRoot: ComputedRef<string | null>;
  /** 仅当前会话的覆盖目录；未设置时表示使用默认工作区。 */
  workspaceOverride: Readonly<Ref<string | undefined>>;
  /** 供输入工具栏显示的简短工作区名称。 */
  workspaceLabel: ComputedRef<string>;
  /** 打开目录选择框，并保存到草稿或当前会话。 */
  selectWorkspace: () => Promise<void>;
  /** 清除草稿或当前会话保存的工作区覆盖，恢复默认工作区。 */
  clearWorkspace: () => Promise<void>;
  /** 在 Runtime 请求前确认已保存的覆盖目录仍然可用。 */
  assertWorkspaceAvailable: () => Promise<void>;
}

/** 会话工作区异步读取状态。 */
type WorkspaceLoadState = 'ready' | 'loading' | 'failed';

/**
 * 获取用于界面展示的目录末级名称。
 * @param workspaceRoot - 工作区根目录
 * @returns 目录末级名称，路径为空时返回默认工作区标签
 */
function getWorkspaceLabel(workspaceRoot: string | undefined): string {
  if (!workspaceRoot) return '默认工作区';
  const segments = workspaceRoot.split(/[\\/]+/).filter((segment: string): boolean => segment.length > 0);
  return segments[segments.length - 1] ?? workspaceRoot;
}

/**
 * 管理当前 BChat 会话的工作区覆盖状态。
 * @param options - 会话 ID 与默认工作区依赖
 * @returns 有效工作区、选择操作和运行前校验能力
 */
export function useSessionWorkspace(options: UseSessionWorkspaceOptions): UseSessionWorkspaceReturn {
  const chatStore = useChatSessionStore();
  const workspaceOverride = ref<string>();
  const workspaceRoot = computed<string | null>((): string | null => workspaceOverride.value ?? options.defaultWorkspaceRoot.value);
  const workspaceLabel = computed<string>((): string => getWorkspaceLabel(workspaceOverride.value));
  const workspaceLoadState = ref<WorkspaceLoadState>('ready');
  let loadSequence = 0;
  let workspaceLoadPromise: Promise<void> = Promise.resolve();

  /**
   * 读取指定会话的工作区覆盖，并只提交当前读取结果。
   * @param sessionId - 正在读取的会话 ID
   * @param currentSequence - 本次读取序号
   */
  async function loadWorkspace(sessionId: string, currentSequence: number): Promise<void> {
    const [loadError, session] = await asyncTo(chatStore.loadSessionById(sessionId));
    // 会话已经切换或有更新的读取请求时，不允许旧请求覆盖当前状态。
    if (currentSequence !== loadSequence || options.activeSessionId.value !== sessionId) return;
    if (loadError || !session) {
      workspaceLoadState.value = 'failed';
      return;
    }

    workspaceOverride.value = session.metadata?.workspaceRoot;
    workspaceLoadState.value = 'ready';
  }

  /**
   * 等待当前会话工作区读取完成；会话切换时继续等待最新读取。
   */
  function waitWorkspaceLoad(): Promise<void> {
    const pendingLoad = workspaceLoadPromise;
    return pendingLoad.then((): Promise<void> | void => {
      if (pendingLoad === workspaceLoadPromise) return;
      return waitWorkspaceLoad();
    });
  }

  watch(
    options.activeSessionId,
    async (sessionId: string | null): Promise<void> => {
      const currentSequence = ++loadSequence;
      workspaceOverride.value = undefined;
      workspaceLoadState.value = 'loading';
      if (!sessionId) {
        workspaceLoadState.value = 'ready';
        workspaceLoadPromise = Promise.resolve();
        return;
      }

      workspaceLoadPromise = loadWorkspace(sessionId, currentSequence);
    },
    { immediate: true }
  );

  /**
   * 打开原生目录选择框并保存对应会话的覆盖目录。
   */
  async function selectWorkspace(): Promise<void> {
    const [directoryError, workspacePath] = await asyncTo(native.selectDirectory());
    if (directoryError) throw directoryError;
    if (!workspacePath) return;

    const sessionId = options.activeSessionId.value;
    if (!sessionId) {
      workspaceOverride.value = workspacePath;
      return;
    }

    // 使会话加载中的旧结果失效，防止其在保存成功后覆盖新目录。
    loadSequence += 1;
    const [updateError, session] = await asyncTo(chatStore.updateSessionWorkspace(sessionId, workspacePath));
    if (updateError) throw updateError;
    // 目录选择期间可切换会话；只更新仍处于原会话的界面投影。
    if (options.activeSessionId.value === sessionId) {
      workspaceOverride.value = session.metadata?.workspaceRoot ?? workspacePath;
      workspaceLoadState.value = 'ready';
    }
  }

  /**
   * 清除草稿或当前会话的工作区覆盖，恢复默认工作区。
   */
  async function clearWorkspace(): Promise<void> {
    const sessionId = options.activeSessionId.value;
    if (!sessionId) {
      workspaceOverride.value = undefined;
      return;
    }

    // 使会话加载中的旧结果失效，防止清除成功后重新写回旧目录。
    loadSequence += 1;
    const [clearError, session] = await asyncTo(chatStore.clearSessionWorkspace(sessionId));
    if (clearError) throw clearError;
    // 清除期间可切换会话；只更新仍处于原会话的界面投影。
    if (options.activeSessionId.value === sessionId) {
      workspaceOverride.value = session.metadata?.workspaceRoot;
      workspaceLoadState.value = 'ready';
    }
  }

  /**
   * 验证当前会话保存的覆盖目录仍是可访问目录。
   */
  async function assertWorkspaceAvailable(): Promise<void> {
    await waitWorkspaceLoad();
    if (workspaceLoadState.value === 'failed') {
      throw new Error('无法加载当前会话工作区，请稍后重试');
    }
    if (workspaceLoadState.value !== 'ready') {
      throw new Error('当前会话工作区仍在加载，请稍后重试');
    }

    const selectedWorkspace = workspaceOverride.value;
    if (!selectedWorkspace) return;

    const [statusError, status] = await asyncTo(native.getPathStatus(selectedWorkspace));
    if (statusError || !status?.exists || !status.isDirectory) {
      throw new Error('当前会话工作区不可用，请重新选择目录');
    }
  }

  return {
    workspaceRoot,
    workspaceOverride,
    workspaceLabel,
    selectWorkspace,
    clearWorkspace,
    assertWorkspaceAvailable
  };
}
