/**
 * @file index.ts
 * @description 通用资源监听 hook，负责扫描用户目录、监听变更及增量更新到 Store。
 *              适用于按根目录（如 `.agents`、`.tibis`）+ 子目录（如 `skills`、`widgets`）
 *              管理资源文件并由渲染进程按业务谓词过滤目标文件的 Store 同步场景。
 */

import { onMounted, onUnmounted } from 'vue';
import { native } from '@/shared/platform';
import type { Native } from '@/shared/platform/native/types';
import { asyncTo } from '@/utils/asyncTo';
import { posix } from '@/utils/file/posix';

/** 通用资源监听配置。 */
export interface WatchResourceConfig<TDefinition> {
  /**
   * 根目录名（带 `.`），紧邻用户主目录的固定目录，例如 `.agents`、`.tibis`。
   * 监听目录 = `~/${rootDir}/${subDir}`。
   */
  rootDir: string;
  /** 根目录下的子目录名，例如 `skills`、`widgets`。 */
  subDir: string;
  /** 初始化之前触发（建立屏障），由 hook 在 setup 阶段同步调用。 */
  onBeforeInitialize: () => void;
  /** 执行初始化（扫描 Store），由 hook 在 onMounted 异步调用。 */
  onInitialize: (homeDir: string, api: Native) => Promise<void>;
  /** 资源一级目录新增或删除后触发，用于重新同步磁盘状态。 */
  onDirectoryChange: () => Promise<void>;
  /** 初始化完成之后触发（释放屏障），初始化成功或失败时各调用一次。 */
  onAfterInitialize: () => void;
  /** 处理变化事件（add / change / unlink），由 hook 在收到变更通知时调用。 */
  onChange: (type: 'change' | 'add' | 'unlink', definition: TDefinition) => void;

  /**
   * 文件解析回调，将磁盘内容解析为 Store 定义。
   * @param content - 文件内容
   * @param filePath - 文件绝对路径
   * @returns 解析后的定义
   */
  onParseFile: (content: string, filePath: string) => TDefinition;
  /**
   * 为 unlink 事件创建占位定义（仅含路径信息），便于 Store 在 unlink 路径命中失败时仍可按 id 兜底。
   * @param filePath - 规范化后的文件绝对路径
   * @returns 用于通知 Store 删除的占位定义
   */
  onCreateUnlinkPayload: (filePath: string) => TDefinition;
  /**
   * 判断是否目标文件：业务谓词，匹配当前资源关心的文件。
   * 隐藏目录过滤已由 useWatchResource 内部基于 rootDir / subDir 统一处理，调用方无需关心。
   * @param normalizedPath - 已使用 / 统一分隔符的文件路径
   * @returns 是否需要处理
   */
  onIsTargetFile: (normalizedPath: string) => boolean;
  /** 初始化失败时的日志标签，例如 'Skill' / 'Widget'。 */
  logLabel: string;
}

/** 单个资源监听清理回调。 */
type CleanupCallback = () => void | Promise<void>;

/** 异步监听初始化使用的生命周期边界。 */
interface WatchLifecycle {
  /** @returns 所属组件是否已卸载。 */
  isDisposed: () => boolean;
  /**
   * 注册清理回调；组件已卸载时立即执行。
   * @param cleanup - 清理回调
   */
  registerCleanup: (cleanup: CleanupCallback) => void;
}

/**
 * 判断路径是否位于被监听根目录/子目录下的隐藏目录（用于过滤安装器临时目录等）。
 * @param normalizedPath - 已使用 / 统一分隔符的文件路径
 * @param rootDir - 根目录名（带 `.`）
 * @param subDir - 子目录名
 * @returns 隐藏目录下的文件返回 true
 */
function isHiddenPath(normalizedPath: string, rootDir: string, subDir: string): boolean {
  const segments = normalizedPath.split('/');
  const rootIndex = segments.lastIndexOf(rootDir);
  if (rootIndex === -1 || segments[rootIndex + 1] !== subDir) {
    return false;
  }
  return segments.slice(rootIndex + 2, -1).some((segment: string): boolean => segment.startsWith('.'));
}

/**
 * 判断事件类型是否为资源一级目录变化。
 * @param type - 文件监听事件类型
 * @returns 是否为目录增删事件
 */
function isDirectoryChangeEvent(type: string): type is 'addDir' | 'unlinkDir' {
  return type === 'addDir' || type === 'unlinkDir';
}

/**
 * 判断路径是否为资源根目录下的直接子目录。
 * @param normalizedPath - 已使用 / 统一分隔符的文件路径
 * @param rootDir - 根目录名（带 `.`）
 * @param subDir - 子目录名
 * @returns 直接子目录返回 true
 */
function isDirectResourceDir(normalizedPath: string, rootDir: string, subDir: string): boolean {
  const segments = normalizedPath.split('/').filter(Boolean);
  const rootIndex = segments.lastIndexOf(rootDir);
  if (rootIndex === -1 || segments[rootIndex + 1] !== subDir) {
    return false;
  }

  const resourceDirName = segments[rootIndex + 2];
  return segments.length === rootIndex + 3 && !!resourceDirName && !resourceDirName.startsWith('.');
}

/**
 * 启动资源监听：订阅变更事件、注册目录观察、调用 Store 初始化。
 * 任一步骤失败直接抛错，由调用方统一处理屏障释放。
 * @param config - 通用配置
 * @param lifecycle - 组件释放状态与清理注册器
 * @returns 初始化是否在组件存活期间完成
 */
async function startWatching<TDefinition>(config: WatchResourceConfig<TDefinition>, lifecycle: WatchLifecycle): Promise<boolean> {
  // 先订阅事件，避免异步扫描与 watcher 注册期间丢失磁盘变化。
  const removeChangeListener = native.onSkillChanged((data: { type: string; filePath: string; content?: string }): void => {
    // 统一规范化路径分隔符，Windows 下 Chokidar 报告 \ 而 scanner 使用 /
    const normalizedPath = data.filePath.replace(/\\/g, '/');
    // 过滤掉安装器等写入的隐藏临时目录，避免在 unlink 时找不到 Store 中已删除的条目
    if (isHiddenPath(normalizedPath, config.rootDir, config.subDir)) {
      return;
    }
    if (isDirectoryChangeEvent(data.type)) {
      if (!isDirectResourceDir(normalizedPath, config.rootDir, config.subDir)) {
        return;
      }
      asyncTo(config.onDirectoryChange()).catch(() => undefined);
      return;
    }
    if (!config.onIsTargetFile(normalizedPath)) {
      return;
    }

    if (data.type === 'unlink') {
      config.onChange('unlink', config.onCreateUnlinkPayload(normalizedPath));
      return;
    }

    if (!data.content) {
      return;
    }

    config.onChange(data.type as 'change' | 'add', config.onParseFile(data.content, normalizedPath));
  });
  lifecycle.registerCleanup(removeChangeListener);

  const homeDir = await native.getHomeDir();
  if (lifecycle.isDisposed()) return false;
  // 只监听用户级全局资源目录，目标文件筛选统一交给渲染进程业务谓词。
  const targetDir = posix.join(homeDir, config.rootDir, config.subDir);
  await native.watchDirectory(targetDir);
  lifecycle.registerCleanup((): Promise<void> => native.unwatchDirectory(targetDir));
  if (lifecycle.isDisposed()) return false;

  await config.onInitialize(homeDir, native);
  return !lifecycle.isDisposed();
}

/**
 * 执行所有清理函数；每个清理都通过 `asyncTo` 隔离异常，避免单个失败阻塞其他清理。
 * 按注册顺序串行等待每个清理完成（监听器需先解绑再删文件等）。
 * @param cleanupCallbacks - 待执行的清理函数集合
 */
async function runCleanup(cleanupCallbacks: CleanupCallback[]): Promise<void> {
  for (const cleanup of cleanupCallbacks.splice(0)) {
    // eslint-disable-next-line no-await-in-loop -- 清理顺序敏感，需串行等待
    await asyncTo(Promise.resolve().then(cleanup));
  }
}

/**
 * 监听用户目录下的资源并同步到 Store：扫描文件、订阅变更、增量更新。
 * 在组件 onMounted 时自动执行初始化，onUnmounted 时自动清理监听。
 * @param config - 通用配置
 */
export function useWatchResource<TDefinition>(config: WatchResourceConfig<TDefinition>): void {
  // setup 阶段先建立屏障，避免布局 onMounted 前聊天绕过资源初始化。
  config.onBeforeInitialize();

  /** 组件卸载时需要执行的清理函数。 */
  const cleanupCallbacks: CleanupCallback[] = [];
  /** 组件卸载标记，阻止异步步骤注册孤儿资源。 */
  let disposed = false;
  /** 初始化屏障是否已由成功初始化或降级路径释放。 */
  let initializationSettled = false;

  /** 失败或提前卸载时幂等释放初始化屏障。 */
  function releaseInitialization(): void {
    if (initializationSettled) return;
    initializationSettled = true;
    config.onAfterInitialize();
  }

  /**
   * 注册清理回调，已卸载时立即执行迟到的 disposer。
   * @param cleanup - 清理回调
   */
  function registerCleanup(cleanup: CleanupCallback): void {
    if (!disposed) {
      cleanupCallbacks.push(cleanup);
      return;
    }
    runCleanup([cleanup]);
  }

  onMounted(async (): Promise<void> => {
    const [error, initialized] = await asyncTo(
      startWatching(config, {
        isDisposed: (): boolean => disposed,
        registerCleanup
      })
    );

    if (error || !initialized) releaseInitialization();
    else initializationSettled = true;
  });

  onUnmounted((): void => {
    disposed = true;
    releaseInitialization();
    runCleanup(cleanupCallbacks);
  });
}
