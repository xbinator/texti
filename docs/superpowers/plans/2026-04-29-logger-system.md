# 日志收集系统 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Tibis 构建集中式应用运行日志收集系统：主进程统一接收全量日志（main/renderer/preload），按天写入滚动日志文件，并在设置页提供内置日志查看器。

**Architecture:** 集中式日志管道——渲染进程和 preload 通过 IPC 将日志发送到主进程，主进程作为唯一写入点统一生成时间戳、转义换行、格式化后同步落盘。读取时主进程全量解析文件并在内存中过滤分页后返回。日志查看器作为 `/settings/logger` 路由挂载在设置页内。

**Tech Stack:** Node.js `fs` 同步 I/O、Electron `ipcMain.handle` / `ipcRenderer.invoke`、Vue 3 + Pinia + Ant Design Vue、Vitest

**关键约定：**
- Electron 目录使用 `.mts` 扩展名（`electron/main/modules/logger/` 下现有文件为 `ipc.mts` 和 `service.mts`）
- 前端 `src/` 目录使用 `.ts` 扩展名
- 类型声明集中在 `types/electron-api.d.ts`（不是 `src/shared/platform/types.ts`）
- 现有 logger 模块已是控制台日志（electron-log），新代码自然融入现有文件，不替换原有功能
- B 开头的组件通过 `unplugin-vue-components` 全局自动注册，无需手动 import
- 所有代码必须有注释，禁止 `any` 类型

---

### Task 1: 新增主进程日志类型定义

**Files:**
- Create: `electron/main/modules/logger/types.mts`

- [ ] **Step 1: 创建类型定义文件**

```typescript
/**
 * @file types.mts
 * @description 日志收集系统的类型定义，供主进程 logger-core 和 IPC 模块共用。
 */

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

- [ ] **Step 2: 运行 TypeScript 类型检查确认无编译错误**

Run: `pnpm run electron:build-main`
Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add electron/main/modules/logger/types.mts
git commit -m "feat(logger): add file logging type definitions"
```

---

### Task 2: 新增日志核心功能到 service.mts

**Files:**
- Modify: `electron/main/modules/logger/service.mts` — 在现有代码之后追加文件日志功能

**现有 service.mts 保留完全不动**，在文件末尾追加以下代码。

- [ ] **Step 1: 在 service.mts 末尾追加文件日志核心功能**

```typescript
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
```

- [ ] **Step 2: 运行 TypeScript 编译检查**

Run: `pnpm run electron:build-main`
Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add electron/main/modules/logger/service.mts
git commit -m "feat(logger): add file-based logging core to service.mts"
```

---

### Task 3: 新增文件日志 IPC handler 到 ipc.mts

**Files:**
- Modify: `electron/main/modules/logger/ipc.mts` — 在现有 `registerLoggerHandlers` 之后追加

**现有 ipc.mts 保留完全不动**，在文件末尾追加以下代码。

- [ ] **Step 1: 在 ipc.mts 末尾追加文件日志 IPC handler**

```typescript
// ============================================================
// 文件日志收集系统 IPC handler（与上方控制台日志并存，使用不同 channel）
// ============================================================

import { shell } from 'electron';
import { type LogEntryInput, type LogQueryOptions } from './types.mjs';
import { getLogDir, writeLog, readLogs, getLogFiles } from './service.mjs';

/**
 * 注册文件日志相关的 IPC handler
 */
export function registerLogFileHandlers(): void {
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

- [ ] **Step 2: 在 modules/index.mts 中注册新的 IPC handler**

`electron/main/modules/index.mts`：在 import 区域添加：

```typescript
import { registerLogFileHandlers } from './logger/ipc.mjs';
```

在 `registerAllIpcHandlers` 函数体中（任意位置）添加调用：

```typescript
registerLogFileHandlers();
```

同时更新 export 列表，在 `registerWebviewHandlers` 之后添加：

```typescript
export { registerLogFileHandlers };
```

- [ ] **Step 3: 运行 TypeScript 编译检查**

Run: `pnpm run electron:build-main`
Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add electron/main/modules/logger/ipc.mts electron/main/modules/index.mts
git commit -m "feat(logger): add file logging IPC handlers"
```

---

### Task 4: 更新类型声明 types/electron-api.d.ts

**Files:**
- Modify: `types/electron-api.d.ts` — 替换现有 logger 类型声明

- [ ] **Step 1: 替换 logger 字段的类型声明**

在 `types/electron-api.d.ts` 中，找到现有 `logger` 字段：

```typescript
  // Logger
  logger: {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
```

替换为：

```typescript
  // Logger — 文件日志收集
  logger: {
    /** 写入 ERROR 级别日志文件 */
    error: (message: string) => Promise<void>;
    /** 写入 WARN 级别日志文件 */
    warn: (message: string) => Promise<void>;
    /** 写入 INFO 级别日志文件 */
    info: (message: string) => Promise<void>;
    /** 读取日志文件内容 */
    getLogs: (options: {
      level?: 'ERROR' | 'WARN' | 'INFO';
      scope?: 'main' | 'renderer' | 'preload';
      keyword?: string;
      date?: string;
      limit?: number;
      offset?: number;
    }) => Promise<{
      level: 'ERROR' | 'WARN' | 'INFO';
      message: string;
      scope: 'main' | 'renderer' | 'preload';
      timestamp: string;
    }[]>;
    /** 获取日志文件列表 */
    getLogFiles: () => Promise<{
      name: string;
      size: number;
      createdAt: string;
    }[]>;
    /** 在系统文件管理器中打开日志文件夹 */
    openLogFolder: () => Promise<void>;
  };
```

- [ ] **Step 2: 运行 TypeScript 编译检查**

Run: `pnpm run electron:build-main`
Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add types/electron-api.d.ts
git commit -m "feat(logger): update ElectronAPI logger type declarations"
```

---

### Task 5: 更新 preload 桥接

**Files:**
- Modify: `electron/preload/index.mts` — 在现有 logger 暴露之后追加文件日志 API

- [ ] **Step 1: 在 preload/index.mts 中追加文件日志 API**

在现有 `electronAPI` 对象中，将 `logger` 字段从仅控制台日志扩展为包含文件日志 API。

需要将现有的 `logger` 区块（约在文件底部）：

```typescript
  // ==================== 日志操作 ====================
  logger: {
    debug: (...args) => ipcRenderer.send('logger:debug', ...args),
    info: (...args) => ipcRenderer.send('logger:info', ...args),
    warn: (...args) => ipcRenderer.send('logger:warn', ...args),
    error: (...args) => ipcRenderer.send('logger:error', ...args)
  },
```

替换为：

```typescript
  // ==================== 日志操作 ====================
  // 控制台日志（保留原有实现，不删除）
  consoleLogger: {
    debug: (...args) => ipcRenderer.send('logger:debug', ...args),
    info: (...args) => ipcRenderer.send('logger:info', ...args),
    warn: (...args) => ipcRenderer.send('logger:warn', ...args),
    error: (...args) => ipcRenderer.send('logger:error', ...args)
  },

  // 文件日志收集（新增）
  logger: {
    error: (message: string) => writeScopedLog('renderer', 'ERROR', message),
    warn: (message: string) => writeScopedLog('renderer', 'WARN', message),
    info: (message: string) => writeScopedLog('renderer', 'INFO', message),

    getLogs: (options: Parameters<ElectronAPI['logger']['getLogs']>[0]) =>
      ipcRenderer.invoke('logger:getLogs', options),

    getLogFiles: () => ipcRenderer.invoke('logger:getFiles'),

    openLogFolder: () => ipcRenderer.invoke('logger:openFolder'),
  },
```

- [ ] **Step 2: 在 preload 顶部添加 writeScopedLog 辅助函数**

在文件顶部 import 区域之后、`const electronAPI` 之前添加：

```typescript
/**
 * 发送带来源标识的日志到主进程
 * IPC 失败时静默处理，与主进程写入失败策略保持一致
 * @param scope - 进程来源标识
 * @param level - 日志级别
 * @param message - 日志消息
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

/** preload 自身内部日志 API，scope 固定为 preload，不暴露到 window */
const preloadLogger = {
  error: (message: string) => writeScopedLog('preload', 'ERROR', message),
  warn: (message: string) => writeScopedLog('preload', 'WARN', message),
  info: (message: string) => writeScopedLog('preload', 'INFO', message),
};
```

在 `contextBridge.exposeInMainWorld` 之后（文件末尾底部）添加：

```typescript
// preload 自身初始化日志，scope 为 preload
preloadLogger.info('preload 已初始化');
```

- [ ] **Step 3: 运行 TypeScript 编译检查**

Run: `pnpm run electron:build-main`
Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add electron/preload/index.mts
git commit -m "feat(logger): add file logging API to preload bridge"
```

---

### Task 6: 在主进程入口添加启动初始化和定时器

**Files:**
- Modify: `electron/main/index.mts`

- [ ] **Step 1: 在 index.mts 中添加导入和初始化代码**

在 `electron/main/index.mts` 中：

在 `import { ... } from './modules/index.mjs'` 的 import 语句中追加导入：

```typescript
import { cleanOldLogs, startLogMaintenanceTimer } from './modules/logger/service.mjs';
```

在 `bootstrap` 函数中，`registerAllIpcHandlers()` 调用之后添加：

```typescript
  // 启动时清理一次过期日志文件
  cleanOldLogs();
  // 启动日志维护定时器，退出前清理避免无效回调
  const maintenanceTimer = startLogMaintenanceTimer();
  app.on('before-quit', () => clearInterval(maintenanceTimer));
```

> **注意**：`maintenanceTimer` 变量需要在 `app.whenReady().then(bootstrap)` 能访问到的作用域。推荐在文件顶层声明 `let maintenanceTimer: NodeJS.Timeout;`，然后在 `bootstrap` 内部赋值。

- [ ] **Step 2: 运行 TypeScript 编译检查**

Run: `pnpm run electron:build-main`
Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add electron/main/index.mts
git commit -m "feat(logger): add startup cleanup and maintenance timer"
```

---

### Task 7: 创建渲染进程日志 API — src/shared/logger/

**Files:**
- Create: `src/shared/logger/types.ts`
- Create: `src/shared/logger/index.ts`

- [ ] **Step 1: 创建前端类型定义**

```typescript
/**
 * @file types.ts
 * @description 前端日志收集系统的类型定义。
 */

/** 日志级别 */
export type LogLevel = 'ERROR' | 'WARN' | 'INFO';

/** 日志条目 */
export interface LogEntry {
  /** 日志级别 */
  level: LogLevel;
  /** 日志消息内容 */
  message: string;
  /** 进程来源标识 */
  scope: 'main' | 'renderer' | 'preload';
  /** 格式化后的时间戳字符串 YYYY-MM-DD HH:mm:ss.SSS */
  timestamp: string;
}

/** 日志查询参数 */
export interface LogQueryOptions {
  /** 筛选日志级别 */
  level?: LogLevel;
  /** 筛选进程来源 */
  scope?: 'main' | 'renderer' | 'preload';
  /** 关键字搜索（匹配 message 字段） */
  keyword?: string;
  /** 查询日期 YYYY-MM-DD */
  date?: string;
  /** 返回条数上限 */
  limit?: number;
  /** 分页偏移量，基于过滤后的结果集 */
  offset?: number;
}

/** 日志文件信息 */
export interface LogFileInfo {
  /** 文件名 */
  name: string;
  /** 文件大小（字节） */
  size: number;
  /** 创建时间 ISO 字符串 */
  createdAt: string;
}
```

- [ ] **Step 2: 创建 Logger 单例**

```typescript
/**
 * @file index.ts
 * @description 渲染进程日志 API 单例，封装文件日志的写入和读取操作。
 */
import type { LogQueryOptions, LogEntry, LogFileInfo } from './types';

/**
 * Electron 日志 API 接口
 */
interface ElectronLoggerApi {
  error: (message: string) => Promise<void>;
  warn: (message: string) => Promise<void>;
  info: (message: string) => Promise<void>;
  getLogs: (options: LogQueryOptions) => Promise<LogEntry[]>;
  getLogFiles: () => Promise<LogFileInfo[]>;
  openLogFolder: () => Promise<void>;
}

/**
 * 创建非 Electron 环境下的空实现
 * 纯前端开发模式下不抛错，日志调用静默忽略
 * @returns 空实现的 ElectronLoggerApi
 */
function createNoopLogger(): ElectronLoggerApi {
  const noop = async (..._args: unknown[]): Promise<void> => { };
  return {
    error: noop,
    warn: noop,
    info: noop,
    getLogs: async () => [],
    getLogFiles: async () => [],
    openLogFolder: noop,
  } as unknown as ElectronLoggerApi;
}

/**
 * 获取 Electron 日志 API
 * 优先使用 window.electronAPI.logger，不可用时返回空实现
 * @returns ElectronLoggerApi 实例
 */
function getLoggerApi(): ElectronLoggerApi {
  if (typeof window !== 'undefined' && window.electronAPI?.logger) {
    return window.electronAPI.logger;
  }
  return createNoopLogger();
}

/**
 * 日志记录器类
 * 封装渲染进程的文件日志写入和读取操作
 */
class Logger {
  private api: ElectronLoggerApi = getLoggerApi();

  /**
   * 写入 ERROR 级别文件日志
   * @param message - 日志消息
   * @param tag - 可选模块标签，拼接为 [tag] message 格式
   */
  error(message: string, tag?: string): void {
    this.api.error(tag ? `[${tag}] ${message}` : message);
  }

  /**
   * 写入 WARN 级别文件日志
   * @param message - 日志消息
   * @param tag - 可选模块标签，拼接为 [tag] message 格式
   */
  warn(message: string, tag?: string): void {
    this.api.warn(tag ? `[${tag}] ${message}` : message);
  }

  /**
   * 写入 INFO 级别文件日志
   * @param message - 日志消息
   * @param tag - 可选模块标签，拼接为 [tag] message 格式
   */
  info(message: string, tag?: string): void {
    this.api.info(tag ? `[${tag}] ${message}` : message);
  }

  /**
   * 读取文件日志
   * @param options - 查询参数
   * @returns 日志条目列表
   */
  async getLogs(options?: LogQueryOptions): Promise<LogEntry[]> {
    return this.api.getLogs(options ?? {});
  }

  /**
   * 获取日志文件列表
   * @returns 日志文件信息列表
   */
  async getLogFiles(): Promise<LogFileInfo[]> {
    return this.api.getLogFiles();
  }

  /**
   * 在系统文件管理器中打开日志文件夹
   */
  openLogFolder(): void {
    this.api.openLogFolder();
  }
}

/** 全局日志单例 */
export const logger = new Logger();
```

- [ ] **Step 3: 运行 TypeScript 检查 + ESLint**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/shared/logger/
git commit -m "feat(logger): add renderer-side logger singleton"
```

---

### Task 8: 创建日志查看器 Pinia Store

**Files:**
- Create: `src/views/settings/logger/stores/logViewer.ts`

- [ ] **Step 1: 创建 logViewer Store**

```typescript
/**
 * @file logViewer.ts
 * @description 日志查看页面 Pinia Store，管理筛选、分页和日志条目状态。
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { logger } from '@/shared/logger';
import type { LogEntry, LogQueryOptions, LogLevel } from '@/shared/logger/types';

/**
 * 日志查看器全局状态
 * 筛选、分页、加载状态统一收敛到此 Store
 */
export const useLogViewerStore = defineStore('logViewer', () => {
  /** 当前日志条目列表（时间倒序：最新在上） */
  const entries = ref<LogEntry[]>([]);
  /** 当前日志级别筛选 */
  const filterLevel = ref<LogLevel | undefined>(undefined);
  /** 当前进程来源筛选 */
  const filterScope = ref<'main' | 'renderer' | 'preload' | undefined>(undefined);
  /** 搜索关键字 */
  const keyword = ref('');
  /** 选中的查询日期（空字符串表示当天） */
  const selectedDate = ref('');
  /** 是否正在加载 */
  const isLoading = ref(false);
  /** 偏移量基于过滤后的结果集，不是文件原始行号 */
  const offset = ref(0);
  /** 是否还有更多日志可加载 */
  const hasMore = ref(true);

  /** 每页加载条数 */
  const PAGE_SIZE = 100;

  /**
   * 加载日志
   * @param reset - 是否重置已有数据（用于筛选条件变更时的重新加载）
   */
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

  /**
   * 设置级别筛选并重新加载
   * @param level - 日志级别，undefined 表示显示全部
   */
  function setLevel(level: LogLevel | undefined): void {
    filterLevel.value = level;
    loadLogs(true);
  }

  /**
   * 设置进程来源筛选并重新加载
   * @param scope - 进程来源，undefined 表示显示全部
   */
  function setScope(scope: 'main' | 'renderer' | 'preload' | undefined): void {
    filterScope.value = scope;
    loadLogs(true);
  }

  /**
   * 设置搜索关键字并重新加载
   * @param kw - 搜索关键字
   */
  function setKeyword(kw: string): void {
    keyword.value = kw;
    loadLogs(true);
  }

  /**
   * 设置查询日期并重新加载
   * @param date - 日期字符串 YYYY-MM-DD
   */
  function setDate(date: string): void {
    selectedDate.value = date;
    loadLogs(true);
  }

  /**
   * 加载更多日志（追加到列表底部）
   */
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

- [ ] **Step 2: Commit**

```bash
git add src/views/settings/logger/stores/logViewer.ts
git commit -m "feat(logger): add log viewer Pinia store"
```

---

### Task 9: 创建日志条目组件

**Files:**
- Create: `src/views/settings/logger/components/LogEntry.vue`

- [ ] **Step 1: 创建 LogEntry.vue**

```vue
<!--
  @file LogEntry.vue
  @description 单条日志条目渲染组件，按级别着色，支持 hover 复制。
-->
<template>
  <div
    class="log-entry"
    :class="{
      'log-entry--error': entry.level === 'ERROR',
      'log-entry--warn': entry.level === 'WARN',
      'log-entry--info': entry.level === 'INFO',
    }"
    @click="copyMessage"
  >
    <div class="log-entry__meta">
      <span class="log-entry__timestamp">{{ entry.timestamp }}</span>
      <span class="log-entry__level">{{ entry.level }}</span>
      <span class="log-entry__scope">{{ entry.scope }}</span>
    </div>
    <div class="log-entry__message">{{ entry.message }}</div>
    <button
      v-if="showCopyBtn"
      class="log-entry__copy-btn"
      @click.stop="copyMessage"
    >
      <Icon icon="lucide:copy" width="12" height="12" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Icon } from '@iconify/vue';
import type { LogEntry } from '@/shared/logger/types';

/**
 * 组件 props 定义
 */
defineProps<{
  /** 日志条目数据 */
  entry: LogEntry;
}>();

/** 是否显示复制按钮（hover 时显示） */
const showCopyBtn = ref(false);

/**
 * 复制日志消息到剪贴板
 */
async function copyMessage(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.entry.message);
  } catch {
    // 剪贴板不可用时静默处理
  }
}
</script>

<script lang="ts">
/**
 * 使用普通 script 块声明 props 默认值（Vue 3.3+ defineProps 编译器宏限制）
 */
const props = withDefaults(defineProps<{
  entry: LogEntry;
}>(), {});
</script>

<style scoped lang="less">
.log-entry {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 4px 8px;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px;
  line-height: 1.5;
  border-bottom: 1px solid var(--border-light);
  cursor: pointer;
  transition: background 0.1s;

  &:hover {
    background: var(--bg-hover);
  }

  &--error {
    .log-entry__level {
      color: var(--color-error, #ff4d4f);
    }
  }

  &--warn {
    .log-entry__level {
      color: var(--color-warning, #faad14);
    }
  }

  &--info {
    .log-entry__level {
      color: var(--text-secondary);
    }
  }
}

.log-entry__meta {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.log-entry__timestamp {
  color: var(--text-tertiary);
  white-space: nowrap;
}

.log-entry__level {
  font-weight: 600;
  min-width: 48px;
}

.log-entry__scope {
  color: var(--text-tertiary);
  min-width: 64px;
}

.log-entry__message {
  flex: 1;
  word-break: break-all;
  white-space: pre-wrap;
  color: var(--text-primary);
}

.log-entry__copy-btn {
  flex-shrink: 0;
  padding: 2px;
  color: var(--text-tertiary);
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.1s;

  &:hover {
    opacity: 1;
    color: var(--text-primary);
  }
}
</style>
```

> **注意**：上述代码中 `withDefaults` 在 `<script>` 普通块使用不当。Vue SFC 中 `defineProps` 和 `withDefaults` 只能在 `<script setup>` 中使用。需要调整代码结构。下面是修正后的版本：

```vue
<!--
  @file LogEntry.vue
  @description 单条日志条目渲染组件，按级别着色，支持 hover 复制。
-->
<template>
  <div
    class="log-entry"
    :class="{
      'log-entry--error': entry.level === 'ERROR',
      'log-entry--warn': entry.level === 'WARN',
      'log-entry--info': entry.level === 'INFO',
    }"
    @click="copyMessage"
  >
    <div class="log-entry__meta">
      <span class="log-entry__timestamp">{{ entry.timestamp }}</span>
      <span class="log-entry__level">{{ entry.level }}</span>
      <span class="log-entry__scope">{{ entry.scope }}</span>
    </div>
    <div class="log-entry__message">{{ entry.message }}</div>
    <button
      v-if="showCopyBtn"
      class="log-entry__copy-btn"
      @click.stop="copyMessage"
    >
      <Icon icon="lucide:copy" width="12" height="12" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Icon } from '@iconify/vue';
import type { LogEntry } from '@/shared/logger/types';

/**
 * 组件 props 定义
 */
const props = defineProps<{
  /** 日志条目数据 */
  entry: LogEntry;
}>();

/** 是否显示复制按钮（hover 时显示） */
const showCopyBtn = ref(false);

/**
 * 复制日志消息到剪贴板
 */
async function copyMessage(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.entry.message);
  } catch {
    // 剪贴板不可用时静默处理
  }
}
</script>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/settings/logger/components/LogEntry.vue
git commit -m "feat(logger): add LogEntry component"
```

---

### Task 10: 创建日志过滤工具栏组件

**Files:**
- Create: `src/views/settings/logger/components/LogFilterBar.vue`

- [ ] **Step 1: 创建 LogFilterBar.vue**

```vue
<!--
  @file LogFilterBar.vue
  @description 日志过滤工具栏，提供级别筛选、来源筛选、搜索和打开文件夹功能。
  交互直接调用 Pinia Store，不通过父组件中转。
-->
<template>
  <div class="log-filter-bar">
    <div class="log-filter-bar__left">
      <a-radio-group
        :model-value="store.filterLevel"
        size="small"
        @change="(e: RadioChangeEvent) => store.setLevel(e.target.value)"
      >
        <a-radio-button value="">
          全部
        </a-radio-button>
        <a-radio-button value="ERROR">
          ERROR
        </a-radio-button>
        <a-radio-button value="WARN">
          WARN
        </a-radio-button>
        <a-radio-button value="INFO">
          INFO
        </a-radio-button>
      </a-radio-group>

      <a-select
        :model-value="store.filterScope"
        size="small"
        placeholder="来源筛选"
        allow-clear
        style="width: 120px"
        @change="(value: string) => store.setScope(value as 'main' | 'renderer' | 'preload' | undefined)"
      >
        <a-select-option value="">
          全部来源
        </a-select-option>
        <a-select-option value="main">
          main
        </a-select-option>
        <a-select-option value="renderer">
          renderer
        </a-select-option>
        <a-select-option value="preload">
          preload
        </a-select-option>
      </a-select>

      <a-input-search
        :model-value="store.keyword"
        size="small"
        placeholder="搜索日志内容..."
        allow-clear
        style="width: 220px"
        @search="(value: string) => store.setKeyword(value)"
        @change="(e: InputEvent) => { if (!(e.target as HTMLInputElement).value) store.setKeyword(''); }"
      />

      <a-date-picker
        :model-value="store.selectedDate ? dayjs(store.selectedDate) : undefined"
        size="small"
        placeholder="选择日期"
        style="width: 140px"
        @change="(_: unknown, dateStr: string | string[]) => store.setDate(Array.isArray(dateStr) ? dateStr[0] || '' : dateStr || '')"
      />
    </div>

    <div class="log-filter-bar__right">
      <span class="log-filter-bar__count">
        {{ store.entries.length }} 条
      </span>
      <a-button
        size="small"
        @click="store.loadLogs(true)"
      >
        <Icon icon="lucide:refresh-cw" width="14" height="14" />
        刷新
      </a-button>
      <a-button
        size="small"
        @click="logger.openLogFolder()"
      >
        <Icon icon="lucide:folder-open" width="14" height="14" />
        文件夹
      </a-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';
import dayjs from 'dayjs';
import type { RadioChangeEvent } from 'ant-design-vue';
import { logger } from '@/shared/logger';
import { useLogViewerStore } from '../stores/logViewer';

/** 日志查看器全局状态 */
const store = useLogViewerStore();
</script>

<style scoped lang="less">
.log-filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-light);
}

.log-filter-bar__left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.log-filter-bar__right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.log-filter-bar__count {
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/settings/logger/components/LogFilterBar.vue
git commit -m "feat(logger): add LogFilterBar component"
```

---

### Task 11: 创建日志查看器主页面

**Files:**
- Create: `src/views/settings/logger/index.vue`

- [ ] **Step 1: 创建 index.vue**

```vue
<!--
  @file index.vue
  @description 日志查看器主页面，组合过滤工具栏和日志列表。
  首次加载在 onMounted 中触发初始日志拉取。
-->
<template>
  <div class="logger-view">
    <LogFilterBar />
    <div class="logger-view__list" @scroll="handleScroll">
      <div v-if="store.entries.length === 0 && !store.isLoading" class="logger-view__empty">
        暂无日志
      </div>
      <LogEntry
        v-for="(entry, index) in store.entries"
        :key="`${entry.timestamp}-${index}`"
        :entry="entry"
      />
      <div v-if="store.isLoading" class="logger-view__loading">
        加载中...
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import LogFilterBar from './components/LogFilterBar.vue';
import LogEntry from './components/LogEntry.vue';
import { useLogViewerStore } from './stores/logViewer';

/** 日志查看器全局状态 */
const store = useLogViewerStore();

/**
 * 处理滚动事件，触底时加载更多
 */
function handleScroll(event: Event): void {
  const target = event.target as HTMLElement;
  if (!target) return;

  const { scrollTop, scrollHeight, clientHeight } = target;
  if (scrollHeight - scrollTop - clientHeight < 40) {
    store.loadMore();
  }
}

onMounted(() => {
  store.loadLogs(true);
});
</script>

<style scoped lang="less">
.logger-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.logger-view__list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.logger-view__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  font-size: 14px;
  color: var(--text-tertiary);
}

.logger-view__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/settings/logger/index.vue
git commit -m "feat(logger): add logger viewer main page"
```

---

### Task 12: 更新设置页常量与路由

**Files:**
- Modify: `src/views/settings/constants.ts`
- Modify: `src/router/routes/modules/settings.ts`

- [ ] **Step 1: 在 constants.ts 中添加日志菜单项**

在 `src/views/settings/constants.ts` 中：

将 `SettingsMenuKey` 类型更新为包含 `'logger'`：

```typescript
export type SettingsMenuKey = 'provider' | 'service-model' | 'logger';
```

在 `menuItems` 数组末尾追加：

```typescript
  { key: 'logger', label: '运行日志', icon: 'lucide:file-text', path: '/settings/logger' },
```

- [ ] **Step 2: 在 settings 路由中添加 logger 子路由**

在 `src/router/routes/modules/settings.ts` 中，在 `children` 数组末尾（`service-model` 路由之后）追加：

```typescript
      {
        path: 'logger',
        name: 'logger',
        component: () => import('@/views/settings/logger/index.vue'),
        meta: { title: '运行日志' }
      }
```

- [ ] **Step 3: Commit**

```bash
git add src/views/settings/constants.ts src/router/routes/modules/settings.ts
git commit -m "feat(logger): add logger route and settings menu entry"
```

---

### Task 13: 补充测试用例

**Files:**
- Create: `test/electron/logger-file.test.ts`

- [ ] **Step 1: 创建日志文件核心功能测试**

```typescript
/**
 * @file logger-file.test.ts
 * @description 日志文件收集系统核心功能测试。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LogLevel } from '../../electron/main/modules/logger/types.mjs';

/**
 * 由于 service.mts 依赖 app.getPath('logs')，测试中 mock app
 */
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'logs') return path.join(process.cwd(), 'test/', '.temp-logs');
      return path.join(process.cwd(), 'test/', '.temp');
    }),
    getName: vi.fn(() => 'Tibis'),
  },
}));

/** 测试用的临时日志目录 */
const TEST_LOG_DIR = path.join(process.cwd(), 'test/', '.temp-logs');

describe('logger-file', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_LOG_DIR)) {
      fs.rmSync(TEST_LOG_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_LOG_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_LOG_DIR)) {
      fs.rmSync(TEST_LOG_DIR, { recursive: true });
    }
  });

  it('should write log entry to file', async () => {
    const { writeLog } = await import('../../electron/main/modules/logger/service.mjs');

    writeLog({
      level: LogLevel.INFO,
      message: 'test message',
      scope: 'main',
    });

    const files = fs.readdirSync(TEST_LOG_DIR);
    expect(files.length).toBeGreaterThan(0);
    const content = fs.readFileSync(path.join(TEST_LOG_DIR, files[0]), 'utf-8');
    expect(content).toContain('[INFO]');
    expect(content).toContain('[main]');
    expect(content).toContain('test message');
  });

  it('should serialize newlines in messages', async () => {
    const { writeLog } = await import('../../electron/main/modules/logger/service.mjs');

    writeLog({
      level: LogLevel.ERROR,
      message: 'line1\nline2',
      scope: 'renderer',
    });

    const files = fs.readdirSync(TEST_LOG_DIR);
    const content = fs.readFileSync(path.join(TEST_LOG_DIR, files[0]), 'utf-8');
    expect(content).toContain('line1\\\\nline2');
  });

  it('should read logs with filtering', async () => {
    const { writeLog, readLogs } = await import('../../electron/main/modules/logger/service.mjs');

    writeLog({ level: LogLevel.INFO, message: 'info msg', scope: 'main' });
    writeLog({ level: LogLevel.ERROR, message: 'error msg', scope: 'renderer' });

    const errorLogs = readLogs({ level: LogLevel.ERROR });
    expect(errorLogs.length).toBeGreaterThanOrEqual(1);
    expect(errorLogs[0].level).toBe(LogLevel.ERROR);
    expect(errorLogs[0].message).toBe('error msg');
  });

  it('should return newest-first order', async () => {
    const { writeLog, readLogs } = await import('../../electron/main/modules/logger/service.mjs');

    writeLog({ level: LogLevel.INFO, message: 'first', scope: 'main' });
    writeLog({ level: LogLevel.INFO, message: 'second', scope: 'main' });

    const logs = readLogs();
    // 最新在前：second 在 first 上面
    expect(logs[0].message).toBe('second');
  });

  it('should respect limit and offset', async () => {
    const { writeLog, readLogs } = await import('../../electron/main/modules/logger/service.mjs');

    for (let i = 0; i < 5; i++) {
      writeLog({ level: LogLevel.INFO, message: `msg-${i}`, scope: 'main' });
    }

    const page1 = readLogs({ limit: 2, offset: 0 });
    expect(page1.length).toBe(2);

    const page2 = readLogs({ limit: 2, offset: 2 });
    expect(page2.length).toBe(2);
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `pnpm test`
Expected: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add test/electron/logger-file.test.ts
git commit -m "test(logger): add file logging unit tests"
```

---

## Changelog

文件 `changelog/2026-04-29.md`（新建）：

```markdown
# 2026-04-29

## Added
- 文件日志收集系统：主进程统一接收全量日志并按天写入滚动文件
- 日志查看器：设置页 `/settings/logger` 内置日志查看页面和过滤工具栏
- 日志过滤功能：支持级别、来源、关键字、日期筛选，及分页加载
- 日志文件自动维护：30 天过期清理，1 小时定期检查

## Changed
- 更新 `electron-api.d.ts` 中 logger 类型声明，新增文件日志 API
- 更新 preload 桥接，拆分 consoleLogger 和 logger 两个独立 API
- 预加载脚本添加 preload 自身内部日志记录

## Features
- 日志存储格式：[YYYY-MM-DD HH:mm:ss.SSS] [LEVEL] [SCOPE] message
- 日志文件按 10MB 大小滚动，命名 tibis-YYYY-MM-DD.{n}.log
- 日志查看器支持最新优先排序和触底自动加载更多
- 支持在系统文件管理器中打开日志目录
```

---

## Pre-Merge Checklist

- [ ] `pnpm run electron:build-main` 通过（Electron 主进程编译）
- [ ] `npx tsc --noEmit` 通过（前端 TypeScript 检查）
- [ ] `pnpm test` 通过（所有测试）
- [ ] 手动启动应用，导航到「设置 → 运行日志」确认页面正常显示
- [ ] 确认操作后能在 `~/Library/Logs/Tibis/` 目录下看到 `tibis-*.log` 文件
- [ ] 确认日志文件内容格式正确
- [ ] Changelog 已更新