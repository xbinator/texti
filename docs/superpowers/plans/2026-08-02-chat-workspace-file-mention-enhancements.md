# Chat Workspace File Mention Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make manual-workspace `@` file mentions respect common workspace ignore rules, behave better in large repositories, rank candidates more usefully, and cover the real source-switching flow.

**Architecture:** Keep scanning inside `useWorkspaceFileMentions` with no Electron IPC contract change. Use renderer-side `.gitignore` parsing through `native.readWorkspaceFile`, workspace-root cache reuse, shallow-first traversal, and recent-file weighting passed from `useChatComposer`.

**Tech Stack:** Vue 3 composables, Vitest, TypeScript, existing `native.readWorkspaceDirectory/readWorkspaceFile`, no new dependency.

## Global Constraints

- Do not commit implementation work; the user will commit.
- Only use workspace-wide file mentions when `workspaceOverride !== undefined`.
- Default workspace continues to use recent Markdown file mentions.
- Avoid `any`; all new interfaces and functions need comments.
- Use `asyncTo` for async platform calls.

---

### Task 1: Workspace Scan Filters And Cache

**Files:**
- Modify: `src/components/BChat/hooks/useWorkspaceFileMentions.ts`
- Test: `test/components/BChat/use-workspace-file-mentions.test.ts`

**Interfaces:**
- Consumes: `native.readWorkspaceDirectory(options)` and `native.readWorkspaceFile(options)`
- Produces: `useWorkspaceFileMentions(options)` with cached, filtered `fileMentions`

- [x] **Step 1: Write failing tests**

Add tests that assert:
- `.gitignore` excludes matching files and directories, and `!` can re-include a child path.
- hidden directories are skipped by default while root `.gitignore` is still read.
- binary/media extensions are not offered in chat `@` file candidates.
- scanning the same `workspaceRoot` a second time reuses cached results.

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm exec vitest run test/components/BChat/use-workspace-file-mentions.test.ts
```

Expected: new tests fail because `.gitignore`, cache, and binary/media filtering are not implemented yet.

- [x] **Step 3: Implement filters and cache**

Implement:
- `.gitignore` parsing for blank lines, comments, negation, directory-only rules, basename rules, rooted rules, and `*`/`?`/`**` globs.
- hidden directory skipping except `.gitignore` file reads.
- binary/media extension exclusion for candidates.
- module-level cache keyed by workspace root and scan options.
- shallow-first traversal using a directory queue.

- [x] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run test/components/BChat/use-workspace-file-mentions.test.ts
```

Expected: all workspace mention tests pass.

### Task 2: Recent-Aware Ranking

**Files:**
- Modify: `src/components/BChat/hooks/useChatComposer.ts`
- Test: `test/components/BChat/use-chat-composer-file-mentions.test.ts`

**Interfaces:**
- Consumes: `recentStore.recentFiles`
- Produces: workspace file candidates ordered by recent absolute path matches before non-recent files

- [x] **Step 1: Write failing test**

Add a test where a manual workspace exposes `src/older.ts` and `src/recent.ts`, recent files contain `/manual-workspace/src/recent.ts`, and composer returns `recent.ts` first.

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm exec vitest run test/components/BChat/use-chat-composer-file-mentions.test.ts
```

Expected: the new ranking test fails before implementation.

- [x] **Step 3: Implement ranking**

Build a recent-path index from `recentStore.recentFiles`, convert workspace relative paths to absolute paths, and sort workspace mention candidates by recent `openedAt` weight before path/name fallback.

- [x] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run test/components/BChat/use-chat-composer-file-mentions.test.ts
```

Expected: all composer source tests pass.

### Task 3: BChat Source-Switching Coverage

**Files:**
- Modify: `test/components/BChat/session-id-runtime.test.ts`

**Interfaces:**
- Consumes: mounted `BChat`, `InputToolbar` workspace events, `BSmartEditor.fileMentions`
- Produces: regression coverage for default-to-manual-to-default mention source switching

- [x] **Step 1: Write failing test**

Add a BChat-level test:
- default draft starts with recent Markdown mention.
- selecting a manual workspace triggers workspace relative file mentions.
- clearing the workspace restores recent Markdown mention.

- [x] **Step 2: Run test and verify RED if production behavior is missing**

Run:

```bash
pnpm exec vitest run test/components/BChat/session-id-runtime.test.ts --testNamePattern "switches prompt file mention source"
```

Expected: the test protects the complete flow; it may pass if earlier implementation already covers the behavior.

- [x] **Step 3: Run related regression suite**

Run:

```bash
pnpm exec vitest run test/components/BChat/use-workspace-file-mentions.test.ts test/components/BChat/use-chat-composer-file-mentions.test.ts test/components/BChat/session-id-runtime.test.ts test/components/BSmart/use-file-mention-context.test.ts test/components/BSmart/file-mention-select.test.ts
```

Expected: all related tests pass.

### Task 4: Final Verification

**Files:**
- Modify: `changelog/2026-08-02.md`

**Interfaces:**
- Consumes: completed code and tests
- Produces: changelog entry and verification evidence

- [x] **Step 1: Update changelog**

Add a concise `Changed` entry describing smarter manual-workspace `@` file mention filtering, cache, and ranking.

- [x] **Step 2: Run static checks**

Run:

```bash
pnpm exec eslint src/components/BChat/hooks/useWorkspaceFileMentions.ts src/components/BChat/hooks/useChatComposer.ts src/components/BChat/index.vue test/components/BChat/use-workspace-file-mentions.test.ts test/components/BChat/use-chat-composer-file-mentions.test.ts test/components/BChat/session-id-runtime.test.ts --ext .vue,.ts
pnpm exec tsc --noEmit
git diff --check
```

Expected: all checks pass.
