# 日志收集系统 — 设计文档

## 概述

为 Tibis 构建一个集中式应用运行日志收集系统。通过主进程统一接收来自渲染进程、preload 脚本和主进程自身的日志，按天写入日志文件，并在设置页中提供内置的日志查看页面。支持 ERROR / WARN / INFO 三级日志。

---

## 需求汇总

| 维度 | 决策 |
|------|------|
| 日志类型 | 应用运行日志（错误、警告、信息） |
| 覆盖范围 | 全量（主进程 + preload + 渲染进程） |
| 存储方案 | 文件系统（按天滚动日志文件） |
| 日志级别 | 精简三级：ERROR / WARN / INFO |
| 查看器 | 设置页中的内置日志查看页面 |
| 架构模式 | 集中式日志管道（主进程为唯一写入点） |

---

## 架构

```
渲染进程 (Vue 3)
┌─────────────┐  ┌──────────────┐
│ logger.ts   │  │ SettingsLogView│
│ (日志 API)   │  │ (设置页查看)   │
└──────┬──────┘  └──────▲───────┘
       │                │
  window.electronAPI    │
  .log(level, msg)      │ .readLogs()
       │                │
├───────┼────────────────┼───────────────────────┤
│ preload│               │                       │
│ ┌──────┴────────────────┴───────┐              │
│ │  contextBridge 暴露 logger API│              │
│ └──────────┬────────────────────┘              │
│            │                                   │
├────────────┼───────────────────────────────────┤
│ 主进程      │                                   │
│ ┌──────────┴────────────────────┐              │
│ │  LoggerModule                 │              │
│ │  ├── 接收 IPC 日志写入事件     │              │
│ │  ├── 格式化时间戳 + 进程标识   │              │
│ │  ├── 日志文件滚动管理          │              │
│ │  └── 提供 IPC 日志读取 API    │              │
│ └──────────────┬───────────────┘              │
│                │                               │
│                ▼                               │
│  ~/Library/Logs/Tibis/                        │
│  ├── tibis-2026-04-29.log                     │
│  ├── tibis-2026-04-28.log                     │
│  └── ...                                      │
└────────────────────────────────────────────────┘
```

### 设计原则

- **单一写入点**：主进程为唯一的日志文件写入者，避免多进程文件锁竞争。渲染进程和 preload 通过 IPC 将日志发送到主进程，由主进程统一格式化后写入。
- **进程标识**：每条日志携带进程来源标识（`main` / `renderer` / `preload`），便于跨进程问题追踪和日志过滤。
- **即时写入**：日志到达主进程后立即 `fs.appendFileSync` 写入，不经过内存缓冲，确保应用崩溃时日志不丢失。
- **按天滚动**：每天一个日志文件，文件名包含日期。单文件超过 10MB 时自动编号后缀（如 `.1.log`）。超过 30 天的旧日志自动清理，并在应用运行期间按日触发维护。
- **最小化性能影响**：渲染进程日志发送使用异步 IPC（`ipcRenderer.invoke`），不阻塞 UI 线程。主进程使用同步文件写入保证崩溃安全。
- **时间戳口径统一**：所有日志最终都由主进程按 `YYYY-MM-DD HH:mm:ss.SSS` 格式写入文件；渲染进程和 preload 不直接决定落盘格式，避免写入与解析格式不一致。
- **单行落盘**：日志文件坚持"一行一条记录"。当原始消息包含换行时，写入前统一转义为字面量 `\n`，读取后再还原为可展示文本，避免多行日志破坏按行解析。
- **读取顺序固定**：日志查看器接口默认按时间倒序返回（最新日志优先），`loadMore` 始终继续获取更旧的数据并追加到列表底部，保证滚动体验和分页语义一致。
- **日志文件格式统一**：`[YYYY-MM-DD HH:mm:ss.SSS] [LEVEL] [SCOPE] message`，每行一条日志，纯文本，易于外部工具解析。

---

## 性能边界与已知取舍

### 读取性能上限

`readLogs` 当前采用**全量读取 + 内存过滤**的实现策略：每次分页请求都会完整读取并解析当日所有日志文件，在内存中完成 level / scope / keyword 过滤后，再对过滤结果执行 `slice` 分页。

这意味着第 N 页的请求与第 1 页的 I/O 和 CPU 开销完全相同，复杂度为 O(当日全部日志行数)。

**已知上限评估：**

| 单日日志量 | 估算行数（约 100 字节/行） | 解析耗时（参考值） | 结论 |
|---|---|---|---|
| < 1MB | < 1 万行 | < 5ms | 无感知 |
| 1–5MB | 1–5 万行 | 5–30ms | 可接受 |
| 5–10MB（单文件上限） | 5–10 万行 | 30–80ms | 偶发卡顿 |
| > 10MB（多文件） | > 10 万行 | > 80ms | 查看器明显变慢 |

主进程为单线程，全量解析期间会阻塞其他 IPC 请求。

**适用场景：** Tibis 是桌面笔记工具，日常使用产生的日志量通常在每天数百至数千条（< 500KB），全量读取方案完全够用。只有在调试模式下大量打印 INFO 日志时才可能接近上限。

**当前版本有意不做优化。** 若将来日志量明显增大，可考虑以下演进路径：
1. 流式逐行读取，命中 limit 后提前退出，避免解析整个文件
2. 写入时维护轻量索引文件（记录每行的字节偏移量），实现 O(1) 随机定位
3. 将日志写入 SQLite，由数据库承担过滤和分页

在此之前，维护者无需为"每页都全量读取"添加优化——这是已知取舍，不是遗漏。

### 分页末页行为

`hasMore` 的判断逻辑为 `result.length === PAGE_SIZE`。若过滤后结果恰好是 100 的整数倍，最后一页会触发一次额外的空请求（返回空数组后 `hasMore` 置为 `false`）。这是预期行为，不视为 bug。

### 定时器生命周期

`startLogMaintenanceTimer` 返回的 `NodeJS.Timeout` 句柄需在主进程持有，并在 `before-quit` 时 `clearInterval`，避免退出阶段触发无意义的维护回调。具体见"主进程集成"章节。

### `writeLog` 的写入热路径

`writeLog` 内部仅执行同步文件写入（`appendFileSync`）和目录存在性检查，不含任何耗时操作。日志维护（`cleanOldLogs`）由独立定时器驱动，不在写入热路径上执行。

---

## 日志格式

```
[2026-04-29 14:30:25.123] [ERROR] [main] 文件打开失败: /path/to/file.md
[2026-04-29 14:30:25.456] [INFO] [renderer] 用户打开了设置页面
[2026-04-29 14:30:25.789] [WARN] [preload] API 调用超时
```

每条日志由 4 部分组成：
- **时间戳**：精确到毫秒，格式 `YYYY-MM-DD HH:mm:ss.SSS`
- **日志级别**：`ERROR`、`WARN` 或 `INFO`
- **进程来源**：`main`、`renderer` 或 `preload`
- **消息内容**：自由文本，落盘时固定为单行；原始消息中的换行会被编码为 `\n`，读取后再解码为展示文本

> 设计取舍：本方案优先保证日志文件易于逐行解析与外部工具消费，因此不采用"续行缩进"的多行日志格式。

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `electron/main/modules/logger/index.ts` | 新增 | Logger IPC 模块入口，注册 IPC handler |
| `electron/main/modules/logger/logger-core.ts` | 新增 | 日志核心：格式化、写入、滚动管理 |
| `electron/main/modules/logger/types.ts` | 新增 | 主进程日志类型定义 |
| `electron/main/index.ts` | 修改 | 注册 logger 模块 |
| `electron/preload/index.ts` | 修改 | 新增 logger API 桥接 |
| `src/shared/logger/index.ts` | 新增 | 渲染进程日志 API（单例） |
| `src/shared/logger/types.ts` | 新增 | 前端日志类型定义 |
| `src/shared/platform/types.ts` | 修改 | 新增 logger 相关类型声明 |
| `src/views/settings/logger/index.vue` | 新增 | 设置页中的日志查看页面主入口 |
| `src/views/settings/logger/components/LogFilterBar.vue` | 新增 | 日志过滤工具栏 |
| `src/views/settings/logger/components/LogEntry.vue` | 新增 | 单条日志条目渲染 |
| `src/views/settings/logger/stores/logViewer.ts` | 新增 | 日志查看页面 Pinia Store |
| `src/views/settings/constants.ts` | 修改 | 新增"日志查看"设置菜单项 |
| `src/router/routes/modules/settings.ts` | 修改 | 注册 `/settings/logger` 路由 |

---

## 模块设计

### 1. 类型定义 — `electron/main/modules/logger/types.ts`

```typescript
/**
 * 日志级别
 */
export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
}

/**
 * 进程来源标识
 */
export type LogScope = 'main' | 'renderer' | 'preload';

/**
 * 日志条目（写入时的原始数据）
 */
export interface LogEntryInput {
  /** 日志级别 */
  level: LogLevel;
  /** 日志消息内容 */
  message: string;
  /** 进程来源标识 */
  scope: LogScope;
  /** 原始时间戳字符串，不传则使用主进程当前时间 */
  timestamp?: string;
}

/**
 * 日志条目（读取时的数据格式）
 */
export interface LogEntry {
  /** 日志级别 */
  level: LogLevel;
  /** 日志消息内容 */
  message: string;
  /** 进程来源标识 */
  scope: LogScope;
  /** 格式化后的时间戳字符串 YYYY-MM-DD HH:mm:ss.SSS */
  timestamp: string;
}

/**
 * 日志查询参数
 */
export interface LogQueryOptions {
  /** 筛选日志级别 */
  level?: LogLevel;
  /** 筛选进程来源 */
  scope?: LogScope;
  /** 关键字搜索（匹配 message 字段） */
  keyword?: string;
  /** 查询日期（YYYY-MM-DD），不传则查当天 */
  date?: string;
  /** 返回条数上限，默认 500 */
  limit?: number;
  /**
   * 分页偏移量，默认 0
   * 语义：过滤后结果集的行偏移量，不是文件原始行号。
   * 每次 readLogs 都会全量读取并过滤文件，offset 只影响最终 slice 范围。
   */
  offset?: number;
}

/**
 * 日志文件信息
 */
export interface LogFileInfo {
  /** 日志文件相对名称 */
  name: string;
  /** 文件大小（字节） */
  size: number;
  /** 文件创建时间 ISO 字符串 */
  createdAt: string;
}
```

### 2. 日志核心 — `electron/main/modules/logger/logger-core.ts`

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import { LogLevel, type LogEntry, type LogEntryInput, type LogFileInfo, type LogQueryOptions } from './types';

/** 单文件最大字节数 (10MB) */
const MAX_FILE_SIZE = 10 * 1024 * 1024;
/** 日志文件最大保留天数 */
const MAX_LOG_DAYS = 30;
/** 日级维护检查间隔（1 小时） */
const LOG_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
/** 上次完成日志清理的日期，模块级变量，进程生命周期内有效 */
let lastCleanupDate = '';

/**
 * 获取日志目录路径
 * Electron 会按平台返回带应用名的日志目录，无需手动拼接子目录：
 * macOS:   ~/Library/Logs/<AppName>/
 * Windows: %USERPROFILE%\AppData\Roaming\<AppName>\logs\
 * Linux:   ~/.config/<AppName>/logs/
 */
export function getLogDir(): string {
  return app.getPath('logs');
}

/**
 * 获取指定日期的日志文件路径
 * @param dateStr - 日期字符串 YYYY-MM-DD
 * @param suffix - 文件编号后缀（如 1），不传则无后缀
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
 */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 格式化时间戳为 YYYY-MM-DD HH:mm:ss.SSS
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
 */
function serializeMessage(message: string): string {
  return message
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '\\n');
}

/**
 * 还原日志消息中的换行，供 UI 展示使用
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
 * @returns 解析失败返回 null
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
 * 当前版本有意不做优化；如需改进，参见"性能边界与已知取舍"章节的演进路径。
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

  // results 当前为时间正序（base 文件 → 编号后缀文件，每文件内自上而下）
  // reverse 后得到"最新优先"视图，与查看器展示顺序一致
  // 注意：若修改上方文件遍历顺序，此处需联动调整
  const orderedResults = [...results].reverse();

  // offset 为过滤后结果集的行偏移量，不是文件原始行号
  return orderedResults.slice(offset, offset + limit);
}

/**
 * 获取所有日志文件信息，按文件名倒序排列（最新在前）
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
 */
export function startLogMaintenanceTimer(): NodeJS.Timeout {
  return setInterval(() => {
    runLogMaintenanceIfNeeded();
  }, LOG_MAINTENANCE_INTERVAL_MS);
}
```

### 3. IPC 模块入口 — `electron/main/modules/logger/index.ts`

```typescript
import { ipcMain, shell } from 'electron';
import { type LogEntryInput, type LogQueryOptions } from './types';
import { getLogDir, writeLog, readLogs, getLogFiles } from './logger-core';

/**
 * 注册 Logger 相关的所有 IPC handler
 */
export function registerLoggerIpc(): void {
  /** 写入日志（来自渲染进程或 preload） */
  ipcMain.handle('logger:write', (_event, entry: LogEntryInput) => {
    writeLog(entry);
  });

  /** 读取日志（供设置页日志查看器使用） */
  ipcMain.handle('logger:getLogs', (_event, options: LogQueryOptions) => {
    return readLogs(options);
  });

  /** 获取日志文件列表 */
  ipcMain.handle('logger:getFiles', () => {
    return getLogFiles();
  });

  /** 在系统文件管理器中打开日志目录 */
  ipcMain.handle('logger:openFolder', () => {
    shell.openPath(getLogDir());
  });
}
```

### 4. 主进程集成 — `electron/main/index.ts`

```typescript
import { registerLoggerIpc } from './modules/logger';
import { cleanOldLogs, startLogMaintenanceTimer } from './modules/logger/logger-core';

// 注册 Logger IPC handler
registerLoggerIpc();

// 启动时清理一次过期日志
cleanOldLogs();

// 持有定时器句柄，覆盖跨天不重启场景；退出前清理避免无效回调
const maintenanceTimer = startLogMaintenanceTimer();
app.on('before-quit', () => clearInterval(maintenanceTimer));
```

### 5. Preload 桥接 — `electron/preload/index.ts`

preload 中将"对渲染进程暴露的 logger API"和"preload 自身内部使用的 logger"分开，避免所有来源被错误标记为 `renderer`。

```typescript
/**
 * 发送带来源标识的日志到主进程
 * IPC 失败时静默处理，与主进程写入失败策略保持一致
 */
function writeScopedLog(
  scope: 'renderer' | 'preload',
  level: 'ERROR' | 'WARN' | 'INFO',
  message: string,
): Promise<void> {
  return ipcRenderer
    .invoke('logger:write', { scope, level, message })
    .catch(() => {
      // 静默处理，避免未捕获的 Promise rejection 污染控制台
    });
}

/** 渲染进程可见的 logger API，scope 固定为 renderer */
const rendererLogger = {
  error: (message: string) => writeScopedLog('renderer', 'ERROR', message),
  warn: (message: string) => writeScopedLog('renderer', 'WARN', message),
  info: (message: string) => writeScopedLog('renderer', 'INFO', message),
};

/** preload 自身内部日志 API，scope 固定为 preload，不暴露到 window */
const preloadLogger = {
  error: (message: string) => writeScopedLog('preload', 'ERROR', message),
  warn: (message: string) => writeScopedLog('preload', 'WARN', message),
  info: (message: string) => writeScopedLog('preload', 'INFO', message),
};

contextBridge.exposeInMainWorld('electronAPI', {
  // ... 现有 API 保持不变

  logger: {
    ...rendererLogger,

    /** 读取日志，供设置页查看器调用 */
    getLogs: (options: LogQueryOptions) =>
      ipcRenderer.invoke('logger:getLogs', options),

    /** 获取日志文件列表 */
    getLogFiles: () => ipcRenderer.invoke('logger:getFiles'),

    /** 在系统文件管理器中打开日志文件夹 */
    openLogFolder: () => ipcRenderer.invoke('logger:openFolder'),
  },
});

// preload 自身初始化日志，scope 为 preload
preloadLogger.info('preload 已初始化');
```

### 6. 渲染进程日志 API — `src/shared/logger/`

#### 6.1 类型定义 — `src/shared/logger/types.ts`

```typescript
export type LogLevel = 'ERROR' | 'WARN' | 'INFO';

export interface LogEntry {
  level: LogLevel;
  message: string;
  scope: 'main' | 'renderer' | 'preload';
  /** 格式化后的时间戳字符串 YYYY-MM-DD HH:mm:ss.SSS */
  timestamp: string;
}

export interface LogQueryOptions {
  level?: LogLevel;
  scope?: 'main' | 'renderer' | 'preload';
  keyword?: string;
  /** 查询日期 YYYY-MM-DD */
  date?: string;
  limit?: number;
  /** 分页偏移量，基于过滤后的结果集 */
  offset?: number;
}

export interface LogFileInfo {
  name: string;
  size: number;
  createdAt: string;
}
```

#### 6.2 Logger 单例 — `src/shared/logger/index.ts`

```typescript
import type { LogQueryOptions, LogEntry, LogFileInfo } from './types';

interface ElectronLoggerApi {
  error: (message: string) => Promise<void>;
  warn: (message: string) => Promise<void>;
  info: (message: string) => Promise<void>;
  getLogs: (options: LogQueryOptions) => Promise<LogEntry[]>;
  getLogFiles: () => Promise<LogFileInfo[]>;
  openLogFolder: () => Promise<void>;
}

function createNoopLogger(): ElectronLoggerApi {
  const noop = async (..._args: unknown[]): Promise<void> => {};
  return {
    error: noop,
    warn: noop,
    info: noop,
    getLogs: async () => [],
    getLogFiles: async () => [],
    openLogFolder: noop,
  } as unknown as ElectronLoggerApi;
}

function getLoggerApi(): ElectronLoggerApi {
  if (typeof window !== 'undefined' && window.electronAPI?.logger) {
    return window.electronAPI.logger;
  }
  // 非 Electron 环境（纯前端开发模式）返回空实现，不抛错
  return createNoopLogger();
}

class Logger {
  private api: ElectronLoggerApi = getLoggerApi();

  /**
   * 写入 ERROR 级别日志
   * @param tag - 可选模块标签，拼接为 [tag] message 格式
   */
  error(message: string, tag?: string): void {
    this.api.error(tag ? `[${tag}] ${message}` : message);
  }

  warn(message: string, tag?: string): void {
    this.api.warn(tag ? `[${tag}] ${message}` : message);
  }

  info(message: string, tag?: string): void {
    this.api.info(tag ? `[${tag}] ${message}` : message);
  }

  async getLogs(options?: LogQueryOptions): Promise<LogEntry[]> {
    return this.api.getLogs(options ?? {});
  }

  async getLogFiles(): Promise<LogFileInfo[]> {
    return this.api.getLogFiles();
  }

  openLogFolder(): void {
    this.api.openLogFolder();
  }
}

export const logger = new Logger();
```

### 7. 平台类型声明 — `src/shared/platform/types.ts`

```typescript
interface ElectronAPI {
  // ... 现有字段保持不变

  logger: {
    error: (message: string) => Promise<void>;
    warn: (message: string) => Promise<void>;
    info: (message: string) => Promise<void>;
    getLogs: (options: LogQueryOptions) => Promise<LogEntry[]>;
    getLogFiles: () => Promise<LogFileInfo[]>;
    openLogFolder: () => Promise<void>;
  };
}
```

### 8. 状态管理约束

日志查看页面只保留一套状态来源：`src/views/settings/logger/stores/logViewer.ts`。

- `src/shared/logger/` 仅负责 Electron IPC 的日志读写封装，不含 UI 状态
- 设置页的筛选、分页、加载状态统一收敛到 Pinia Store
- 不额外设计 `useLogger.ts` 等并行状态容器，避免两份状态互相漂移

`LogFilterBar` 直接调用 Store 的 `setLevel` / `setKeyword` 等方法，不使用 `v-model` + `emits` 二次转发。

### 9. 设置页日志查看 — `src/views/settings/logger/`

#### 9.1 页面主组件 — `src/views/settings/logger/index.vue`

挂载在 `/settings/logger` 路由下，复用现有设置页左右布局。包含以下功能区域：

- **顶部工具栏**：级别筛选按钮（ERROR / WARN / INFO / 全部）、进程来源筛选、日期选择器、搜索输入框、打开日志文件夹按钮
- **日志列表区域**：虚拟滚动列表，按时间倒序（最新在上）；左侧显示时间戳 + 级别标签 + 来源标签，右侧显示消息内容
- **底部状态栏**：当前筛选条件下的日志总数、加载更多按钮

**页面集成：**
- `src/views/settings/constants.ts` 新增菜单项：`{ key: 'logger', label: '日志查看', icon: 'lucide:logs', path: '/settings/logger' }`
- `src/router/routes/modules/settings.ts` 新增子路由 `/settings/logger`
- `src/views/settings/index.vue` 无需改动布局

**UI 交互行为：**
- 切换筛选条件时调用 `store.setXxx()`，自动重置并重新加载
- 滚动到底部时触发 `store.loadMore()`，在列表底部追加更旧日志
- 末页会触发一次返回空数组的额外请求，属于预期行为，查看器应展示"已加载全部"状态而非持续 loading
- 单条日志支持点击复制
- ERROR 红色（`text-red-500`）、WARN 橙色（`text-orange-400`）、INFO 默认色

#### 9.2 过滤工具栏 — `src/views/settings/logger/components/LogFilterBar.vue`

- 级别筛选按钮组（BButton）
- 搜索输入框（BInput，带防抖）
- 日期选择器（BDatePicker）
- 打开文件夹按钮

事件直接调用 Store 方法，不通过父组件中转。

#### 9.3 日志条目 — `src/views/settings/logger/components/LogEntry.vue`

- 按级别着色，`monospace` 字体
- hover 时显示复制按钮

#### 9.4 Pinia Store — `src/views/settings/logger/stores/logViewer.ts`

```typescript
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { logger } from '@/shared/logger';
import type { LogEntry, LogQueryOptions, LogLevel } from '@/shared/logger/types';

export const useLogViewerStore = defineStore('logViewer', () => {
  const entries = ref<LogEntry[]>([]);
  const filterLevel = ref<LogLevel | undefined>(undefined);
  const filterScope = ref<'main' | 'renderer' | 'preload' | undefined>(undefined);
  const keyword = ref('');
  const selectedDate = ref<string>('');
  const isLoading = ref(false);
  /** 偏移量基于过滤后的结果集，不是文件原始行号 */
  const offset = ref(0);
  const hasMore = ref(true);

  const PAGE_SIZE = 100;

  async function loadLogs(reset = false): Promise<void> {
    if (isLoading.value) return;
    isLoading.value = true;

    if (reset) {
      offset.value = 0;
      entries.value = [];
      hasMore.value = true;
    }

    try {
      const options: LogQueryOptions = {
        limit: PAGE_SIZE,
        offset: offset.value,
        level: filterLevel.value,
        scope: filterScope.value,
        keyword: keyword.value || undefined,
        date: selectedDate.value || undefined,
      };

      const result = await logger.getLogs(options);

      entries.value = reset ? result : [...entries.value, ...result];
      // 若返回条数等于 PAGE_SIZE，可能还有更多；否则已到末页
      // 末页判断：结果集恰好是 PAGE_SIZE 整数倍时，会额外触发一次空请求确认，属预期行为
      hasMore.value = result.length === PAGE_SIZE;
      offset.value += result.length;
    } finally {
      isLoading.value = false;
    }
  }

  function setLevel(level: LogLevel | undefined): void {
    filterLevel.value = level;
    loadLogs(true);
  }

  function setScope(scope: 'main' | 'renderer' | 'preload' | undefined): void {
    filterScope.value = scope;
    loadLogs(true);
  }

  function setKeyword(kw: string): void {
    keyword.value = kw;
    loadLogs(true);
  }

  function setDate(date: string): void {
    selectedDate.value = date;
    loadLogs(true);
  }

  async function loadMore(): Promise<void> {
    if (!hasMore.value || isLoading.value) return;
    await loadLogs(false);
  }

  return {
    entries,
    filterLevel,
    filterScope,
    keyword,
    selectedDate,
    isLoading,
    hasMore,
    loadLogs,
    loadMore,
    setLevel,
    setScope,
    setDate,
    setKeyword,
  };
});
```

---

## 数据流

```
写入流程:
  渲染进程 logger.error(msg, tag)
    → 拼接 tag 前缀
    → window.electronAPI.logger.error(formattedMsg)
    → ipcRenderer.invoke('logger:write', { level: 'ERROR', message, scope: 'renderer' })
    → 主进程 ipcMain.handle('logger:write')
    → writeLog({ level, message, scope })
    → formatLogLine() 统一生成时间戳并转义换行
    → getCurrentLogFilePath() 确定写入文件（自动处理滚动）
    → fs.appendFileSync(filePath, line)

preload 写入流程:
  preloadLogger.warn(msg)
    → ipcRenderer.invoke('logger:write', { level: 'WARN', message, scope: 'preload' })
    → 主进程 writeLog()
    → 日志文件新增一条 scope = preload 的记录

读取流程:
  /settings/logger 页面 mounted
    → logViewerStore.loadLogs(true)
    → logger.getLogs({ level, scope, keyword, date, limit, offset })
    → ipcRenderer.invoke('logger:getLogs', options)
    → 主进程 readLogs(options)
    → 按 base → .1 → .2 的正序读取当日日志文件（全量读取，见性能边界章节）
    → 逐行 parseLogLine 解析
    → 内存中应用 level / scope / keyword 过滤
    → [...results].reverse() 得到最新优先序列
    → slice(offset, offset + limit) 分页
    → 返回 LogEntry[]（最新 → 最旧）
    → entries.value 更新；loadMore 继续追加更旧日志 → UI 渲染
```

---

## 错误处理

| 场景 | 策略 |
|------|------|
| 日志目录不存在 | 首次写入前自动创建（`mkdirSync({ recursive: true })`） |
| 日志文件写入失败（磁盘满/权限） | 静默失败，避免日志系统自身抛错导致应用崩溃 |
| IPC 通信失败（Electron API 不可用） | 渲染进程 logger 返回 noop 空实现，纯前端开发模式正常工作 |
| IPC 日志调用失败 | `writeScopedLog` 内部静默捕获 rejection，避免未处理异常污染控制台 |
| 日志消息包含换行 | 写入前转义为 `\n`，读取后还原，保证单行格式不被破坏 |
| 日志文件读取失败 | 跳过该文件，继续处理其余文件 |
| 日志行解析失败（格式不匹配） | `parseLogLine` 返回 `null` 后被 filter 过滤，不影响其他行 |
| 旧日志清理时删除失败 | catch 静默处理 |
| 搜索无结果 | 返回空数组，UI 展示空状态提示 |
| 末页额外空请求 | `hasMore` 置为 `false`，UI 展示"已加载全部"，属预期行为 |
| 定时器退出未清理 | `before-quit` 时 `clearInterval`，避免退出阶段触发无效回调 |

---

## 测试要点

### 主进程日志核心

1. `formatLogLine` 正确生成 `[时间戳] [级别] [来源] 消息` 格式
2. `writeLog` 自动创建日志目录，时间戳在主进程统一生成
3. 文件超 10MB 时自动滚动到编号后缀文件
4. `readLogs` 按正序组装文件后执行一次 reverse，返回"最新优先"序列
5. `readLogs` 的 offset 语义为过滤后结果集偏移量，不是文件行号
6. `readLogs` 支持 level / scope / keyword 三种过滤条件
7. `cleanOldLogs` 正确删除超过 30 天的日志文件
8. `startLogMaintenanceTimer` 返回句柄，可被 `clearInterval` 清理
9. 跨天不重启场景：定时器每小时检查，触发当天首次清理
10. `getLogFiles` 返回按名称倒序的文件列表
11. 消息包含换行时，写入前转义、读取后还原

### 渲染进程 Logger API

1. `logger.error('test')` 正确调用 `electronAPI.logger.error`
2. 非 Electron 环境下不抛错（noop 实现）
3. `logger.error('msg', 'tag')` 正确拼接为 `[tag] msg`
4. preload 内部日志的 scope 为 `preload`，不被标记为 `renderer`
5. IPC 写日志失败时无未处理的 Promise rejection

### 设置页日志查看

1. 页面挂载时加载日志，按"最新优先"渲染
2. 设置侧边栏出现"日志查看"入口，点击正确跳转
3. 级别筛选只显示对应级别日志，切换后自动重置
4. 进程来源筛选只显示对应 scope 的日志
5. 关键字搜索只显示匹配消息的日志
6. 滚动到底部触发 `loadMore`，在列表底部追加更旧日志
7. 末页额外空请求后显示"已加载全部"，不持续 loading
8. 无日志时显示空状态提示

### 集成测试

1. 渲染进程 `logger.error()` → 主进程日志文件新增一行，scope 为 `renderer`
2. preload 调用日志 → 主进程日志文件新增一行，scope 为 `preload`
3. 应用启动时自动清理过期日志文件
4. `/settings/logger` 页面正常展示三个进程写入的日志
5. 渲染进程写入的日志可被主进程正确解析，无时间戳格式不匹配
6. 应用退出时定时器被正确清理，无异常回调
