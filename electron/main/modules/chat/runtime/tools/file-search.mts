/**
 * @file file-search.mts
 * @description ChatRuntime 主进程文件搜索 helper。
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { Dirent } from 'node:fs';
import type { AIToolActivityReporter, AIToolExecutionError } from 'types/ai';
import picomatch from 'picomatch';
import { RuntimeSubprocessError, runBoundedSubprocess, type RuntimeSubprocessInput, type RuntimeSubprocessResult } from './subprocess-runner.mjs';

export { RuntimeSubprocessError, runBoundedSubprocess } from './subprocess-runner.mjs';

/** 默认搜索结果上限。 */
export const DEFAULT_FILE_SEARCH_LIMIT = 100;

/** 默认 grep 文件批次大小。 */
export const DEFAULT_GREP_BATCH_SIZE = 64;

/** 默认 stdout 字节上限。 */
export const DEFAULT_GREP_STDOUT_LIMIT_BYTES = 1024 * 1024;

/** 默认 stderr 字节上限。 */
export const DEFAULT_GREP_STDERR_LIMIT_BYTES = 64 * 1024;

/** 默认单行文本上限。 */
export const DEFAULT_GREP_LINE_TEXT_LIMIT = 2048;

/** 默认排除目录。 */
export const DEFAULT_FILE_SEARCH_EXCLUDED_DIRS = ['.git'] as const;

/** 默认 warning 返回数量上限。 */
export const DEFAULT_FILE_SEARCH_WARNING_LIMIT = 20;

/** 默认 warning 原因文本上限。 */
export const DEFAULT_FILE_SEARCH_WARNING_REASON_LIMIT = 500;

/** 文件搜索警告。 */
export interface RuntimeFileSearchWarning {
  /** 关联路径。 */
  path?: string;
  /** 警告原因。 */
  reason: string;
}

/** Glob 搜索输入。 */
export interface RuntimeGlobSearchInput {
  /** 搜索根路径。 */
  rootPath: string;
  /** Glob 模式。 */
  pattern: string;
  /** 结果上限。 */
  limit: number;
  /** 排除目录名称。 */
  excludedDirs: readonly string[];
  /** 取消信号。 */
  signal?: AbortSignal;
  /** 安全活动上报器。 */
  activity?: AIToolActivityReporter;
}

/** Glob 搜索结果。 */
export interface RuntimeGlobSearchResult {
  /** 匹配文件绝对路径列表。 */
  files: string[];
  /** 返回数量。 */
  count: number;
  /** 是否截断。 */
  truncated: boolean;
  /** 结果是否不完整。 */
  incomplete: boolean;
  /** 非致命搜索警告。 */
  warnings: RuntimeFileSearchWarning[];
  /** warning 是否被截断。 */
  warningsTruncated: boolean;
  /** 被跳过的 warning 数量。 */
  skippedWarningCount: number;
  /** 执行耗时。 */
  elapsedMs: number;
}

/** Grep 搜索输入。 */
export interface RuntimeGrepSearchInput {
  /** 搜索根路径。 */
  rootPath: string;
  /** grep -E 正则。 */
  pattern: string;
  /** 候选文件 glob。 */
  include?: string;
  /** 结果上限。 */
  limit: number;
  /** 每批文件数量。 */
  batchSize: number;
  /** 排除目录名称。 */
  excludedDirs: readonly string[];
  /** 可选固定总超时；Runtime Watchdog 托管时省略。 */
  timeoutMs?: number;
  /** stdout 字节上限。 */
  stdoutLimitBytes: number;
  /** stderr 字节上限。 */
  stderrLimitBytes: number;
  /** 单行文本上限。 */
  lineTextLimit: number;
  /** 取消信号。 */
  signal?: AbortSignal;
  /** 安全活动上报器。 */
  activity?: AIToolActivityReporter;
}

/** Grep 匹配结果。 */
export interface RuntimeGrepSearchMatch {
  /** 文件绝对路径。 */
  path: string;
  /** 行号。 */
  line: number;
  /** 匹配行文本。 */
  text: string;
}

/** Grep 搜索结果。 */
export interface RuntimeGrepSearchResult {
  /** 匹配结果列表。 */
  matches: RuntimeGrepSearchMatch[];
  /** 返回数量。 */
  count: number;
  /** 是否截断。 */
  truncated: boolean;
  /** 结果是否不完整。 */
  incomplete: boolean;
  /** 非致命搜索警告。 */
  warnings: RuntimeFileSearchWarning[];
  /** warning 是否被截断。 */
  warningsTruncated: boolean;
  /** 被跳过的 warning 数量。 */
  skippedWarningCount: number;
  /** 执行耗时。 */
  elapsedMs: number;
}

/** 文件遍历输入。 */
interface RuntimeFileWalkInput {
  /** 搜索根路径。 */
  rootPath: string;
  /** 批次大小。 */
  batchSize: number;
  /** 排除目录名称。 */
  excludedDirs: readonly string[];
  /** 取消信号。 */
  signal?: AbortSignal;
}

/** 文件遍历批次。 */
interface RuntimeFileWalkBatch {
  /** 当前批次文件路径。 */
  files: string[];
  /** 当前批次产生的非致命警告。 */
  warnings: RuntimeFileSearchWarning[];
}

/** 文件搜索 warning 状态。 */
interface RuntimeFileSearchWarningState {
  /** 已保留的 warning。 */
  warnings: RuntimeFileSearchWarning[];
  /** 已跳过的 warning 数量。 */
  skippedWarningCount: number;
}

/** grep 批次执行选项。 */
interface RuntimeGrepBatchOptions {
  /** 是否缓存 stdout。 */
  bufferStdout?: boolean;
  /** stdout 流式处理回调。 */
  onStdoutChunk?: RuntimeSubprocessInput['onStdoutChunk'];
}

/**
 * 创建文件搜索错误。
 * @param code - 工具错误码
 * @param message - 错误消息
 * @returns 搜索错误
 */
function createRuntimeSearchError(code: AIToolExecutionError['code'], message: string): RuntimeSubprocessError {
  return new RuntimeSubprocessError(code, message);
}

/**
 * 创建 warning 状态。
 * @returns warning 状态
 */
function createRuntimeFileSearchWarningState(): RuntimeFileSearchWarningState {
  return {
    warnings: [],
    skippedWarningCount: 0
  };
}

/**
 * 截断 warning 原因文本。
 * @param reason - 原始原因
 * @returns 截断后的原因
 */
function truncateRuntimeWarningReason(reason: string): string {
  if (reason.length <= DEFAULT_FILE_SEARCH_WARNING_REASON_LIMIT) return reason;
  return `${reason.slice(0, DEFAULT_FILE_SEARCH_WARNING_REASON_LIMIT - 3)}...`;
}

/**
 * 创建文件搜索警告。
 * @param filePath - 关联路径
 * @param error - 原始错误
 * @param fallbackReason - 兜底原因
 * @returns 搜索警告
 */
function createRuntimeFileSearchWarning(filePath: string | undefined, error: unknown, fallbackReason: string): RuntimeFileSearchWarning {
  const reason = error instanceof Error ? error.message : fallbackReason;
  return {
    ...(filePath ? { path: filePath } : {}),
    reason: truncateRuntimeWarningReason(reason)
  };
}

/**
 * 收集文件搜索 warning，并限制返回体大小。
 * @param state - warning 状态
 * @param warning - 待收集 warning
 */
function addRuntimeFileSearchWarning(state: RuntimeFileSearchWarningState, warning: RuntimeFileSearchWarning): void {
  if (state.warnings.length >= DEFAULT_FILE_SEARCH_WARNING_LIMIT) {
    state.skippedWarningCount += 1;
    return;
  }

  state.warnings.push({
    ...warning,
    reason: truncateRuntimeWarningReason(warning.reason)
  });
}

/**
 * 批量收集文件搜索 warning。
 * @param state - warning 状态
 * @param warnings - 待收集 warning 列表
 */
function addRuntimeFileSearchWarnings(state: RuntimeFileSearchWarningState, warnings: RuntimeFileSearchWarning[]): void {
  for (const warning of warnings) {
    addRuntimeFileSearchWarning(state, warning);
  }
}

/**
 * 判断结果是否不完整。
 * @param truncated - 是否触发结果截断
 * @param warnings - 非致命警告
 * @returns 是否不完整
 */
function isRuntimeSearchIncomplete(truncated: boolean, warningState: RuntimeFileSearchWarningState): boolean {
  return truncated || warningState.warnings.length > 0 || warningState.skippedWarningCount > 0;
}

/**
 * 创建 warning 返回字段。
 * @param warningState - warning 状态
 * @returns warning 返回字段
 */
function createRuntimeWarningResult(warningState: RuntimeFileSearchWarningState): {
  warnings: RuntimeFileSearchWarning[];
  warningsTruncated: boolean;
  skippedWarningCount: number;
} {
  return {
    warnings: warningState.warnings,
    warningsTruncated: warningState.skippedWarningCount > 0,
    skippedWarningCount: warningState.skippedWarningCount
  };
}

/**
 * 判断取消信号是否已触发。
 * @param signal - 取消信号
 */
function throwIfRuntimeSearchAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createRuntimeSearchError('USER_CANCELLED', '工具调用已取消');
  }
}

/**
 * 将路径规范化为 glob matcher 使用的 POSIX 风格。
 * @param filePath - 文件路径
 * @returns POSIX 风格路径
 */
function normalizeRuntimeMatchPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

/**
 * 创建路径 matcher。
 * @param pattern - glob 模式
 * @returns matcher 函数
 */
function createRuntimePathMatcher(pattern: string): (filePath: string) => boolean {
  return picomatch(pattern, { dot: true });
}

/**
 * 读取目录子项并按名称排序。
 * @param directoryPath - 目录路径
 * @returns 排序后的目录子项
 */
async function readSortedDirectoryEntries(directoryPath: string): Promise<Dirent[]> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * 递归遍历文件，并按批次产出绝对路径。
 * @param input - 遍历输入
 */
async function* walkRuntimeFiles(input: RuntimeFileWalkInput): AsyncGenerator<RuntimeFileWalkBatch> {
  const excludedDirs = new Set(input.excludedDirs);
  const stack = [input.rootPath];
  let batch: string[] = [];

  while (stack.length > 0) {
    throwIfRuntimeSearchAborted(input.signal);
    const directoryPath = stack.pop();
    if (!directoryPath) continue;

    let entries: Dirent[];
    try {
      // 目录遍历必须按层读取，才能及时响应取消并避免一次性载入整棵树。
      // eslint-disable-next-line no-await-in-loop
      entries = await readSortedDirectoryEntries(directoryPath);
    } catch (error) {
      yield {
        files: [],
        warnings: [createRuntimeFileSearchWarning(directoryPath, error, '读取目录失败')]
      };
      continue;
    }

    const directories: string[] = [];
    for (const entry of entries) {
      throwIfRuntimeSearchAborted(input.signal);
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirs.has(entry.name)) directories.push(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;

      batch.push(entryPath);
      if (batch.length >= input.batchSize) {
        yield { files: batch, warnings: [] };
        batch = [];
      }
    }

    for (let index = directories.length - 1; index >= 0; index -= 1) {
      stack.push(directories[index]);
    }
  }

  if (batch.length > 0) {
    yield { files: batch, warnings: [] };
  }
}

/**
 * 判断文件是否匹配 include。
 * @param filePath - 文件路径
 * @param rootPath - 搜索根路径
 * @param matcher - matcher 函数
 * @returns 是否匹配
 */
function isRuntimeFileMatched(filePath: string, rootPath: string, matcher: (filePath: string) => boolean): boolean {
  const relativePath = normalizeRuntimeMatchPath(path.relative(rootPath, filePath));
  return matcher(relativePath);
}

/**
 * 执行 glob 文件搜索。
 * @param input - Glob 搜索输入
 * @returns Glob 搜索结果
 */
export async function runGlobSearch(input: RuntimeGlobSearchInput): Promise<RuntimeGlobSearchResult> {
  const startedAt = Date.now();
  const matcher = createRuntimePathMatcher(input.pattern);
  const files: string[] = [];
  const warningState = createRuntimeFileSearchWarningState();
  let truncated = false;
  let scannedFiles = 0;
  input.activity?.progress({ phase: 'scanning', completed: 0, message: '正在扫描文件' });

  for await (const batch of walkRuntimeFiles({
    rootPath: input.rootPath,
    batchSize: DEFAULT_GREP_BATCH_SIZE,
    excludedDirs: input.excludedDirs,
    signal: input.signal
  })) {
    addRuntimeFileSearchWarnings(warningState, batch.warnings);
    for (const filePath of batch.files) {
      throwIfRuntimeSearchAborted(input.signal);
      scannedFiles += 1;
      if (!isRuntimeFileMatched(filePath, input.rootPath, matcher)) continue;
      if (files.length >= input.limit) {
        truncated = true;
        input.activity?.progress({ phase: 'scanning', completed: scannedFiles, message: `已扫描 ${scannedFiles} 个文件，找到 ${files.length} 项` });
        input.activity?.progress({ phase: 'complete', completed: scannedFiles, message: `扫描完成，找到 ${files.length} 项` });
        return {
          files,
          count: files.length,
          truncated,
          incomplete: isRuntimeSearchIncomplete(truncated, warningState),
          ...createRuntimeWarningResult(warningState),
          elapsedMs: Date.now() - startedAt
        };
      }
      files.push(filePath);
    }
    if (batch.files.length > 0) {
      input.activity?.progress({ phase: 'scanning', completed: scannedFiles, message: `已扫描 ${scannedFiles} 个文件，找到 ${files.length} 项` });
    }
  }

  input.activity?.progress({ phase: 'complete', completed: scannedFiles, message: `扫描完成，找到 ${files.length} 项` });
  return {
    files,
    count: files.length,
    truncated,
    incomplete: isRuntimeSearchIncomplete(truncated, warningState),
    ...createRuntimeWarningResult(warningState),
    elapsedMs: Date.now() - startedAt
  };
}

/**
 * 解析 grep 输出行。
 * @param line - grep 输出行
 * @param fileCandidates - 当前 grep 批次文件候选
 * @returns 解析结果，无法解析时返回 null
 */
export function parseGrepMatchLine(line: string, fileCandidates: readonly string[] = []): RuntimeGrepSearchMatch | null {
  const sortedCandidates = [...fileCandidates].sort((left, right) => right.length - left.length);
  for (const filePath of sortedCandidates) {
    const prefix = `${filePath}:`;
    if (!line.startsWith(prefix)) continue;

    const lineAndText = line.slice(prefix.length);
    const nextColonIndex = lineAndText.indexOf(':');
    if (nextColonIndex < 0) return null;

    const lineText = lineAndText.slice(0, nextColonIndex);
    if (!/^\d+$/.test(lineText)) return null;

    return {
      path: filePath,
      line: Number(lineText),
      text: lineAndText.slice(nextColonIndex + 1)
    };
  }

  let previousColonIndex = line.indexOf(':');
  while (previousColonIndex > 0) {
    const currentColonIndex = line.indexOf(':', previousColonIndex + 1);
    if (currentColonIndex < 0) return null;

    const lineText = line.slice(previousColonIndex + 1, currentColonIndex);
    if (/^\d+$/.test(lineText)) {
      return {
        path: line.slice(0, previousColonIndex),
        line: Number(lineText),
        text: line.slice(currentColonIndex + 1)
      };
    }

    previousColonIndex = currentColonIndex;
  }

  return null;
}

/**
 * 计算本次 grep 搜索的剩余总超时时间。
 * @param deadlineAt - 截止时间戳
 * @param now - 当前时间戳
 * @returns 非负剩余毫秒数
 */
export function getRuntimeRemainingTimeoutMs(deadlineAt: number, now: number = Date.now()): number {
  return Math.max(0, deadlineAt - now);
}

/**
 * 截断匹配行文本。
 * @param text - 原始文本
 * @param limit - 文本上限
 * @returns 截断后的文本
 */
function truncateRuntimeMatchText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

/**
 * 判断 stderr 是否为 grep 正则错误。
 * @param stderr - stderr 文本
 * @returns 是否为正则错误
 */
function isRuntimeGrepPatternError(stderr: string): boolean {
  return /regular expression|repetition|unmatched|invalid|illegal|bracket|parenthes/i.test(stderr);
}

/**
 * 将 grep stdout 解析为匹配结果。
 * @param stdout - stdout 文本
 * @param lineTextLimit - 单行文本上限
 * @param fileCandidates - 当前 grep 批次文件候选
 * @returns 匹配结果列表
 */
function parseRuntimeGrepMatches(stdout: string, lineTextLimit: number, fileCandidates: readonly string[] = []): RuntimeGrepSearchMatch[] {
  const matches: RuntimeGrepSearchMatch[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    const parsed = parseGrepMatchLine(line, fileCandidates);
    if (!parsed) continue;
    matches.push({
      ...parsed,
      text: truncateRuntimeMatchText(parsed.text, lineTextLimit)
    });
  }
  return matches;
}

/**
 * 执行单批 grep。
 * @param input - Grep 搜索输入
 * @param fileBatch - 文件批次
 * @param timeoutMs - 本批次剩余超时时间
 * @returns 子进程结果
 */
async function runRuntimeGrepBatch(
  input: RuntimeGrepSearchInput,
  fileBatch: string[],
  timeoutMs: number | undefined,
  options: RuntimeGrepBatchOptions = {}
): Promise<RuntimeSubprocessResult> {
  const subprocessInput: RuntimeSubprocessInput = {
    command: 'grep',
    args: ['-H', '-n', '-E', '--', input.pattern, ...fileBatch],
    stdoutLimitBytes: input.stdoutLimitBytes,
    stderrLimitBytes: input.stderrLimitBytes,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(options.bufferStdout !== undefined ? { bufferStdout: options.bufferStdout } : {}),
    ...(options.onStdoutChunk ? { onStdoutChunk: options.onStdoutChunk } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.activity ? { activity: input.activity } : {})
  };
  return runBoundedSubprocess(subprocessInput);
}

/**
 * 根据 grep 退出码处理结果。
 * @param result - 子进程结果
 * @param pattern - 搜索正则
 */
function assertRuntimeGrepPatternValid(result: RuntimeSubprocessResult, pattern: string): void {
  if (result.exitCode === 0 || result.exitCode === 1) return;
  if (!isRuntimeGrepPatternError(result.stderr)) return;
  throw createRuntimeSearchError('INVALID_INPUT', `grep 正则表达式无效：${pattern}`);
}

/**
 * 构建单文件候选批次。
 * @param rootPath - 文件路径
 * @param include - include matcher
 * @returns 文件批次列表
 */
function createRuntimeSingleFileBatch(rootPath: string, include: ((filePath: string) => boolean) | undefined): RuntimeFileWalkBatch[] {
  if (include && !include(normalizeRuntimeMatchPath(path.basename(rootPath)))) return [];
  return [{ files: [rootPath], warnings: [] }];
}

/**
 * 创建 grep 执行失败警告。
 * @param filePath - 文件路径
 * @param result - 子进程结果
 * @returns 搜索警告
 */
function createRuntimeGrepFailureWarning(filePath: string, result: RuntimeSubprocessResult): RuntimeFileSearchWarning {
  return {
    path: filePath,
    reason: truncateRuntimeWarningReason(result.stderr.trim() || `grep 执行失败，退出码：${result.exitCode ?? 'unknown'}`)
  };
}

/**
 * 解析单行 grep 输出并写入匹配列表。
 * @param line - grep 输出行
 * @param fileBatch - 文件批次
 * @param lineTextLimit - 单行文本上限
 * @param matches - 匹配结果收集器
 */
function appendRuntimeGrepMatchLine(line: string, fileBatch: string[], lineTextLimit: number, matches: RuntimeGrepSearchMatch[]): void {
  const normalizedLine = line.endsWith('\r') ? line.slice(0, -1) : line;
  if (!normalizedLine) return;

  const parsed = parseGrepMatchLine(normalizedLine, fileBatch);
  if (!parsed) return;
  matches.push({
    ...parsed,
    text: truncateRuntimeMatchText(parsed.text, lineTextLimit)
  });
}

/**
 * 创建流式 grep stdout 消费器。
 * @param fileBatch - 文件批次
 * @param lineTextLimit - 单行文本上限
 * @param maxMatches - 当前批次最多收集 match 数
 * @param matches - 匹配结果收集器
 * @returns stdout 消费器
 */
function createRuntimeGrepStdoutConsumer(
  fileBatch: string[],
  lineTextLimit: number,
  maxMatches: number,
  matches: RuntimeGrepSearchMatch[]
): {
  consume: (chunk: Buffer) => 'continue' | 'terminate';
  flush: () => void;
} {
  const decoder = new StringDecoder('utf8');
  let pendingText = '';

  /**
   * 消费 stdout 文本。
   * @param text - stdout 文本片段
   * @returns 是否达到匹配上限
   */
  function consumeText(text: string): boolean {
    pendingText += text;
    let newlineIndex = pendingText.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = pendingText.slice(0, newlineIndex);
      pendingText = pendingText.slice(newlineIndex + 1);
      appendRuntimeGrepMatchLine(line, fileBatch, lineTextLimit, matches);
      if (matches.length >= maxMatches) return true;
      newlineIndex = pendingText.indexOf('\n');
    }

    return false;
  }

  return {
    consume(chunk: Buffer): 'continue' | 'terminate' {
      return consumeText(decoder.write(chunk)) ? 'terminate' : 'continue';
    },
    flush(): void {
      const restText = decoder.end();
      if (restText) {
        consumeText(restText);
      }
      if (pendingText) {
        appendRuntimeGrepMatchLine(pendingText, fileBatch, lineTextLimit, matches);
        pendingText = '';
      }
    }
  };
}

/**
 * 执行 grep 批次并尽量降级为部分结果。
 * @param input - Grep 搜索输入
 * @param fileBatch - 文件批次
 * @param deadlineAt - 可选整次 grep 搜索截止时间
 * @param warnings - 非致命警告收集器
 * @returns 当前批次匹配结果
 */
async function runRuntimeGrepBatchWithPartialResults(
  input: RuntimeGrepSearchInput,
  fileBatch: string[],
  deadlineAt: number | undefined,
  warningState: RuntimeFileSearchWarningState,
  maxMatches: number
): Promise<RuntimeGrepSearchMatch[]> {
  const remainingTimeoutMs = deadlineAt === undefined ? undefined : getRuntimeRemainingTimeoutMs(deadlineAt);
  if (remainingTimeoutMs === 0) {
    throw createRuntimeSearchError('TOOL_TIMEOUT', 'grep 执行超时');
  }

  const matches: RuntimeGrepSearchMatch[] = [];
  const stdoutConsumer = createRuntimeGrepStdoutConsumer(fileBatch, input.lineTextLimit, maxMatches, matches);
  const result = await runRuntimeGrepBatch(input, fileBatch, remainingTimeoutMs, {
    bufferStdout: false,
    onStdoutChunk: stdoutConsumer.consume
  });
  stdoutConsumer.flush();

  if (result.terminatedByConsumer) {
    return matches;
  }

  assertRuntimeGrepPatternValid(result, input.pattern);
  if (result.exitCode === 0) return matches.length > 0 ? matches : parseRuntimeGrepMatches(result.stdout, input.lineTextLimit, fileBatch);
  if (result.exitCode === 1) return [];

  if (fileBatch.length > 1) {
    const fallbackMatches: RuntimeGrepSearchMatch[] = [];
    for (const filePath of fileBatch) {
      throwIfRuntimeSearchAborted(input.signal);
      // eslint-disable-next-line no-await-in-loop
      const fileMatches = await runRuntimeGrepBatchWithPartialResults(input, [filePath], deadlineAt, warningState, maxMatches - fallbackMatches.length);
      fallbackMatches.push(...fileMatches);
      if (fallbackMatches.length >= maxMatches) return fallbackMatches;
    }
    return fallbackMatches;
  }

  addRuntimeFileSearchWarning(warningState, createRuntimeGrepFailureWarning(fileBatch[0], result));
  return [];
}

/**
 * 执行 grep 内容搜索。
 * @param input - Grep 搜索输入
 * @returns Grep 搜索结果
 */
export async function runGrepSearch(input: RuntimeGrepSearchInput): Promise<RuntimeGrepSearchResult> {
  const startedAt = Date.now();
  const deadlineAt = input.timeoutMs === undefined ? undefined : startedAt + input.timeoutMs;
  const matches: RuntimeGrepSearchMatch[] = [];
  const warningState = createRuntimeFileSearchWarningState();
  let truncated = false;
  let scannedFiles = 0;
  input.activity?.progress({ phase: 'scanning', completed: 0, message: '正在扫描候选文件' });
  const includeMatcher = input.include ? createRuntimePathMatcher(input.include) : undefined;
  const rootStats = await fs.stat(input.rootPath);
  const candidateBatches = rootStats.isFile()
    ? createRuntimeSingleFileBatch(input.rootPath, includeMatcher)
    : walkRuntimeFiles({ rootPath: input.rootPath, batchSize: input.batchSize, excludedDirs: input.excludedDirs, signal: input.signal });

  for await (const rawBatch of candidateBatches) {
    throwIfRuntimeSearchAborted(input.signal);
    addRuntimeFileSearchWarnings(warningState, rawBatch.warnings);
    scannedFiles += rawBatch.files.length;
    if (rawBatch.files.length > 0) {
      input.activity?.progress({ phase: 'scanning', completed: scannedFiles, message: `已扫描 ${scannedFiles} 个候选文件` });
    }
    const fileBatch = rootStats.isFile()
      ? rawBatch.files
      : rawBatch.files.filter((filePath) => !includeMatcher || isRuntimeFileMatched(filePath, input.rootPath, includeMatcher));
    if (fileBatch.length === 0) continue;

    const batchMatches = await runRuntimeGrepBatchWithPartialResults(input, fileBatch, deadlineAt, warningState, input.limit - matches.length + 1);
    for (const match of batchMatches) {
      if (matches.length >= input.limit) {
        truncated = true;
        input.activity?.progress({ phase: 'complete', completed: scannedFiles, message: `搜索完成，找到 ${matches.length} 项` });
        return {
          matches,
          count: matches.length,
          truncated,
          incomplete: isRuntimeSearchIncomplete(truncated, warningState),
          ...createRuntimeWarningResult(warningState),
          elapsedMs: Date.now() - startedAt
        };
      }
      matches.push(match);
    }
    input.activity?.progress({ phase: 'matching', completed: matches.length, message: `已找到 ${matches.length} 项` });
  }

  input.activity?.progress({ phase: 'complete', completed: scannedFiles, message: `搜索完成，找到 ${matches.length} 项` });
  return {
    matches,
    count: matches.length,
    truncated,
    incomplete: isRuntimeSearchIncomplete(truncated, warningState),
    ...createRuntimeWarningResult(warningState),
    elapsedMs: Date.now() - startedAt
  };
}
