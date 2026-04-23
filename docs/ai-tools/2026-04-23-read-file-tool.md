# read_file 工作区文件读取工具

日期：2026-04-23

本文档记录 `read_file` 内置工具的设计、调用链路、安全边界和验证方式。该工具用于让 AI 读取白名单文本文件，并支持按行分段读取。工具优先使用工作区根目录做边界限制；没有工作区根目录时，绝对路径读取必须经过用户单次确认。

## 背景

现有只读工具主要围绕当前编辑器文档：

- `read_current_document` 读取当前编辑器内容。
- `search_current_document` 在当前文档内搜索。
- `get_current_time` 读取环境时间。
- `ask_user_choice` 向用户发起选择问题。

这些工具不能读取其他本地文件。`read_file` 补充了“在安全边界内读取指定文件”的能力，但不提供目录遍历、文件搜索或批量读取，避免一次性扩大权限面。

## 工具契约

工具名称：`read_file`

风险等级：`read`

权限类别：`system`

是否依赖当前文档：`requiresActiveDocument: false`

输入参数：

```ts
export interface ReadFileInput {
  /** 文件路径，支持相对工作区路径或绝对路径 */
  path: string;
  /** 起始行号，默认 1 */
  offset?: number;
  /** 读取行数，不传时读取到文件末尾 */
  limit?: number;
}
```

输出结果：

```ts
export interface ReadFileResult {
  /** 规范化后的真实文件路径 */
  path: string;
  /** 截取后的文本内容 */
  content: string;
  /** 文件总行数 */
  totalLines: number;
  /** 实际读取行数 */
  readLines: number;
  /** 是否还有后续内容 */
  hasMore: boolean;
  /** 下一次滚动读取的起始行号，没有后续内容时为 null */
  nextOffset: number | null;
}
```

## 工作区根目录

`read_file` 不从当前文档路径推断工作区根目录。工具创建时通过 `createBuiltinTools` 的 `getWorkspaceRoot?: () => string | null` 获取根目录。

如果没有配置工作区根目录：

- 相对路径读取会失败，因为无法确定相对路径基准。
- 绝对路径读取会先发起用户确认；用户同意后才继续读取。
- 没有确认适配器时，绝对路径读取也会失败，避免静默读取任意本地文件。

配置了工作区根目录时，相对路径统一按 `workspaceRoot` 解析；绝对路径允许作为输入，但必须落在 `workspaceRoot` 内。

## 安全边界

安全校验放在 Electron main 进程的 `electron/main/modules/file/workspace-read.mts`，避免只依赖 renderer 层校验。

主要策略：

- 使用 `fs.realpath` 获取工作区和目标文件真实路径，降低符号链接绕过风险。
- 使用 `path.relative(realRoot, realPath)` 判断目标文件是否位于工作区内，避免字符串 `startsWith` 前缀绕过。
- 未配置工作区根目录时，只允许绝对路径，并且必须先通过用户确认卡片授权。
- 禁止读取 `.env`、`.git`、`node_modules`、`dist`、`dist-electron`、密钥、证书、锁文件和数据库文件。
- 只允许读取常见文本代码和配置扩展名，例如 `.ts`、`.js`、`.vue`、`.json`、`.md`、`.css`、`.yaml`、`.toml`、`.txt` 等。
- 不限制文件大小和单次读取行数。
- 支持通过 `offset + limit` 滚动读取；返回 `hasMore` 和 `nextOffset`，调用方可用 `offset=nextOffset` 继续读取后续内容。
- 如果不传 `limit`，从 `offset` 读取到文件末尾。

## 调用链路

```text
AI 调用 read_file
  -> src/ai/tools/builtin/read-file.ts 校验参数
  -> 若无工作区根目录且输入绝对路径，则请求用户确认
  -> native.readWorkspaceFile()
  -> Electron preload 调用 fs:readWorkspaceTextFile
  -> electron/main/modules/file/workspace-read.mts 执行安全校验和读取
  -> 返回 path/content/totalLines/readLines
```

Web 环境不支持按路径读取文件，`WebNative.readWorkspaceFile` 会抛出 `UNSUPPORTED_PROVIDER`，工具层映射为同名工具错误码。

## 错误映射

main 侧业务错误码会在工具层映射到现有工具错误码：

- `PATH_OUTSIDE_WORKSPACE` -> `PERMISSION_DENIED`
- `PATH_BLACKLISTED` -> `PERMISSION_DENIED`
- `EXTENSION_NOT_ALLOWED` -> `PERMISSION_DENIED`
- `FILE_TOO_LARGE` -> `PERMISSION_DENIED`
- `INVALID_INPUT` -> `INVALID_INPUT`
- `UNSUPPORTED_PROVIDER` -> `UNSUPPORTED_PROVIDER`
- `FILE_NOT_FOUND` -> `EXECUTION_FAILED`

工具层补充错误：

- 无工作区根目录且输入相对路径 -> `PERMISSION_DENIED`
- 无工作区根目录且缺少确认适配器 -> `PERMISSION_DENIED`
- 用户拒绝绝对路径读取确认 -> `USER_CANCELLED`

## 涉及文件

- `electron/main/modules/file/workspace-read.mts`
- `electron/main/modules/file/ipc.mts`
- `electron/preload/index.mts`
- `src/shared/platform/native/types.ts`
- `src/shared/platform/native/electron.ts`
- `src/shared/platform/native/web.ts`
- `src/ai/tools/builtin/read-file.ts`
- `src/ai/tools/builtin/catalog.ts`
- `src/ai/tools/builtin/index.ts`
- `types/electron-api.d.ts`

## 测试与验证

新增和更新的测试覆盖：

- `test/electron/file/workspace-read.test.ts`
- `test/ai/tools/builtin-read-file.test.ts`
- `test/ai/tools/builtin-index.test.ts`
- `test/ai/tools/builtin-catalog.test.ts`

已运行验证：

```bash
pnpm exec vitest run test/electron/file/workspace-read.test.ts test/ai/tools/builtin-read-file.test.ts test/ai/tools/builtin-index.test.ts test/ai/tools/builtin-catalog.test.ts
pnpm build
pnpm run electron:build-main
```

补充说明：`pnpm exec vue-tsc --noEmit` 当前被既有测试 `test/components/BChat/message.test.ts` 中未导出的 `expandFileReferencesForModel` 阻塞，与 `read_file` 改动无关。
