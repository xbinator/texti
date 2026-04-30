# Query Logs Tool 设计文档

## 概述

为 Tibis 的内置 AI 工具链新增一个“结构化查询运行日志”能力，允许模型通过受限参数读取应用运行日志，而不是直接访问日志文件。该工具面向错误排查、当天异常分析和关键字定位等只读场景，复用现有 `logger.getLogs(...)` 查询链路，避免重复实现日志解析逻辑。

---

## 目标

- 让 AI 可以按 `level`、`scope`、`keyword`、`date`、`limit`、`offset` 查询运行日志。
- 返回 JSON 可序列化的结构化结果，便于模型继续分析。
- 与当前编辑器上下文解耦，作为全局只读工具使用。
- 保持返回量可控，避免一次性把过多日志灌给模型。

---

## 非目标

- 不直接暴露日志文件路径、日志文件列表和原始文件读取能力。
- 不新增日志写入、删除、清理等修改型工具。
- 不在第一版里做日志摘要、聚类或自动根因分析。

---

## 用户场景

- “查今天 renderer 的 ERROR 日志”
- “找包含 provider 的日志”
- “帮我看今天最近 20 条 main 进程日志”
- “查 2026-04-30 这天 preload 的 WARN”

---

## 架构决策

### 工具类型

该工具属于内置只读工具：

- `riskLevel: 'read'`
- `permissionCategory: 'system'`
- `requiresActiveDocument: false`

它不依赖当前活动文档，也不修改任何应用状态。

### 查询来源

工具执行阶段直接调用渲染侧日志单例：

- `src/shared/logger/index.ts`

底层已经通过：

- `window.electronAPI.logger.getLogs(...)`
- `ipcMain.handle('logger:getLogs', ...)`

打通到主进程日志读取逻辑，因此 AI tool 只需要做参数校验、结果裁剪和结果封装。

### 返回结构

不直接返回裸数组，而是返回带元信息的对象：

```ts
interface QueryLogsResult {
  items: LogEntry[];
  returnedCount: number;
  appliedFilters: {
    level?: LogLevel;
    scope?: LogScope;
    keyword?: string;
    date?: string;
    limit: number;
    offset: number;
    usedDefaultDate: boolean;
  };
}
```

设计原因：

- `items` 供模型读取日志正文。
- `returnedCount` 明确表达“当前页实际返回条数”，不冒充“筛选后的总命中数”。
- `appliedFilters` 让模型明确当前使用的筛选条件。

不返回 `total`、`count`（总命中语义）或 `truncated`，因为现有 `logger.getLogs()` 只返回分页后的切片结果，无法可靠判断筛选后的总条数，也无法准确告知是否还有更多数据。

---

## 参数设计

### 工具名

- `query_logs`

### 输入参数

```ts
interface QueryLogsInput {
  level?: 'ERROR' | 'WARN' | 'INFO';
  scope?: 'main' | 'renderer' | 'preload';
  keyword?: string;
  date?: string;
  limit?: number;
  offset?: number;
}
```

### 参数规则

- `date` 使用现有日志系统的 `YYYY-MM-DD` 语义。
- 未传 `date` 时，沿用现有日志系统语义，只查询“当天日志”，不会跨天自动扩展。
- `limit` 默认 `50`。
- `offset` 默认 `0`。
- `limit` 先按整数向下取整，再限制到 `1..100`；未传、非有限数或小于 `1` 时回退到默认值 `50`。
- `offset` 先按整数向下取整；未传、非有限数或小于 `0` 时归一化为 `0`。
- 空字符串关键字按未传处理。

---

## 工具描述文案

工具描述要写给模型看，建议语义为：

“查询应用运行日志，可按级别、进程来源、关键字、日期和分页参数筛选。适合排查当天错误、查找异常上下文和定位指定关键字日志。未传日期时默认查询当天日志，不会修改任何数据。”

这样模型更容易在“报错分析”“最近失败原因”“定位某类问题”时主动调用，而不会误把它当成文件读取工具。

---

## 文件变更范围

- 新增：`src/ai/tools/builtin/logs.ts`
- 修改：`src/ai/tools/builtin/index.ts`
- 修改：`src/ai/tools/builtin/catalog.ts`
- 新增：`test/ai/tools/builtin-logs.test.ts`
- 修改：`changelog/2026-04-30.md`

---

## 测试策略

### 单元测试覆盖点

- 工具定义正确：名称、风险等级、`requiresActiveDocument`、参数 schema。
- 默认参数生效：未传 `limit`/`offset` 时使用默认值。
- `limit` 超过上限、非正数、非整数或非有限数时会按规则归一化。
- `offset` 为负数、非整数或非有限数时会按规则归一化。
- 空关键字被归一化。
- 调用 `logger.getLogs(...)` 时传递了正确参数。
- 返回结构包含 `items`、`returnedCount`、`appliedFilters`。
- 日志 API 抛错时返回统一失败结果。
- Electron 日志能力不存在时返回失败结果，而不是伪装成空结果。

### 不在第一版测试的内容

- 主进程日志解析逻辑本身不重复测试，复用现有 logger 模块测试覆盖。

---

## 风险与边界

### 返回量控制

若直接透传现有默认 `500` 条日志，模型上下文会被迅速挤满。第一版必须在工具层施加更小的默认值和硬上限。

### 日期默认行为

现有 `logger.getLogs()` 在不传日期时默认查当天。工具应沿用该语义，而不是自行改成“最近所有日期”，避免和现有日志系统口径不一致。

### 元信息边界

现有 `logger:getLogs` IPC 和 `readLogs()` 仅返回 `slice(offset, offset + limit)` 后的分页数据，不提供总命中数、剩余页数或 `hasMore`。因此工具第一版只返回“当前页实际返回条数”，不对“是否还有更多结果”做猜测。

### 平台能力边界

渲染侧 `logger.getLogs()` 在 `window.electronAPI?.logger` 不存在时会静默返回空数组。AI 工具不能直接沿用这个降级语义，否则模型会把“能力不可用”误读成“没有日志”。因此工具执行前需要显式检测 logger 能力是否存在，不存在时返回失败结果，例如 `EXECUTION_FAILED` + `Logger API is unavailable in the current environment`。

### 安全边界

该工具只能查询已经由应用日志系统结构化暴露出来的内容，不扩展到任意文件系统读取。这样 AI 无法借此工具间接读取日志目录中的任意文件。

---

## 结论

第一版采用“结构化查询运行日志”的最小方案最合适：

- 复用现有 `logger.getLogs(...)`
- 新增一个全局只读工具 `query_logs`
- 对返回量做严格限制
- 返回结构化分页结果而非原始文件文本

这条路径改动面最小，和现有工具系统设计也最一致。
