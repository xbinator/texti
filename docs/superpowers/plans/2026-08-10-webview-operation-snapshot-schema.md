# WebView Operation Snapshot Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 防止 AI 为非导航网页操作遗漏 `snapshotId`，同时保留无快照导航能力。

**Architecture:** 在 Renderer 注册的工具 Schema 中把 `snapshotId` 声明为必填字符串，导航使用空字符串；运行时同时校验 `step`，在页面操作前原子消费快照，并用读写互斥和快照世代号封闭并发竞态。主框架非原地导航立即进入 loading 并使快照失效，历史投影继续保留最新读取结果。

**Tech Stack:** Vue 3、TypeScript、Vitest、AI SDK JSON Schema

## Global Constraints

- 禁止使用 `any`。
- 所有新增函数必须有 JSDoc、明确参数类型和返回类型。
- 异步错误继续通过现有 `asyncTo` 处理。
- 不修改页面内动作脚本和元素指纹算法。
- 文档只使用仓库相对路径。

---

### Task 1: 锁定工具契约回归

**Files:**
- Modify: `test/views/webview/use-chat-context.test.ts`
- Modify: `test/views/webview/chat-tool-input.test.ts`

**Interfaces:**
- Consumes: `useChatContext(options)`、`normalizeWebpageInput(value)`
- Produces: 非导航动作的必填快照 Schema 断言和精确错误回归用例

- [x] **Step 1: 编写失败测试**

在工具注册测试中断言：

```typescript
expect(operateTool.definition.parameters.required).toEqual(['snapshotId', 'step', 'action']);
expect(operateTool.definition.parameters.properties.snapshotId).toMatchObject({ type: 'string' });
```

把无快照执行用例改为页面滚动，并断言错误消息：

```typescript
await expect(operateTool.execute({
  step: { evaluation: '', memory: '', nextGoal: 'scroll' },
  action: { type: 'scroll', direction: 'down', pixels: 700 }
})).resolves.toMatchObject({
  status: 'failure',
  error: {
    code: 'INVALID_INPUT',
    message: '非 navigate 网页操作缺少 snapshotId，请先调用 read_current_webpage 获取最新快照'
  }
});
```

- [x] **Step 2: 验证测试以预期原因失败**

Run: `pnpm exec vitest run test/views/webview/use-chat-context.test.ts test/views/webview/chat-tool-input.test.ts`

Expected: FAIL，因为当前 Schema 使用联合 `type`，且运行时仍接受缺失或畸形 `step`。

### Task 2: 对齐 Schema 与运行时错误

**Files:**
- Modify: `src/views/webview/web/hooks/useChatContext.ts`
- Modify: `src/views/webview/web/hooks/chatToolInput.ts`

**Interfaces:**
- Consumes: `normalizeWebpageAction(value)`、`normalizeWebpageInput(value)`
- Produces: `isWebpageStep(value: unknown): boolean`、`getInputError(input: unknown): string`

- [x] **Step 1: 实现最小修复**

把 `snapshotId` 属性改为普通字符串并保持顶层必填；新增带 JSDoc 的 `isWebpageStep`，校验三个步骤字段及其长度。导航空字符串归一化为无快照动作，`operatePage` 和 `createConfirmation` 共用精确错误解析。

- [x] **Step 2: 验证定向测试通过**

Run: `pnpm exec vitest run test/views/webview/use-chat-context.test.ts test/views/webview/chat-tool-input.test.ts`

Expected: 相关测试全部 PASS。

### Task 3: 原子消费并串行化页面快照

**Files:**
- Modify: `test/views/webview/web-use-webview.test.ts`
- Modify: `src/views/webview/web/hooks/useWebView.ts`

**Interfaces:**
- Consumes: `operatePage(input, signal)`、`handleDidStartNavigation(event)`
- Produces: 单次使用的非导航快照、读写互斥、世代校验与主框架导航失效语义

- [x] **Step 1: 编写快照重复使用和导航失效测试**

第一次页面操作成功后，使用相同 `snapshotId` 的第二次操作必须返回 `STALE_SNAPSHOT`。两个并发操作使用相同快照时只允许一个进入 `executeJavaScript`。读取与写入不得重叠，Runtime 中断后也必须等底层脚本结束才能再次读取。主框架且 `isInPlace: false` 的 `did-start-navigation` 必须使快照失效并进入 loading；子框架或原地导航保持快照。

- [x] **Step 2: 验证测试以预期原因失败**

Run: `pnpm exec vitest run test/views/webview/web-use-webview.test.ts`

Expected: FAIL，因为当前 `activeSnapshot` 在操作开始前未消费，且控制器未处理 `did-start-navigation`。

- [x] **Step 3: 实现原子消费、世代校验与事件绑定**

在非导航操作通过快照、URL和 loading 检查后，把当前快照保存为局部变量并立即清空共享引用，脚本只读取局部元素指纹。页面读取与写操作相互阻塞，快照失效时推进世代号并拒绝迟到读取。新增 `handleDidStartNavigation`，并在 `src/views/webview/web/index.vue` 绑定 `did-start-navigation`。

- [x] **Step 4: 验证 WebView 测试通过**

Run: `pnpm exec vitest run test/views/webview/web-use-webview.test.ts`

Expected: WebView 控制器测试全部 PASS。

### Task 4: 记录并验证修复

**Files:**
- Modify: `changelog/2026-08-10.md`

**Interfaces:**
- Consumes: Task 1、Task 2 和 Task 3 的完成结果
- Produces: 用户可追踪的修复记录与完整验证证据

- [x] **Step 1: 更新 changelog**

在 `Changed` 下记录 WebView AI 操作 Schema、运行时步骤校验、快照单次消费与导航失效修复。

- [x] **Step 2: 运行完整定向验证**

Run: `pnpm exec vitest run test/views/webview/chat-tool-input.test.ts test/views/webview/use-chat-context.test.ts test/views/webview/web-use-webview.test.ts`

Expected: 3 个测试文件全部 PASS。

- [x] **Step 3: 运行静态检查**

Run: `pnpm exec eslint src/views/webview/web/hooks/useChatContext.ts src/views/webview/web/hooks/chatToolInput.ts src/views/webview/web/hooks/useWebView.ts src/views/webview/web/index.vue test/views/webview/use-chat-context.test.ts test/views/webview/chat-tool-input.test.ts test/views/webview/web-use-webview.test.ts`

Run: `pnpm exec tsc --noEmit`

Expected: 两条命令退出码均为 0。
