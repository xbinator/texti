/**
 * @file useWorkspaceMentions.ts
 * @description 扫描手动会话工作区，生成聊天输入框 @ 文件提及候选。
 */
import type { ComputedRef, Ref } from 'vue';
import { computed, readonly, ref, watch } from 'vue';
import picomatch from 'picomatch';
import type { FileMentionOption } from '@/components/BSmart/types';
import { native } from '@/shared/platform';
import type { ReadWorkspaceDirectoryEntry, ReadWorkspaceDirectoryResult } from '@/shared/platform/native/types';
import { asyncTo } from '@/utils/asyncTo';

/** 工作区文件提及默认结果上限。 */
export const DEFAULT_WORKSPACE_MENTION_LIMIT = 2000;

/** 工作区文件提及成功结果默认缓存时间。 */
export const DEFAULT_WORKSPACE_MENTION_CACHE_TTL_MS = 30_000;

/** 单个 .gitignore 文件最多读取的行数。 */
export const WORKSPACE_MENTION_GITIGNORE_READ_LIMIT = 1000;

/** 工作区文件提及默认跳过目录。 */
export const WORKSPACE_MENTION_EXCLUDED_DIRECTORIES = ['.git', 'node_modules', 'dist', 'build', '.next', '.nuxt', 'coverage'] as const;

/** 工作区文件提及默认跳过的二进制和媒体扩展名。 */
export const WORKSPACE_MENTION_EXCLUDED_EXTENSIONS = [
  '7z',
  'avi',
  'avif',
  'bin',
  'bmp',
  'bz2',
  'class',
  'dmg',
  'dll',
  'eot',
  'exe',
  'flac',
  'gif',
  'gz',
  'ico',
  'jpeg',
  'jpg',
  'm4a',
  'mkv',
  'mov',
  'mp3',
  'mp4',
  'ogg',
  'otf',
  'pdf',
  'png',
  'rar',
  'so',
  'svg',
  'tar',
  'ttf',
  'wasm',
  'wav',
  'webm',
  'webp',
  'woff',
  'woff2',
  'zip'
] as const;

/** gitignore 文件名。 */
const GITIGNORE_FILE_NAME = '.gitignore';

/** 工作区文件提及 Hook 入参。 */
export interface UseWorkspaceMentionsOptions {
  /** 当前会话运行时工作区根目录。 */
  workspaceRoot: Readonly<Ref<string | null>>;
  /** 是否启用手动工作区候选。 */
  enabled: Readonly<Ref<boolean>>;
  /** 文件候选数量上限，缺省使用 DEFAULT_WORKSPACE_MENTION_LIMIT。 */
  limit?: number;
  /** 自定义跳过目录，缺省使用 WORKSPACE_MENTION_EXCLUDED_DIRECTORIES。 */
  excludedDirectories?: readonly string[];
  /** 自定义跳过扩展名，缺省使用 WORKSPACE_MENTION_EXCLUDED_EXTENSIONS。 */
  excludedExtensions?: readonly string[];
  /** 成功扫描结果缓存时长，缺省使用 DEFAULT_WORKSPACE_MENTION_CACHE_TTL_MS。 */
  cacheTtlMs?: number;
}

/** 工作区文件提及 Hook 返回值。 */
export interface UseWorkspaceMentionsReturn {
  /** 当前可用于 @ 菜单的工作区文件候选。 */
  fileMentions: ComputedRef<FileMentionOption[]>;
  /** 是否正在扫描工作区。 */
  loading: Readonly<Ref<boolean>>;
  /** 最近一次根目录扫描错误；子目录错误会被跳过。 */
  error: Readonly<Ref<Error | null>>;
  /** 主动刷新当前工作区候选。 */
  refresh: () => Promise<void>;
}

/** 单条 gitignore 规则。 */
interface WorkspaceIgnoreRule {
  /** 规则所在目录的工作区相对路径。 */
  basePath: string;
  /** 规范化后的规则内容。 */
  pattern: string;
  /** 是否为反选规则。 */
  negated: boolean;
  /** 是否只匹配目录。 */
  directoryOnly: boolean;
  /** 是否相对规则所在目录根部匹配。 */
  rooted: boolean;
  /** 规则内容是否包含路径分隔符。 */
  hasSlash: boolean;
  /** 规则匹配器。 */
  matcher: (value: string) => boolean;
}

/** 参与 ignore 匹配的子项类型。 */
type WorkspaceMentionEntryType = 'file' | 'directory';

/** 单个待扫描目录。 */
interface WorkspaceMentionScanTask {
  /** 当前目录工作区相对路径。 */
  directoryPath: string;
  /** 当前目录继承到的 ignore 规则。 */
  ignoreRules: WorkspaceIgnoreRule[];
}

/** 单次工作区扫描请求。 */
interface WorkspaceMentionScanRequest {
  /** 工作区根目录。 */
  workspaceRoot: string;
  /** 结果上限。 */
  limit: number;
  /** 跳过目录集合。 */
  excludedDirectories: Set<string>;
  /** 跳过扩展名集合。 */
  excludedExtensions: Set<string>;
}

/** 单次工作区扫描结果。 */
interface WorkspaceMentionScanResult {
  /** 收集到的文件候选。 */
  files: FileMentionOption[];
  /** 根目录读取错误；子目录错误被跳过。 */
  error: Error | null;
}

/** 工作区文件提及缓存条目。 */
interface WorkspaceMentionCacheEntry {
  /** 缓存写入时间。 */
  createdAt: number;
  /** 成功扫描得到的文件候选。 */
  files: FileMentionOption[];
}

/** 已完成扫描结果缓存。 */
const workspaceMentionCache = new Map<string, WorkspaceMentionCacheEntry>();

/** 正在进行的扫描 Promise，用于复用并发请求。 */
const workspaceMentionInflightScans = new Map<string, Promise<WorkspaceMentionScanResult>>();

/**
 * 清空工作区文件提及缓存。
 */
export function clearWorkspaceMentionCache(): void {
  workspaceMentionCache.clear();
  workspaceMentionInflightScans.clear();
}

/**
 * 将未知错误归一为 Error。
 * @param error - 原始错误
 * @returns Error 实例
 */
function normalizeWorkspaceMentionError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error('读取工作区文件候选失败');
}

/**
 * 规范化候选相对路径。
 * @param filePath - 原始相对路径
 * @returns POSIX 风格相对路径
 */
function normalizeMentionPath(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/gu, '/').replace(/\/+/gu, '/').replace(/\/$/u, '');
  if (!normalizedPath || normalizedPath === '.') return '.';
  if (normalizedPath.startsWith('./')) return normalizedPath.slice(2);
  return normalizedPath;
}

/**
 * 拼接工作区相对路径。
 * @param directoryPath - 当前目录相对路径
 * @param name - 子项名称
 * @returns POSIX 风格相对路径
 */
function joinMentionPath(directoryPath: string, name: string): string {
  const normalizedDirectory = normalizeMentionPath(directoryPath);
  if (normalizedDirectory === '.') return normalizeMentionPath(name);
  return normalizeMentionPath(`${normalizedDirectory}/${name}`);
}

/**
 * 从文件名解析扩展名。
 * @param fileName - 文件名
 * @returns 不含点号的扩展名
 */
function resolveFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return '';
  return fileName.slice(dotIndex + 1).toLowerCase();
}

/**
 * 将目录子项转成文件候选。
 * @param directoryPath - 当前目录相对路径
 * @param entry - 文件子项
 * @returns 文件提及候选
 */
function createMentionOption(directoryPath: string, entry: ReadWorkspaceDirectoryEntry): FileMentionOption {
  const relativePath = joinMentionPath(directoryPath, entry.name);
  return {
    id: relativePath,
    name: entry.name,
    path: relativePath,
    ext: resolveFileExtension(entry.name)
  };
}

/**
 * 读取一个工作区目录。
 * @param workspaceRoot - 工作区根目录
 * @param directoryPath - 目录相对路径
 * @returns 目录读取结果或错误
 */
async function readMentionDirectory(
  workspaceRoot: string,
  directoryPath: string
): Promise<{ result: ReadWorkspaceDirectoryResult; error: null } | { result: null; error: Error }> {
  const [error, result] = await asyncTo(
    Promise.resolve().then(() =>
      native.readWorkspaceDirectory({
        directoryPath,
        workspaceRoot
      })
    )
  );
  if (error || !result) {
    return {
      result: null,
      error: normalizeWorkspaceMentionError(error)
    };
  }

  return {
    result,
    error: null
  };
}

/**
 * 读取当前目录中的 .gitignore 内容。
 * @param workspaceRoot - 工作区根目录
 * @param directoryPath - 当前目录相对路径
 * @returns 文件内容；读取失败时返回 null
 */
async function readGitignoreFile(workspaceRoot: string, directoryPath: string): Promise<string | null> {
  const filePath = joinMentionPath(directoryPath, GITIGNORE_FILE_NAME);
  const [error, result] = await asyncTo(
    Promise.resolve().then(() =>
      native.readWorkspaceFile({
        filePath,
        workspaceRoot,
        limit: WORKSPACE_MENTION_GITIGNORE_READ_LIMIT
      })
    )
  );
  if (error || !result) return null;
  return result.content;
}

/**
 * 判断目录子项列表是否包含 .gitignore。
 * @param entries - 目录子项
 * @returns 是否包含 .gitignore 文件
 */
function hasGitignoreFile(entries: ReadWorkspaceDirectoryEntry[]): boolean {
  return entries.some((entry: ReadWorkspaceDirectoryEntry): boolean => entry.type === 'file' && entry.name === GITIGNORE_FILE_NAME);
}

/**
 * 判断文件或目录名是否为隐藏项。
 * @param entryName - 子项名称
 * @returns 是否为隐藏项
 */
function isHiddenEntry(entryName: string): boolean {
  return entryName.startsWith('.');
}

/**
 * 判断扩展名是否应该从候选中排除。
 * @param request - 扫描请求
 * @param fileName - 文件名
 * @returns 是否跳过该文件
 */
function hasExcludedExtension(request: WorkspaceMentionScanRequest, fileName: string): boolean {
  const extension = resolveFileExtension(fileName);
  return Boolean(extension) && request.excludedExtensions.has(extension);
}

/**
 * 解析单行 gitignore 规则。
 * @param rawLine - 原始规则行
 * @param basePath - 规则所在目录
 * @returns ignore 规则；空行或注释返回 null
 */
function parseGitignoreLine(rawLine: string, basePath: string): WorkspaceIgnoreRule | null {
  let line = rawLine.trimEnd();
  if (!line.trim() || line.trimStart().startsWith('#')) return null;
  if (line.startsWith('\\#')) line = line.slice(1);

  const negated = line.startsWith('!');
  if (negated) line = line.slice(1);
  if (!line) return null;

  const directoryOnly = line.endsWith('/');
  line = line.replace(/\/+$/u, '');
  const rooted = line.startsWith('/');
  if (rooted) line = line.slice(1);
  if (!line) return null;

  const hasSlash = line.includes('/');
  return {
    basePath,
    pattern: line,
    negated,
    directoryOnly,
    rooted,
    hasSlash,
    matcher: picomatch(line, { dot: true })
  };
}

/**
 * 解析 gitignore 文件内容。
 * @param content - .gitignore 内容
 * @param basePath - .gitignore 所在目录
 * @returns ignore 规则列表
 */
function parseGitignoreRules(content: string, basePath: string): WorkspaceIgnoreRule[] {
  return content
    .split(/\r?\n/u)
    .map((line: string): WorkspaceIgnoreRule | null => parseGitignoreLine(line, basePath))
    .filter((rule: WorkspaceIgnoreRule | null): rule is WorkspaceIgnoreRule => Boolean(rule));
}

/**
 * 将工作区路径裁剪成相对某条 ignore 规则的路径。
 * @param basePath - ignore 规则所在目录
 * @param relativePath - 待匹配工作区相对路径
 * @returns 规则作用域内路径；不在作用域时返回 null
 */
function toIgnoreScopedPath(basePath: string, relativePath: string): string | null {
  const normalizedBase = normalizeMentionPath(basePath);
  const normalizedRelative = normalizeMentionPath(relativePath);
  if (normalizedBase === '.') return normalizedRelative;
  if (normalizedRelative === normalizedBase) return '';
  if (normalizedRelative.startsWith(`${normalizedBase}/`)) return normalizedRelative.slice(normalizedBase.length + 1);
  return null;
}

/**
 * 判断 basename 规则是否匹配当前路径。
 * @param rule - ignore 规则
 * @param scopedPath - 规则作用域内路径
 * @returns 是否匹配
 */
function matchesBasenameRule(rule: WorkspaceIgnoreRule, scopedPath: string): boolean {
  return scopedPath.split('/').some((segment: string): boolean => rule.matcher(segment));
}

/**
 * 判断路径规则是否匹配当前路径。
 * @param rule - ignore 规则
 * @param scopedPath - 规则作用域内路径
 * @returns 是否匹配
 */
function matchesPathRule(rule: WorkspaceIgnoreRule, scopedPath: string): boolean {
  return rule.matcher(scopedPath);
}

/**
 * 获取当前路径包含的目录前缀。
 * @param scopedPath - 规则作用域内路径
 * @param entryType - 子项类型
 * @returns 从浅到深的目录路径
 */
function getDirectoryPaths(scopedPath: string, entryType: WorkspaceMentionEntryType): string[] {
  const segments = scopedPath.split('/').filter((segment: string): boolean => segment.length > 0);
  const directorySegmentCount = entryType === 'directory' ? segments.length : segments.length - 1;
  const directoryPaths: string[] = [];

  for (let segmentIndex = 1; segmentIndex <= directorySegmentCount; segmentIndex += 1) {
    directoryPaths.push(segments.slice(0, segmentIndex).join('/'));
  }

  return directoryPaths;
}

/**
 * 判断目录专用规则是否匹配当前路径。
 * @param rule - ignore 规则
 * @param scopedPath - 规则作用域内路径
 * @param entryType - 子项类型
 * @returns 是否匹配
 */
function matchesDirectoryOnlyRule(rule: WorkspaceIgnoreRule, scopedPath: string, entryType: WorkspaceMentionEntryType): boolean {
  const directoryPaths = getDirectoryPaths(scopedPath, entryType);
  if (rule.rooted || rule.hasSlash) {
    return directoryPaths.some((directoryPath: string): boolean => matchesPathRule(rule, directoryPath));
  }

  return directoryPaths.some((directoryPath: string): boolean => {
    const segments = directoryPath.split('/');
    return rule.matcher(segments[segments.length - 1] ?? directoryPath);
  });
}

/**
 * 判断单条 ignore 规则是否命中。
 * @param rule - ignore 规则
 * @param relativePath - 工作区相对路径
 * @param entryType - 子项类型
 * @returns 是否命中
 */
function matchesIgnoreRule(rule: WorkspaceIgnoreRule, relativePath: string, entryType: WorkspaceMentionEntryType): boolean {
  const scopedPath = toIgnoreScopedPath(rule.basePath, relativePath);
  if (!scopedPath) return false;
  if (rule.directoryOnly) return matchesDirectoryOnlyRule(rule, scopedPath, entryType);
  if (rule.rooted || rule.hasSlash) return matchesPathRule(rule, scopedPath);
  return matchesBasenameRule(rule, scopedPath);
}

/**
 * 判断路径是否被 ignore 规则排除。
 * @param rules - 当前继承到的 ignore 规则
 * @param relativePath - 工作区相对路径
 * @param entryType - 子项类型
 * @returns 是否忽略
 */
function isIgnoredByRules(rules: WorkspaceIgnoreRule[], relativePath: string, entryType: WorkspaceMentionEntryType): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (matchesIgnoreRule(rule, relativePath, entryType)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

/**
 * 判断反选规则是否可能命中当前目录后代。
 * @param rule - ignore 规则
 * @param directoryPath - 工作区目录相对路径
 * @returns 是否可能重新包含后代
 */
function canReincludeDescendant(rule: WorkspaceIgnoreRule, directoryPath: string): boolean {
  if (!rule.negated || (!rule.rooted && !rule.hasSlash)) return false;

  const scopedDirectory = toIgnoreScopedPath(rule.basePath, directoryPath);
  if (!scopedDirectory) return false;
  const normalizedPattern = normalizeMentionPath(rule.pattern);
  return normalizedPattern === scopedDirectory || normalizedPattern.startsWith(`${scopedDirectory}/`);
}

/**
 * 判断当前目录下是否有可能被反选规则重新包含的后代。
 * @param rules - 当前继承到的 ignore 规则
 * @param directoryPath - 工作区目录相对路径
 * @returns 是否存在可能重新包含的后代
 */
function hasReincludedDescendant(rules: WorkspaceIgnoreRule[], directoryPath: string): boolean {
  return rules.some((rule: WorkspaceIgnoreRule): boolean => canReincludeDescendant(rule, directoryPath));
}

/**
 * 读取当前目录追加的 ignore 规则。
 * @param workspaceRoot - 工作区根目录
 * @param directoryPath - 当前目录相对路径
 * @param entries - 当前目录子项
 * @returns 当前目录新增规则
 */
async function readDirectoryIgnoreRules(workspaceRoot: string, directoryPath: string, entries: ReadWorkspaceDirectoryEntry[]): Promise<WorkspaceIgnoreRule[]> {
  if (!hasGitignoreFile(entries)) return [];

  const content = await readGitignoreFile(workspaceRoot, directoryPath);
  if (!content) return [];
  return parseGitignoreRules(content, normalizeMentionPath(directoryPath));
}

/**
 * 判断当前文件是否应该跳过。
 * @param request - 扫描请求
 * @param entry - 文件子项
 * @param relativePath - 文件相对路径
 * @param ignoreRules - 当前目录继承到的 ignore 规则
 * @returns 是否跳过文件
 */
function shouldSkipFile(
  request: WorkspaceMentionScanRequest,
  entry: ReadWorkspaceDirectoryEntry,
  relativePath: string,
  ignoreRules: WorkspaceIgnoreRule[]
): boolean {
  if (entry.name === GITIGNORE_FILE_NAME) return true;
  if (isHiddenEntry(entry.name)) return true;
  if (hasExcludedExtension(request, entry.name)) return true;
  return isIgnoredByRules(ignoreRules, relativePath, 'file');
}

/**
 * 判断当前子目录是否应该跳过。
 * @param request - 扫描请求
 * @param entry - 目录子项
 * @param relativePath - 目录相对路径
 * @param ignoreRules - 当前目录继承到的 ignore 规则
 * @returns 是否跳过目录
 */
function shouldSkipDirectory(
  request: WorkspaceMentionScanRequest,
  entry: ReadWorkspaceDirectoryEntry,
  relativePath: string,
  ignoreRules: WorkspaceIgnoreRule[]
): boolean {
  if (isHiddenEntry(entry.name)) return true;
  if (request.excludedDirectories.has(entry.name)) return true;
  if (!isIgnoredByRules(ignoreRules, relativePath, 'directory')) return false;
  return !hasReincludedDescendant(ignoreRules, relativePath);
}

/**
 * 比较目录子项名称，保证扫描顺序稳定。
 * @param first - 第一个子项
 * @param second - 第二个子项
 * @returns 排序值
 */
function compareEntryName(first: ReadWorkspaceDirectoryEntry, second: ReadWorkspaceDirectoryEntry): number {
  return first.name.localeCompare(second.name, undefined, { sensitivity: 'base' });
}

/**
 * 比较文件候选展示顺序。
 * @param first - 第一个候选
 * @param second - 第二个候选
 * @returns 排序值
 */
function compareMentionPath(first: FileMentionOption, second: FileMentionOption): number {
  const firstPath = first.path ?? first.name;
  const secondPath = second.path ?? second.name;
  const firstDepth = firstPath.split('/').length;
  const secondDepth = secondPath.split('/').length;
  if (firstDepth !== secondDepth) return firstDepth - secondDepth;
  return firstPath.localeCompare(secondPath, undefined, { sensitivity: 'base' });
}

/**
 * 复制候选列表，避免缓存数组被调用方响应式引用修改。
 * @param files - 文件候选
 * @returns 候选副本
 */
function cloneMentionFiles(files: FileMentionOption[]): FileMentionOption[] {
  return files.map((file: FileMentionOption): FileMentionOption => ({ ...file }));
}

/**
 * 创建工作区扫描缓存键。
 * @param request - 扫描请求
 * @returns 缓存键
 */
function createScanCacheKey(request: WorkspaceMentionScanRequest): string {
  const directories = [...request.excludedDirectories].sort().join('\n');
  const extensions = [...request.excludedExtensions].sort().join('\n');
  return [request.workspaceRoot, String(request.limit), directories, extensions].join('\0');
}

/**
 * 判断缓存是否仍在有效期内。
 * @param entry - 缓存条目
 * @param cacheTtlMs - 缓存时长
 * @returns 是否有效
 */
function isFreshCache(entry: WorkspaceMentionCacheEntry, cacheTtlMs: number): boolean {
  return Date.now() - entry.createdAt <= cacheTtlMs;
}

/**
 * 读取有效文件候选上限。
 * @param limit - 外部传入上限
 * @returns 可用上限
 */
function resolveMentionLimit(limit: number | undefined): number {
  if (!Number.isInteger(limit) || limit === undefined || limit < 1) return DEFAULT_WORKSPACE_MENTION_LIMIT;
  return limit;
}

/**
 * 读取有效缓存时长。
 * @param cacheTtlMs - 外部传入缓存时长
 * @returns 可用缓存时长
 */
function resolveCacheTtlMs(cacheTtlMs: number | undefined): number {
  if (!Number.isFinite(cacheTtlMs) || cacheTtlMs === undefined || cacheTtlMs < 0) return DEFAULT_WORKSPACE_MENTION_CACHE_TTL_MS;
  return cacheTtlMs;
}

/**
 * 解析需要跳过的扩展名集合。
 * @param extensions - 外部传入扩展名
 * @returns 小写扩展名集合
 */
function resolveExcludedExtensions(extensions: readonly string[] | undefined): Set<string> {
  return new Set((extensions ?? WORKSPACE_MENTION_EXCLUDED_EXTENSIONS).map((extension: string): string => extension.toLowerCase()));
}

/**
 * 扫描一个工作区并收集文件候选。
 * @param request - 扫描请求
 * @returns 扫描结果
 */
async function scanWorkspaceMentions(request: WorkspaceMentionScanRequest): Promise<WorkspaceMentionScanResult> {
  const files: FileMentionOption[] = [];
  const queue: WorkspaceMentionScanTask[] = [{ directoryPath: '.', ignoreRules: [] }];

  while (queue.length > 0 && files.length < request.limit) {
    const task = queue.shift();
    if (!task) break;

    // 目录遍历按队列顺序执行，保证浅层文件先进入候选。
    // eslint-disable-next-line no-await-in-loop
    const { result, error } = await readMentionDirectory(request.workspaceRoot, task.directoryPath);
    if (error || !result) {
      if (task.directoryPath === '.') return { files: [], error };
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const directoryIgnoreRules = await readDirectoryIgnoreRules(request.workspaceRoot, task.directoryPath, result.entries);
    const ignoreRules = [...task.ignoreRules, ...directoryIgnoreRules];
    const fileEntries = result.entries.filter((entry: ReadWorkspaceDirectoryEntry): boolean => entry.type === 'file').sort(compareEntryName);
    const directoryEntries = result.entries.filter((entry: ReadWorkspaceDirectoryEntry): boolean => entry.type === 'directory').sort(compareEntryName);

    for (const entry of fileEntries) {
      if (files.length >= request.limit) break;
      const relativePath = joinMentionPath(task.directoryPath, entry.name);
      if (shouldSkipFile(request, entry, relativePath, ignoreRules)) continue;
      files.push(createMentionOption(task.directoryPath, entry));
    }

    for (const entry of directoryEntries) {
      if (files.length >= request.limit) break;
      const relativePath = joinMentionPath(task.directoryPath, entry.name);
      if (shouldSkipDirectory(request, entry, relativePath, ignoreRules)) continue;
      queue.push({ directoryPath: relativePath, ignoreRules });
    }
  }

  return {
    files: files.sort(compareMentionPath),
    error: null
  };
}

/**
 * 读取缓存或执行扫描。
 * @param request - 扫描请求
 * @param cacheTtlMs - 缓存时长
 * @param useCache - 是否允许复用缓存和进行中的扫描
 * @returns 扫描结果
 */
async function readCachedWorkspaceMentions(request: WorkspaceMentionScanRequest, cacheTtlMs: number, useCache: boolean): Promise<WorkspaceMentionScanResult> {
  const cacheKey = createScanCacheKey(request);
  const cached = workspaceMentionCache.get(cacheKey);
  if (useCache && cached && isFreshCache(cached, cacheTtlMs)) {
    return {
      files: cloneMentionFiles(cached.files),
      error: null
    };
  }

  const inflightScan = workspaceMentionInflightScans.get(cacheKey);
  if (useCache && inflightScan) {
    const result = await inflightScan;
    return {
      files: cloneMentionFiles(result.files),
      error: result.error
    };
  }

  const scanPromise = scanWorkspaceMentions(request).catch(
    (error: unknown): WorkspaceMentionScanResult => ({
      files: [],
      error: normalizeWorkspaceMentionError(error)
    })
  );
  workspaceMentionInflightScans.set(cacheKey, scanPromise);
  const result = await scanPromise;
  if (workspaceMentionInflightScans.get(cacheKey) === scanPromise) {
    workspaceMentionInflightScans.delete(cacheKey);
  }

  if (!result.error) {
    workspaceMentionCache.set(cacheKey, {
      createdAt: Date.now(),
      files: cloneMentionFiles(result.files)
    });
  }

  return {
    files: cloneMentionFiles(result.files),
    error: result.error
  };
}

/**
 * 扫描手动会话工作区，生成 @ 文件提及候选。
 * @param options - 工作区、启用状态与扫描限制
 * @returns 工作区文件提及状态
 */
export function useWorkspaceMentions(options: UseWorkspaceMentionsOptions): UseWorkspaceMentionsReturn {
  const mentionFiles = ref<FileMentionOption[]>([]);
  const loading = ref<boolean>(false);
  const scanError = ref<Error | null>(null);
  const fileMentions = computed<FileMentionOption[]>((): FileMentionOption[] => mentionFiles.value);
  let scanSequence = 0;

  /** 清空当前候选和扫描状态。 */
  function clearMentions(): void {
    mentionFiles.value = [];
    loading.value = false;
    scanError.value = null;
  }

  /**
   * 执行当前工作区文件候选刷新。
   * @param useCache - 是否允许复用缓存结果
   */
  async function runRefresh(useCache: boolean): Promise<void> {
    const currentSequence = ++scanSequence;
    const workspaceRoot = options.workspaceRoot.value?.trim() ?? '';
    if (!options.enabled.value || !workspaceRoot) {
      clearMentions();
      return;
    }

    loading.value = true;
    scanError.value = null;
    const request: WorkspaceMentionScanRequest = {
      workspaceRoot,
      limit: resolveMentionLimit(options.limit),
      excludedDirectories: new Set(options.excludedDirectories ?? WORKSPACE_MENTION_EXCLUDED_DIRECTORIES),
      excludedExtensions: resolveExcludedExtensions(options.excludedExtensions)
    };
    const result = await readCachedWorkspaceMentions(request, resolveCacheTtlMs(options.cacheTtlMs), useCache);
    if (currentSequence !== scanSequence) return;

    if (result.error) {
      mentionFiles.value = [];
      scanError.value = result.error;
    } else {
      mentionFiles.value = result.files;
    }
    loading.value = false;
  }

  /**
   * 刷新当前工作区文件候选。
   */
  async function refresh(): Promise<void> {
    await runRefresh(false);
  }

  watch(
    [options.workspaceRoot, options.enabled],
    (): void => {
      asyncTo(runRefresh(true));
    },
    { immediate: true }
  );

  return {
    fileMentions,
    loading: readonly(loading),
    error: readonly(scanError),
    refresh
  };
}
