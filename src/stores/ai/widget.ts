/**
 * @file widget.ts
 * @description 小组件 Pinia Store，管理 .tibis/widgets/<name>/widget.json 发现结果和启用状态。
 */
import { ref } from 'vue';
import { defineStore } from 'pinia';
import { parseWidgetJson } from '@/ai/widget/parser';
import { scanWidgets, type WidgetScannerAPI } from '@/ai/widget/scanner';
import type { WidgetDefinition, WidgetScanConfig } from '@/ai/widget/types';
import { local } from '@/shared/storage/base';
import { asyncTo } from '@/utils/asyncTo';

/** localStorage 持久化键名。 */
const STORAGE_KEY_DISABLED_IDS = 'widget.disabledIds';
/** 每个 Store 实例最多保留的文件操作水位数量。 */
export const RESOURCE_OPERATION_CACHE_LIMIT = 512;

/**
 * 从 localStorage 加载数据。
 * @param key - 存储键名
 * @param defaults - 默认值
 * @returns 加载的数据或默认值
 */
function loadFromStorage<T>(key: string, defaults: T): T {
  const saved = local.getItem<unknown>(key);

  return saved !== null && saved !== undefined ? (saved as T) : defaults;
}

/**
 * 小组件 Pinia Store。
 */
export const useWidgetStore = defineStore('widget', () => {
  /** 已发现的所有小组件。 */
  const widgets = ref<WidgetDefinition[]>([]);
  /** 是否已完成初始化扫描。 */
  const initialized = ref(false);
  /** 是否需要在聊天发送前重新扫描磁盘。 */
  const dirty = ref(false);
  /** 初始化等待屏障，用于覆盖布局挂载到真正开始扫描之间的窗口。 */
  let initPromise: Promise<void> | null = null;
  /** 完成初始化等待屏障的回调。 */
  let resolveInitPromise: (() => void) | null = null;
  /** 实际初始化任务，用于合并重复调用。 */
  let initTaskPromise: Promise<void> | null = null;
  /** 主动磁盘同步 Promise，用于合并并发扫描。 */
  let syncPromise: Promise<void> | null = null;
  /** 缓存的扫描 API，用于 rescan。 */
  let cachedApi: WidgetScannerAPI | null = null;
  /** 按 Widget ID 合并执行时的并发读取。 */
  const latestWidgetPromises = new Map<string, Promise<WidgetDefinition | undefined>>();
  /** 全局单调资源操作序号。 */
  let resourceOperationSequence = 0;
  /** 每个文件路径最后一次成功写回的操作序号。 */
  const appliedOperationByPath = new Map<string, number>();
  /** 扫描配置。 */
  const scanConfig = ref<WidgetScanConfig>({
    homeDir: ''
  });

  /**
   * 按 ID 查找小组件。
   * @param id - 小组件 ID
   * @returns 匹配的小组件或 undefined
   */
  function getWidgetById(id: string): WidgetDefinition | undefined {
    return widgets.value.find((widget: WidgetDefinition): boolean => widget.id === id);
  }

  /**
   * 获取已启用且无解析错误的小组件列表。
   * @returns 可用小组件列表
   */
  function getEnabledWidgets(): WidgetDefinition[] {
    return widgets.value.filter((widget: WidgetDefinition): boolean => widget.enabled && !widget.parseError);
  }

  /**
   * 持久化禁用小组件 ID 列表。
   */
  function persistDisabledIds(): void {
    const disabledIds = widgets.value.filter((widget: WidgetDefinition): boolean => !widget.enabled).map((widget: WidgetDefinition): string => widget.id);
    local.setItem(STORAGE_KEY_DISABLED_IDS, disabledIds);
  }

  /**
   * 领取下一次资源操作序号。
   * @returns 单调递增操作序号
   */
  function nextResourceOperation(): number {
    resourceOperationSequence += 1;
    return resourceOperationSequence;
  }

  /**
   * 判断指定路径的操作是否仍允许写回。
   * @param filePath - Widget 文件路径
   * @param operation - 待写回操作序号
   * @returns 未被更新操作抢先写回时返回 true
   */
  function canApplyResourceOperation(filePath: string, operation: number): boolean {
    return operation >= (appliedOperationByPath.get(filePath) ?? 0);
  }

  /**
   * 记录路径最新操作水位，并按最近写入顺序淘汰旧记录。
   * @param filePath - Widget 文件路径
   * @param operation - 已成功写回的操作序号
   */
  function recordResourceOperation(filePath: string, operation: number): void {
    appliedOperationByPath.delete(filePath);
    appliedOperationByPath.set(filePath, operation);
    while (appliedOperationByPath.size > RESOURCE_OPERATION_CACHE_LIMIT) {
      const oldestPath = appliedOperationByPath.keys().next().value;
      if (oldestPath === undefined) break;
      appliedOperationByPath.delete(oldestPath);
    }
  }

  /**
   * 获取当前保留的文件操作水位数量。
   * @returns 文件操作水位数量
   */
  function getResourceOperationCount(): number {
    return appliedOperationByPath.size;
  }

  /**
   * 判断小组件是否被用户持久化禁用。
   * @param id - 小组件 ID
   * @returns 是否禁用
   */
  function isPersistedDisabledWidget(id: string): boolean {
    return loadFromStorage<string[]>(STORAGE_KEY_DISABLED_IDS, []).includes(id);
  }

  /**
   * 切换小组件启用状态。
   * @param id - 小组件 ID
   */
  function toggleWidget(id: string): void {
    const widget = getWidgetById(id);

    if (!widget) {
      return;
    }

    const operation = nextResourceOperation();
    recordResourceOperation(widget.filePath, operation);
    widget.enabled = !widget.enabled;
    persistDisabledIds();
  }

  /**
   * 合并目录监听结果，并保留用户已设置的启用状态。
   * @param updatedWidget - 文件系统最新解析结果
   * @param existingWidget - 当前列表中的小组件
   * @returns 合并后的小组件定义
   */
  function resolveWatchedWidget(updatedWidget: WidgetDefinition, existingWidget?: WidgetDefinition): WidgetDefinition {
    return {
      ...updatedWidget,
      enabled: existingWidget?.enabled ?? !isPersistedDisabledWidget(updatedWidget.id)
    };
  }

  /**
   * 按文件路径操作序号应用 Widget 变更。
   * @param type - 事件类型
   * @param updatedWidget - 最新解析定义
   * @param operation - 操作序号
   * @returns 本次结果是否成功写回
   */
  function updateWidgetChange(type: 'change' | 'add' | 'unlink', updatedWidget: WidgetDefinition, operation: number): boolean {
    const { filePath } = updatedWidget;
    if (filePath && !canApplyResourceOperation(filePath, operation)) {
      return false;
    }

    if (filePath) {
      recordResourceOperation(filePath, operation);
    }

    // unlink 事件只按文件路径匹配；其它事件允许按 filePath 或 id 兜底
    const index = widgets.value.findIndex((widget: WidgetDefinition): boolean => {
      if (widget.filePath === filePath) {
        return true;
      }
      if (type === 'unlink') {
        return false;
      }
      return !!updatedWidget.id && widget.id === updatedWidget.id;
    });
    const existingWidget = index !== -1 ? widgets.value[index] : undefined;

    if (type === 'unlink') {
      if (index !== -1) {
        widgets.value.splice(index, 1);
      }
      return true;
    }

    const nextWidget = resolveWatchedWidget(updatedWidget, existingWidget);
    if (index !== -1) {
      widgets.value[index] = nextWidget;
    } else {
      widgets.value.push(nextWidget);
    }

    return true;
  }

  /**
   * 添加或更新小组件定义。
   * @param widget - 小组件定义
   */
  function upsertWidget(widget: WidgetDefinition): void {
    updateWidgetChange('change', widget, nextResourceOperation());
  }

  /**
   * 使用缓存扫描依赖读取并应用最新 Widget 目录。
   */
  async function scanAndApplyWidgets(): Promise<void> {
    if (!cachedApi || !scanConfig.value.homeDir) {
      return;
    }

    const operation = nextResourceOperation();
    const existingWidgets = [...widgets.value];
    const discovered = await scanWidgets({ homeDir: scanConfig.value.homeDir }, cachedApi);
    const discoveredPaths = new Set(discovered.map((widget: WidgetDefinition): string => widget.filePath));

    for (const widget of discovered) {
      updateWidgetChange('change', widget, operation);
    }

    // 扫描开始后没有被更晚操作触及的缺失路径，才按磁盘删除处理。
    for (const existingWidget of existingWidgets) {
      if (!discoveredPaths.has(existingWidget.filePath)) {
        updateWidgetChange('unlink', existingWidget, operation);
      }
    }

    initialized.value = true;
    dirty.value = false;
  }

  /**
   * 处理小组件目录变更事件。
   * @param type - 事件类型
   * @param updatedWidget - 解析后的小组件定义
   */
  function handleWidgetChange(type: 'change' | 'add' | 'unlink', updatedWidget: WidgetDefinition): void {
    updateWidgetChange(type, updatedWidget, nextResourceOperation());
  }

  /**
   * 在异步布局挂载前建立初始化等待屏障。
   */
  function beforeInitialize(): void {
    if (initialized.value || initPromise) {
      return;
    }

    initPromise = new Promise<void>((resolve: () => void): void => {
      resolveInitPromise = resolve;
    });
  }

  /**
   * 完成初始化等待屏障，初始化失败时也允许聊天继续降级运行。
   */
  function afterInitialize(): void {
    initialized.value = true;
    resolveInitPromise?.();
    resolveInitPromise = null;
    initPromise ??= Promise.resolve();
  }

  /**
   * 初始化小组件列表。
   * @param homeDir - 用户主目录路径
   * @param api - 扫描依赖 API
   * @returns 初始化完成信号
   */
  async function initialize(homeDir: string, api: WidgetScannerAPI): Promise<void> {
    if (initTaskPromise) {
      return initTaskPromise;
    }

    beforeInitialize();
    scanConfig.value.homeDir = homeDir;
    cachedApi = api;
    initTaskPromise = (async (): Promise<void> => {
      // 错误日志由 asyncTo 内部统一处理，无论成败都释放初始化屏障
      await asyncTo(scanAndApplyWidgets());
      afterInitialize();
    })();

    return initTaskPromise;
  }

  /**
   * 从磁盘重新同步完整 Widget 目录。
   */
  async function syncFromDisk(): Promise<void> {
    if (!cachedApi || !scanConfig.value.homeDir) {
      return;
    }

    if (!syncPromise) {
      syncPromise = scanAndApplyWidgets().finally((): void => {
        syncPromise = null;
      });
    }

    await syncPromise;
  }

  /**
   * 标记 Widget 磁盘资源需要重新同步。
   */
  function markDirty(): void {
    dirty.value = true;
  }

  /**
   * 仅在资源被标脏时重新同步 Widget 目录，供聊天发送前轻量检查使用。
   */
  async function syncDirtyFromDisk(): Promise<void> {
    if (!dirty.value) return;

    await syncFromDisk();
  }

  /**
   * 执行工具前从磁盘读取最新启用 Widget。
   * @param id - Widget ID
   * @returns 最新 Widget 定义，不存在或已禁用时返回 undefined
   */
  async function resolveLatestEnabledWidget(id: string): Promise<WidgetDefinition | undefined> {
    const existingWidget = getWidgetById(id);
    if (!existingWidget?.enabled || !cachedApi) {
      return undefined;
    }

    const pending = latestWidgetPromises.get(id);
    if (pending) {
      return pending;
    }

    const operation = nextResourceOperation();
    const nextPromise = (async (): Promise<WidgetDefinition | undefined> => {
      // 错误日志由 asyncTo 内部统一处理；读取失败视为文件已被删除，回退为 unlink
      const [error, result] = await asyncTo(cachedApi.readFile(existingWidget.filePath));
      if (error || !result) {
        updateWidgetChange('unlink', existingWidget, operation);
      } else {
        const parsed = parseWidgetJson(result.content, existingWidget.filePath);

        if (parsed.id !== id) {
          updateWidgetChange('unlink', existingWidget, operation);
          updateWidgetChange('add', parsed, operation);
        } else {
          updateWidgetChange('change', parsed, operation);
        }
      }

      const latestWidget = getWidgetById(id);
      return latestWidget?.enabled ? latestWidget : undefined;
    })().finally((): void => {
      latestWidgetPromises.delete(id);
    });

    latestWidgetPromises.set(id, nextPromise);
    return nextPromise;
  }

  /**
   * 重新扫描小组件目录。
   * @returns 重新扫描完成信号
   */
  async function rescan(): Promise<void> {
    if (!cachedApi || !scanConfig.value.homeDir) {
      console.warn('Widget rescan called before init');
      return;
    }

    await syncFromDisk();
  }

  /**
   * 等待初始化完成。
   * @returns 初始化完成信号
   */
  async function waitForInit(): Promise<void> {
    if (initialized.value) {
      return;
    }

    if (initPromise) {
      await initPromise;
    }
  }

  return {
    widgets,
    initialized,
    dirty,
    scanConfig,
    getWidgetById,
    getEnabledWidgets,
    toggleWidget,
    upsertWidget,
    handleWidgetChange,
    beforeInitialize,
    afterInitialize,
    initialize,
    markDirty,
    syncFromDisk,
    syncDirtyFromDisk,
    resolveLatestEnabledWidget,
    rescan,
    waitForInit,
    getResourceOperationCount
  };
});
