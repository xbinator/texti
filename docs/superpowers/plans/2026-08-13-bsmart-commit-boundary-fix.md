# BSmart 提交边界修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一 Input 与 Select 的模式草稿提交语义，并阻止空变量路径进入结构化 Smart 模型。

**Architecture:** 模式按钮只切换局部 UI 草稿，不直接改变模型；变量输入只有在路径非空时才提交 `variable`，清空变量路径时回退到各组件定义的空静态值。通过组件回归测试覆盖切换、取消和清空路径，再同步文档与 changelog。

**Tech Stack:** Vue 3、TypeScript、Vitest、Vue Test Utils。

## Global Constraints

- 不兼容历史基本类型和旧模板变量格式。
- 不使用 `any`。
- 不暂存、不提交代码。

### Task 1: 锁定模式切换和空路径行为

**Files:**
- Modify: `test/components/BSmart/input.component.test.ts`
- Modify: `test/components/BSmart/select.component.test.ts`
- Modify: `test/components/BSmart/variable-input.component.test.ts`

- [ ] **Step 1: Write the failing tests**
  - Input 从 literal 切到 variable 再切回时，未提交草稿不得覆盖原 literal。
  - Input 已有 variable 清空路径时写回 `literal: ''`。
  - Select 从 literal 切到 variable 再返回静态界面时仍保留原 literal。
  - VariableInput 清空路径时由外层决定回退，组件仍发送空路径事件。

- [ ] **Step 2: Run the focused tests**

```bash
pnpm exec vitest run test/components/BSmart/input.component.test.ts test/components/BSmart/select.component.test.ts test/components/BSmart/variable-input.component.test.ts
```

Expected: new tests fail because Input currently commits an empty draft as a literal and variable clearing currently commits an empty variable path.

### Task 2: 实现最小提交边界

**Files:**
- Modify: `src/components/BSmart/Input.vue`
- Modify: `src/components/BSmart/Select.vue`

- [ ] **Step 1: Make Input preserve the last committed literal while a variable draft is uncommitted.**
- [ ] **Step 2: Make Input normalize an empty variable path to `createLiteralValue('')`.**
- [ ] **Step 3: Keep Select mode switches model-neutral and normalize empty variable paths consistently.**

### Task 3: 同步协议说明并验证

**Files:**
- Modify: `docs/superpowers/specs/2026-08-13-bsmart-structured-value-design.md`
- Modify: `skills/developing-widget/references/elements-and-bindings.md`
- Modify: `changelog/2026-08-13.md`

- [ ] **Step 1: Document empty variable path and cancellation semantics.**
- [ ] **Step 2: Run focused BSmart tests.**
- [ ] **Step 3: Run lint, stylelint, TypeScript, and the full test suite.**
- [ ] **Step 4: Run `git diff --check` and leave the worktree uncommitted.**
