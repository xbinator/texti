# Command Panel Question Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the command panel `>` command chooser with a `?` menu that writes and parses plain `model ` and `chat ` prefixes.

**Architecture:** Keep the existing `CommandPanelSource` abstraction and `jump` item selection flow. Update query parsing, hint menu items, visible copy, tests, and changelog without adding hidden component state.

**Tech Stack:** Vue 3, Pinia, TypeScript, Vitest, Less.

## Global Constraints

- Do not create git commits; the user will commit final code.
- Do not keep `>` command parsing or user-facing `>` hints.
- Keep manual `model ` and `chat ` prefixes supported only when the trailing space is present.
- Keep bare `model` and `chat` routed to recent-record search.
- Record code changes in `changelog/2026-08-07.md`.

---

### Task 1: Update Tests For New Routing

**Files:**
- Modify: `test/components/BCommandPanel/query.test.ts`
- Modify: `test/components/BCommandPanel/sources.test.ts`
- Modify: `test/components/BCommandPanel/index.test.ts`

**Interfaces:**
- Consumes: `parseCommandPanelQuery(scope: CommandPanelScope, input: string): CommandPanelQueryRoute`
- Produces: Failing tests that define the new `?`, `model `, and `chat ` behavior.

- [ ] **Step 1: Update query expectations**

Change route tests so `?` maps to `hint`, bare `model` and `chat` map to `recent`, `model ` maps to `model`, `chat ` maps to `chat`, and `>` maps to `recent`.

- [ ] **Step 2: Update source expectations**

Change hint source expectations from one `>` item to two jump items: `model` and `chat`, with `routeInput` values that do not include `>`.

- [ ] **Step 3: Update component interaction expectations**

Change component tests so selecting from `?` writes `model `, shows models, and direct `chat ` input routes to chat sessions.

- [ ] **Step 4: Run focused tests and expect failure**

Run: `pnpm test test/components/BCommandPanel/query.test.ts test/components/BCommandPanel/sources.test.ts test/components/BCommandPanel/index.test.ts`

Expected: FAIL before implementation because current code still emits and parses `>`.

### Task 2: Implement Query And Menu Changes

**Files:**
- Modify: `src/components/BCommandPanel/utils/query.ts`
- Modify: `src/components/BCommandPanel/sources/hint.ts`
- Modify: `src/components/BCommandPanel/sources/jump.ts`
- Modify: `src/components/BCommandPanel/index.vue`

**Interfaces:**
- Consumes: `CommandPanelJumpItem.routeInput`, `handleSelectItem`
- Produces: Plain-prefix command menu and query routing.

- [ ] **Step 1: Update query parser**

Remove `>` handling. Parse exact `?` as `hint`; parse `model` and `chat` only when followed by whitespace; keep model scope locked to `model`.

- [ ] **Step 2: Update command menu**

Make `createHintSource` return `model` and `chat` jump items. Keep `createJumpSource` aligned with the new plain-prefix route inputs or remove user-facing `>` semantics from it.

- [ ] **Step 3: Update visible copy**

Change the empty-input hint from `输入“?”即可查看可用命令` only if needed to stay accurate; remove any `>` wording from command descriptions.

- [ ] **Step 4: Run focused tests and expect pass**

Run: `pnpm test test/components/BCommandPanel/query.test.ts test/components/BCommandPanel/sources.test.ts test/components/BCommandPanel/index.test.ts`

Expected: PASS.

### Task 3: Changelog And Verification

**Files:**
- Modify: `changelog/2026-08-07.md`

**Interfaces:**
- Consumes: completed command panel behavior.
- Produces: project-required changelog entry and verification evidence.

- [ ] **Step 1: Add changelog entry**

Record the command panel behavior change under `Changed`.

- [ ] **Step 2: Run broader checks**

Run focused tests again. If practical, also run `pnpm exec tsc --noEmit` for type safety.

- [ ] **Step 3: Report final status**

Summarize changed files, tests run, and note that no commit was created.
