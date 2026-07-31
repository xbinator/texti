# 会话工作区胶囊控件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将输入栏左侧的会话工作区控件改为默认透明、高度 `28px` 的 `18px` 圆角胶囊，默认显示文件夹图标并在悬停时原位切换为 `x`。

**Architecture:** `InputToolbar` 保持现有 `workspace-select` 与 `workspace-clear` 事件，只有渲染和样式改为原生 HTML button。名称按钮左侧保留文件夹图标；清除按钮绝对定位于同一图标槽，在存在覆盖目录时随胶囊悬停显示，因此不改变会话持久化与 Runtime 逻辑。

**Tech Stack:** Vue 3、TypeScript strict、Less、Vitest、Vue Test Utils。

## Global Constraints

- 工作区名称与清除操作都不用 `BButton`；它们使用原生 `button type="button"`。
- 胶囊高度固定为 `28px`、圆角为 `18px`，默认透明；悬停或聚焦时显示同一背景，无内部分隔线或间隙；恢复图标是 `lucide:x`。
- 仅存在临时工作区覆盖时悬停显示恢复按钮；繁忙状态禁用两个原生按钮。
- 不使用 `any`；本次不执行 `git add` 或 `git commit`。
- 更新 `changelog/2026-07-31.md`，并执行定向 Vitest、ESLint、Stylelint 和 TypeScript 检查。

---

## 文件结构

| 文件 | 责任 |
| --- | --- |
| `src/components/BChat/components/InputToolbar.vue` | 原生按钮组成的工作区胶囊、悬停动画和 `x` 图标。 |
| `test/components/BChat/input-toolbar-workspace.test.ts` | 验证原生按钮、连续胶囊、图标、悬停 CSS 与事件。 |
| `changelog/2026-07-31.md` | 记录视觉交互调整。 |

## Task 1: 渲染连续的原生工作区胶囊

**Files:**

- Modify: `src/components/BChat/components/InputToolbar.vue:7-32,150-190`
- Modify: `test/components/BChat/input-toolbar-workspace.test.ts`

**Interfaces:**

- Consumes `workspaceLabel: string`、`hasWorkspaceOverride: boolean`、`workspaceDisabled: boolean`。
- Preserves `workspace-select` and `workspace-clear` emits.

- [ ] **Step 1: 写失败测试**

更新组件测试：工作区分组内的两个操作均为原生 `button`，清除图标为 `lucide:x`，且源码包含统一背景与 `18px` 圆角、悬停展开的选择器：

```ts
const workspace = wrapper.get('.chat-input-toolbar__workspace');
const selectButton = workspace.get('button.chat-input-toolbar__workspace-select');
const clearButton = workspace.get('button.chat-input-toolbar__workspace-clear');

expect(clearButton.find('.b-icon-stub').attributes('data-icon')).toBe('lucide:x');
expect(inputToolbarSource).toContain('height: 28px;');
expect(inputToolbarSource).toContain('border-radius: 18px;');
expect(inputToolbarSource).toContain('.chat-input-toolbar__workspace:hover');
expect(inputToolbarSource).toContain('.chat-input-toolbar__workspace:hover .chat-input-toolbar__workspace-clear');
```

断言临时覆盖缺失时不渲染清除原生 button，繁忙时两个 native button 都有 `disabled` 属性，并保留两个 emit。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm exec vitest run test/components/BChat/input-toolbar-workspace.test.ts`

Expected: FAIL，当前控件仍使用 `BButton`、`lucide:rotate-ccw` 和分离的清除按钮样式。

- [ ] **Step 3: 实现原生胶囊控件**

将工作区模板替换为以下连续容器；不改变 emit 名称：

```vue
<div class="chat-input-toolbar__workspace">
  <button class="chat-input-toolbar__workspace-select" type="button" :disabled="workspaceDisabled" @click="$emit('workspace-select')">
    <span class="chat-input-toolbar__workspace-label">{{ workspaceLabel }}</span>
  </button>
  <button
    v-if="hasWorkspaceOverride"
    class="chat-input-toolbar__workspace-clear"
    type="button"
    :disabled="workspaceDisabled"
    @click="$emit('workspace-clear')"
  >
    <BIcon icon="lucide:x" :size="14" />
  </button>
</div>
```

用下列样式关键点实现单一视觉实体：

```less
.chat-input-toolbar__workspace {
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  border-radius: 18px;
}

.chat-input-toolbar__workspace:hover,
.chat-input-toolbar__workspace:focus-within {
  background: var(--bg-secondary);
}

.chat-input-toolbar__workspace-select,
.chat-input-toolbar__workspace-clear {
  border: 0;
  background: transparent;
}
```

选择与清除按钮高度均为 `28px`，选择按钮设置水平内边距；清除按钮初始 `flex-basis: 0`、`width: 0`、`opacity: 0` 与 `pointer-events: none`，仅在 `.chat-input-toolbar__workspace:hover` 和 `:focus-within` 下展开并恢复交互。默认不设背景，悬停或聚焦时再将统一背景加到外层容器；禁用按钮不添加分隔线或单独圆角。

- [ ] **Step 4: 运行通过测试**

Run: `pnpm exec vitest run test/components/BChat/input-toolbar-workspace.test.ts`

Expected: PASS，原生胶囊的渲染、事件、隐藏条件与样式契约均成立。

- [ ] **Step 5: 不创建提交**

用户明确要求不提交；不执行 `git add` 或 `git commit`。

## Task 2: 记录变更并验证

**Files:**

- Modify: `changelog/2026-07-31.md`

- [ ] **Step 1: 更新 changelog**

在 `## Changed` 下记录：

```markdown
- 聊天工作区入口改为 18px 圆角连续胶囊，名称与 `x` 恢复操作不再使用 BButton，避免视觉分割。
```

- [ ] **Step 2: 运行定向测试与静态检查**

Run: `pnpm exec vitest run test/components/BChat/input-toolbar-workspace.test.ts test/components/BChat/session-id-runtime.test.ts test/components/BChat/use-session-workspace.test.ts`

Expected: PASS。

Run: `pnpm lint`

Expected: PASS。

Run: `pnpm lint:style`

Expected: PASS。

Run: `pnpm exec tsc --noEmit`

Expected: PASS。

- [ ] **Step 3: 确认不创建提交**

Run: `git status --short`

Expected: 显示未提交改动；不执行 `git add` 或 `git commit`。
