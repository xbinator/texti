/**
 * @file skill.ts
 * @description Skill Pinia Store，管理 skill 列表、启用状态和扫描配置。
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { parseSkillMarkdown } from '@/ai/skill/parser';
import { scanSkills, type SkillScannerAPI } from '@/ai/skill/scanner';
import { DEFAULT_SKILL_MAX_CONTENT_LENGTH, type SkillDefinition, type SkillScanConfig } from '@/ai/skill/types';
import { local } from '@/shared/storage/base';
import { asyncTo } from '@/utils/asyncTo';

/** localStorage 持久化键名。 */
const STORAGE_KEY_DISABLED_NAMES = 'skill.disabledNames';
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
 * Skill Pinia Store。
 */
export const useSkillStore = defineStore('skill', () => {
  /** 已发现的所有 skill。 */
  const skills = ref<SkillDefinition[]>([]);

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
  let cachedApi: SkillScannerAPI | null = null;
  /** 按 Skill 名称合并执行时的并发读取。 */
  const latestSkillPromises = new Map<string, Promise<SkillDefinition | undefined>>();
  /** 全局单调资源操作序号。 */
  let resourceOperationSequence = 0;
  /** 每个文件路径最后一次成功写回的操作序号。 */
  const appliedOperationByPath = new Map<string, number>();

  /** 扫描配置。 */
  const scanConfig = ref<SkillScanConfig>({
    homeDir: ''
  });

  /** 解析失败的 skill 及错误信息。 */
  const parseErrors = computed(() => {
    const errors = new Map<string, string>();
    for (const skill of skills.value) {
      if (skill.parseError) {
        errors.set(skill.filePath, skill.parseError);
      }
    }
    return errors;
  });

  /**
   * 按名称查找 skill。
   * @param name - skill 名称
   * @returns 匹配的 skill 或 undefined
   */
  function getSkillByName(name: string): SkillDefinition | undefined {
    return skills.value.find((s) => s.name === name);
  }

  /**
   * 获取已启用且无解析错误的 skill 列表。
   * @returns 可用 skill 列表
   */
  function getEnabledSkills(): SkillDefinition[] {
    return skills.value.filter((s) => s.enabled && !s.parseError);
  }

  /** 持久化禁用名称列表。 */
  function persistDisabledNames(): void {
    const disabledNames = skills.value.filter((s) => !s.enabled).map((s) => s.name);
    local.setItem(STORAGE_KEY_DISABLED_NAMES, disabledNames);
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
   * @param filePath - Skill 文件路径
   * @param operation - 待写回操作序号
   * @returns 未被更新操作抢先写回时返回 true
   */
  function canApplyResourceOperation(filePath: string, operation: number): boolean {
    return operation >= (appliedOperationByPath.get(filePath) ?? 0);
  }

  /**
   * 记录路径最新操作水位，并按最近写入顺序淘汰旧记录。
   * @param filePath - Skill 文件路径
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
   * 合并磁盘定义与当前启用状态。
   * @param updatedSkill - 磁盘最新解析定义
   * @param existingSkill - Store 当前定义
   * @returns 合并后的 Skill 定义
   */
  function resolveDiskSkill(updatedSkill: SkillDefinition, existingSkill?: SkillDefinition): SkillDefinition {
    const name = updatedSkill.name || existingSkill?.name || '';
    const description = updatedSkill.description || existingSkill?.description || '';
    const disabledNames = loadFromStorage<string[]>(STORAGE_KEY_DISABLED_NAMES, []);

    return {
      ...updatedSkill,
      name,
      description,
      enabled: existingSkill?.enabled ?? !disabledNames.includes(name)
    };
  }

  /**
   * 按文件路径操作序号应用 Skill 变更。
   * @param type - 事件类型
   * @param updatedSkill - 最新解析定义
   * @param operation - 操作序号
   * @returns 本次结果是否成功写回
   */
  function updateSkillChange(type: 'change' | 'add' | 'unlink', updatedSkill: SkillDefinition, operation: number): boolean {
    const { filePath } = updatedSkill;
    if (filePath && !canApplyResourceOperation(filePath, operation)) {
      return false;
    }

    if (filePath) {
      recordResourceOperation(filePath, operation);
    }

    // unlink 事件只按文件路径匹配；其它事件允许按 filePath 或 name 兜底
    const index = skills.value.findIndex((skill: SkillDefinition): boolean => {
      if (skill.filePath === filePath) {
        return true;
      }
      if (type === 'unlink') {
        return false;
      }
      return !!updatedSkill.name && skill.name === updatedSkill.name;
    });
    const existingSkill = index !== -1 ? skills.value[index] : undefined;

    if (type === 'unlink') {
      if (index !== -1) {
        skills.value.splice(index, 1);
      }
      return true;
    }

    const nextSkill = resolveDiskSkill(updatedSkill, existingSkill);
    if (index !== -1) {
      skills.value[index] = nextSkill;
    } else {
      skills.value.push(nextSkill);
    }

    return true;
  }

  /**
   * 使用缓存扫描依赖读取并应用最新 Skill 目录。
   */
  async function scanAndApplySkills(): Promise<void> {
    if (!cachedApi || !scanConfig.value.homeDir) {
      return;
    }

    const operation = nextResourceOperation();
    const existingSkills = [...skills.value];
    const discovered = await scanSkills(
      {
        homeDir: scanConfig.value.homeDir,
        maxContentLength: DEFAULT_SKILL_MAX_CONTENT_LENGTH
      },
      cachedApi
    );

    const discoveredPaths = new Set(discovered.map((skill: SkillDefinition): string => skill.filePath));
    for (const skill of discovered) {
      updateSkillChange('change', skill, operation);
    }

    // 扫描开始后没有被更晚操作触及的缺失路径，才按磁盘删除处理。
    for (const existingSkill of existingSkills) {
      if (!discoveredPaths.has(existingSkill.filePath)) {
        updateSkillChange('unlink', existingSkill, operation);
      }
    }

    initialized.value = true;
    dirty.value = false;
  }

  /**
   * 切换 skill 启用/禁用状态。
   * @param name - skill 名称
   */
  function toggleSkill(name: string): void {
    const skill = skills.value.find((s) => s.name === name);
    if (skill) {
      const operation = nextResourceOperation();
      recordResourceOperation(skill.filePath, operation);
      skill.enabled = !skill.enabled;
      persistDisabledNames();
    }
  }

  /**
   * 处理 skill 目录变更事件（增量更新）。
   * @param type - 事件类型
   * @param updatedSkill - 解析后的 skill（add/change 时提供）
   */
  function handleSkillChange(type: 'change' | 'add' | 'unlink', updatedSkill: SkillDefinition): void {
    updateSkillChange(type, updatedSkill, nextResourceOperation());
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
   * 初始化：扫描 skill 目录。
   * @param homeDir - 用户主目录路径
   * @param api - electronAPI 实例
   */
  async function initialize(homeDir: string, api: SkillScannerAPI): Promise<void> {
    if (initTaskPromise) {
      return initTaskPromise;
    }

    beforeInitialize();
    scanConfig.value.homeDir = homeDir;
    cachedApi = api;

    initTaskPromise = (async (): Promise<void> => {
      // 错误日志由 asyncTo 内部统一处理，无论成败都释放初始化屏障
      await asyncTo(scanAndApplySkills());
      afterInitialize();
    })();

    return initTaskPromise;
  }

  /**
   * 从磁盘重新同步完整 Skill 目录。
   */
  async function syncFromDisk(): Promise<void> {
    if (!cachedApi || !scanConfig.value.homeDir) {
      return;
    }

    if (!syncPromise) {
      syncPromise = scanAndApplySkills().finally((): void => {
        syncPromise = null;
      });
    }

    await syncPromise;
  }

  /**
   * 标记 Skill 磁盘资源需要重新同步。
   */
  function markDirty(): void {
    dirty.value = true;
  }

  /**
   * 仅在资源被标脏时重新同步 Skill 目录，供聊天发送前轻量检查使用。
   */
  async function syncDirtyFromDisk(): Promise<void> {
    if (!dirty.value) return;

    await syncFromDisk();
  }

  /**
   * 从磁盘读取最新 Skill，不限制启用状态。
   * @param name - Skill 名称
   * @returns 无解析错误的最新 Skill，不存在时返回 undefined
   */
  async function resolveLatestSkill(name: string): Promise<SkillDefinition | undefined> {
    const existingSkill = getSkillByName(name);
    if (!existingSkill || !cachedApi) {
      return undefined;
    }

    const pending = latestSkillPromises.get(name);
    if (pending) {
      return pending;
    }

    const operation = nextResourceOperation();
    const nextPromise = (async (): Promise<SkillDefinition | undefined> => {
      // 错误日志由 asyncTo 内部统一处理；读取失败视为文件已被删除，回退为 unlink
      const [error, result] = await asyncTo(cachedApi.readFile(existingSkill.filePath));
      if (error || !result) {
        updateSkillChange('unlink', existingSkill, operation);
      } else {
        const parsed = parseSkillMarkdown(result.content, existingSkill.filePath, {
          source: existingSkill.source,
          maxContentLength: scanConfig.value.maxContentLength ?? DEFAULT_SKILL_MAX_CONTENT_LENGTH
        });

        if (parsed.name && parsed.name !== name) {
          updateSkillChange('unlink', existingSkill, operation);
          updateSkillChange('add', parsed, operation);
        } else {
          updateSkillChange('change', parsed, operation);
        }
      }

      const latestSkill = getSkillByName(name);
      return latestSkill && !latestSkill.parseError ? latestSkill : undefined;
    })().finally((): void => {
      latestSkillPromises.delete(name);
    });

    latestSkillPromises.set(name, nextPromise);
    return nextPromise;
  }

  /**
   * 执行自动 Skill 工具前从磁盘读取最新启用 Skill。
   * @param name - Skill 名称
   * @returns 最新启用 Skill，不存在、已禁用或解析失败时返回 undefined
   */
  async function resolveLatestEnabledSkill(name: string): Promise<SkillDefinition | undefined> {
    const existingSkill = getSkillByName(name);
    if (!existingSkill?.enabled) {
      return undefined;
    }

    const latestSkill = await resolveLatestSkill(name);
    return latestSkill?.enabled ? latestSkill : undefined;
  }

  /**
   * 重新扫描 skill 目录（使用缓存的 api 和 homeDir）。
   */
  async function rescan(): Promise<void> {
    if (!cachedApi || !scanConfig.value.homeDir) {
      console.warn('Skill rescan called before init');
      return;
    }
    await syncFromDisk();
  }

  /**
   * 等待初始化完成。
   */
  async function waitForInit(): Promise<void> {
    if (initialized.value) return;
    if (initPromise) await initPromise;
  }

  return {
    skills,
    initialized,
    dirty,
    scanConfig,
    parseErrors,
    getSkillByName,
    getEnabledSkills,
    toggleSkill,
    handleSkillChange,
    beforeInitialize,
    afterInitialize,
    initialize,
    markDirty,
    syncFromDisk,
    syncDirtyFromDisk,
    resolveLatestSkill,
    resolveLatestEnabledSkill,
    rescan,
    waitForInit,
    getResourceOperationCount
  };
});
