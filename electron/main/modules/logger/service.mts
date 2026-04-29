/**
 * @file service.mts
 * @description 初始化主进程日志服务，并放宽对象序列化深度以便完整打印复杂日志内容。
 */
import { inspect, type InspectOptions } from 'util';
import log from 'electron-log/main.js';

/**
 * 控制台日志序列化选项，确保深层数组和长字符串不会被折叠。
 */
const consoleInspectOptions: InspectOptions = {
  depth: null,
  maxArrayLength: null,
  maxStringLength: null,
  breakLength: Infinity, // ← 禁止自动换行
  compact: true // ← 紧凑单行模式
};

/**
 * 带有深度与 inspect 配置的控制台日志 transport。
 */
type ConsoleTransportWithInspect = typeof log.transports.console & {
  /** 对象序列化深度。 */
  depth: number;
  /** util.inspect 序列化选项。 */
  inspectOptions: InspectOptions;
};

/**
 * 将复杂日志参数格式化为完整字符串，避免控制台输出时被折叠为 [Array]。
 * @param args - 原始日志参数
 * @returns 格式化后的日志参数
 */
export function formatLogArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (typeof arg === 'object' && arg !== null) {
      return inspect(arg, consoleInspectOptions);
    }

    return arg;
  });
}

/**
 * 初始化 Electron 主进程日志服务。
 * @returns 无返回值
 */
export function initLogger(): void {
  const consoleTransport = log.transports.console as ConsoleTransportWithInspect;

  // 初始化 electron-log，后续所有主进程日志都通过统一 transport 输出。
  log.initialize();

  // 禁用文件日志，仅保留控制台输出，避免写入额外日志文件。
  log.transports.file.level = false;

  // 放宽控制台日志深度限制，避免深层消息被 electron-log 折叠为 [Array]。
  consoleTransport.level = 'info';
  consoleTransport.depth = Number.MAX_SAFE_INTEGER;
  consoleTransport.inspectOptions = {
    ...consoleTransport.inspectOptions,
    ...consoleInspectOptions
  };

  // 统一格式化对象日志参数，确保 direct log.info(...) 也不会把深层数组折叠为 [Array]。
  log.hooks = [
    ...log.hooks,
    (message) => ({
      ...message,
      data: formatLogArgs(message.data)
    })
  ];

  // 捕获未处理异常，确保异常信息也经过统一日志链路输出。
  log.errorHandler.startCatching();

  // 覆盖原生 console 方法，让业务代码直接使用 console.* 时也走统一格式。
  Object.assign(console, log.functions);
}

export { log };

// ============================================================
// 文件日志收集系统（与上方控制台日志并存，不冲突）
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import { LogLevel, type LogEntry, type LogEntryInput, type LogFileInfo, type LogQueryOptions } from './types.mjs';

/** 单文件最大字节数 (10MB) */
const MAX_FILE_SIZE = 10 * 1024 * 1024;
/** 日志文件最大保留天数 */
const MAX_LOG_DAYS = 30;
/** 日级维护检查间隔（1 小时，毫秒） */
const LOG_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
/** 上次完成日志清理的日期，模块级变量，进程生命周期内有效 */
let lastCleanupDate = '';

/**
 * 获取日志目录路径
 * Electron 会按平台返回带应用名的日志目录：
 * macOS:   ~/Library/Logs/Tibis/
 * Windows: %USERPROFILE%\AppData\Roaming\Tibis\logs\
 * Linux:   ~/.config/Tibis/logs/
 * @returns 日志目录绝对路径
 */
export function getLogDir(): string {
  return app.getPath('logs');
}

/**
 * 获取指定日期的日志文件路径
 * @param dateStr - 日期字符串 YYYY-MM-DD
 * @param suffix - 文件编号后缀（如 1），不传则无后缀
 * @returns 日志文件绝对路径
 */
function getLogFilePath(dateStr: string, suffix?: number): string {
  const dir = getLogDir();
  const name = suffix !== undefined
    ? `tibis-${dateStr}.${suffix}.log`
    : `tibis-${dateStr}.log`;
  return path.join(dir, name);
}

/**
 * 获取今日日志文件路径
 * 自动处理文件大小超限时的编号后缀
 * @returns 当前应写入的日志文件路径
 */
function getCurrentLogFilePath(): string {
  const today = formatDate(new Date());
  const basePath = getLogFilePath(today);

  if (!fs.existsSync(basePath) || fs.statSync(basePath).size < MAX_FILE_SIZE) {
    return basePath;
  }

  let suffix = 1;
  while (true) {
    const numberedPath = getLogFilePath(today, suffix);
    if (!fs.existsSync(numberedPath) || fs.statSync(numberedPath).size < MAX_FILE_SIZE) {
      return numberedPath;
    }
    suffix++;
  }
}

/**
 * 格式化日期为 YYYY-MM-DD
 * @param date - Date 对象
 * @returns 日期字符串
 */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 格式化时间戳为 YYYY-MM-DD HH:mm:ss.SSS
 * @param date - Date 对象
 * @returns 格式化的时间字符串
 */
function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${y}-${mo}-${d} ${h}:${mi}:${s}.${ms}`;
}

/**
 * 归一化日志消息，保证单行落盘
 * 将所有换行符转义为字面量 \n
 * @param message - 原始日志消息
 * @returns 转义后的单行消息
 */
function serializeMessage(message: string): string {
  return message
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '\\n');
}

/**
 * 还原日志消息中的换行，供 UI 展示使用
 * @param message - 落盘格式的消息
 * @returns 含真实换行的可展示文本
 */
function deserializeMessage(message: string): string {
  return message.replace(/\\n/g, '\n');
}

/**
 * 确保日志目录存在
 */
function ensureLogDir(): void {
  const dir = getLogDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 格式化日志行为写入格式
 * 时间戳统一在主进程生成，避免跨进程时钟不一致
 * @param entry - 日志条目
 * @returns 格式化后的日志行
 */
function formatLogLine(entry: LogEntryInput): string {
  const ts = entry.timestamp
    ? formatTimestamp(new Date(entry.timestamp))
    : formatTimestamp(new Date());
  const message = serializeMessage(entry.message);
  return `[${ts}] [${entry.level}] [${entry.scope}] ${message}`;
}

/**
 * 解析单行日志文本为 LogEntry
 * 消息内容不含真实换行，由 serializeMessage 在写入时保证
 * @param line - 日志行文本
 * @returns 解析后的 LogEntry，解析失败返回 null
 */
function parseLogLine(line: string): LogEntry | null {
  const match = line.match(
    /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\] \[(ERROR|WARN|INFO)\] \[(main|renderer|preload)\] (.+)$/
  );
  if (!match) return null;

  return {
    timestamp: match[1],
    level: match[2] as LogLevel,
    scope: match[3] as LogEntry['scope'],
    message: deserializeMessage(match[4]),
  };
}

/**
 * 写入日志条目到文件
 * 热路径：只执行目录检查和同步追加写入，不含任何额外逻辑
 * @param entry - 日志条目
 */
export function writeLog(entry: LogEntryInput): void {
  ensureLogDir();

  const line = formatLogLine(entry) + '\n';
  const filePath = getCurrentLogFilePath();

  try {
    fs.appendFileSync(filePath, line, 'utf-8');
  } catch {
    // 写入失败时静默处理，避免日志系统自身崩溃导致应用异常
  }
}

/**
 * 读取日志文件内容
 *
 * 实现说明（性能取舍）：
 * 每次调用都会全量读取并解析当日所有日志文件，在内存中完成过滤后再分页切片。
 * 复杂度为 O(当日全部日志行数)，与 offset/limit 无关。
 *
 * 在 Tibis 正常使用场景下（日均数百至数千条日志，< 500KB），此开销可忽略不计。
 * 若单日日志量超过 5MB（约 5 万行），查看器响应可能出现明显延迟。
 * 当前版本有意不做优化。
 *
 * @param options - 查询参数
 * @returns 按时间倒序（最新优先）排列的日志条目数组
 */
export function readLogs(options: LogQueryOptions = {}): LogEntry[] {
  const dateStr = options.date || formatDate(new Date());
  const limit = options.limit || 500;
  const offset = options.offset || 0;

  // 收集该日期的所有日志文件：base → .1 → .2（时间从旧到新）
  const allFiles: string[] = [];
  const basePath = getLogFilePath(dateStr);
  if (fs.existsSync(basePath)) {
    allFiles.push(basePath);
  }
  let suffix = 1;
  while (true) {
    const numberedPath = getLogFilePath(dateStr, suffix);
    if (fs.existsSync(numberedPath)) {
      allFiles.push(numberedPath);
      suffix++;
    } else {
      break;
    }
  }

  // 按正序逐文件解析，results 最终为时间正序（最旧 → 最新）
  let results: LogEntry[] = [];
  for (const filePath of allFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const entries = content
        .split('\n')
        .filter(Boolean)
        .map(parseLogLine)
        .filter((e): e is LogEntry => e !== null);
      results = [...results, ...entries];
    } catch {
      // 读取失败时跳过该文件，继续处理其余文件
    }
  }

  // 在内存中过滤
  if (options.level) {
    results = results.filter((e) => e.level === options.level);
  }
  if (options.scope) {
    results = results.filter((e) => e.scope === options.scope);
  }
  if (options.keyword) {
    const kw = options.keyword.toLowerCase();
    results = results.filter((e) => e.message.toLowerCase().includes(kw));
  }

  // results 当前为时间正序，reverse 后得到"最新优先"视图
  const orderedResults = [...results].reverse();

  // offset 为过滤后结果集的行偏移量，不是文件原始行号
  return orderedResults.slice(offset, offset + limit);
}

/**
 * 获取所有日志文件信息，按文件名倒序排列（最新在前）
 * @returns 日志文件信息数组
 */
export function getLogFiles(): LogFileInfo[] {
  const dir = getLogDir();
  if (!fs.existsSync(dir)) return [];

  try {
    return fs.readdirSync(dir)
      .filter((f) => f.startsWith('tibis-') && f.endsWith('.log'))
      .map((name) => {
        const filePath = path.join(dir, name);
        const stat = fs.statSync(filePath);
        return {
          name,
          size: stat.size,
          createdAt: stat.birthtime.toISOString(),
        };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch {
    return [];
  }
}

/**
 * 清理超过保留期限的日志文件
 */
export function cleanOldLogs(): void {
  const dir = getLogDir();
  if (!fs.existsSync(dir)) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_LOG_DAYS);
  const cutoffDateStr = formatDate(cutoff);

  try {
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('tibis-') && f.endsWith('.log'));
    for (const file of files) {
      const dateMatch = file.match(/^tibis-(\d{4}-\d{2}-\d{2})/);
      if (dateMatch && dateMatch[1] < cutoffDateStr) {
        fs.unlinkSync(path.join(dir, file));
      }
    }
  } catch {
    // 清理失败时静默处理
  }
}

/**
 * 按需执行日志维护
 * 每天最多执行一次，通过模块级变量 lastCleanupDate 去重
 */
function runLogMaintenanceIfNeeded(): void {
  const today = formatDate(new Date());
  if (lastCleanupDate === today) return;
  cleanOldLogs();
  lastCleanupDate = today;
}

/**
 * 启动日志维护定时器
 * 每小时检查一次是否需要清理，覆盖跨天不重启的运行场景。
 * 返回的句柄需在主进程持有，并在 before-quit 时 clearInterval。
 * @returns 定时器句柄
 */
export function startLogMaintenanceTimer(): NodeJS.Timeout {
  return setInterval(() => {
    runLogMaintenanceIfNeeded();
  }, LOG_MAINTENANCE_INTERVAL_MS);
}
