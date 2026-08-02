# Chat Workspace File Mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a chat session has a manually selected workspace, `@` file mentions list files from that workspace instead of recent Markdown files.

**Architecture:** Keep `BSmartEditor` source-agnostic: it receives `FileMentionOption[]` and handles trigger/filter/select as it does today. Add a focused BChat hook that scans the manual workspace through `native.readWorkspaceDirectory`, then let `useChatComposer` choose between existing recent Markdown candidates and workspace candidates based on `workspaceOverride`.

**Tech Stack:** Vue 3 Composition API, Pinia-adjacent hooks, TypeScript strict mode, Vitest, Vue reactivity, existing `native` platform API.

## Global Constraints

- No commits for implementation work; the user will commit.
- Only `workspaceOverride !== undefined` enables workspace-wide candidates.
- Default Tibis workspace and non-overridden sessions keep the current recent Markdown candidate behavior.
- Workspace candidates use POSIX-style workspace-relative paths in `FileMentionOption.path`.
- Do not modify `BSmartEditor` to read workspace data directly.
- Use `asyncTo` for async error normalization.
- Update `changelog/2026-08-02.md`.

---

### Task 1: Workspace File Mention Scanner

**Files:**
- Create: `src/components/BChat/hooks/useWorkspaceFileMentions.ts`
- Test: `test/components/BChat/use-workspace-file-mentions.test.ts`

**Interfaces:**
- Consumes: `native.readWorkspaceDirectory(options: ReadWorkspaceDirectoryOptions): Promise<ReadWorkspaceDirectoryResult>`
- Produces: `useWorkspaceFileMentions(options: UseWorkspaceFileMentionsOptions): UseWorkspaceFileMentionsReturn`
- Produces: `DEFAULT_WORKSPACE_MENTION_LIMIT`
- Produces: `WORKSPACE_MENTION_EXCLUDED_DIRECTORIES`

- [x] **Step 1: Write failing tests**

Create tests covering recursive scan, ignored directories, POSIX relative paths, disabled state, read failures, file limit, and stale scan discard.

- [x] **Step 2: Run scanner tests and verify RED**

Run: `pnpm exec vitest run test/components/BChat/use-workspace-file-mentions.test.ts`

Expected: fail because `useWorkspaceFileMentions` does not exist.

- [x] **Step 3: Implement scanner hook**

Create the hook with explicit TypeScript interfaces, file header comment, JSDoc comments, asyncTo-based directory reads, sequence-based stale result protection, ignored directories, and a 2000-file default limit.

- [x] **Step 4: Run scanner tests and verify GREEN**

Run: `pnpm exec vitest run test/components/BChat/use-workspace-file-mentions.test.ts`

Expected: pass.

### Task 2: BChat Composer Candidate Switching

**Files:**
- Modify: `src/components/BChat/hooks/useChatComposer.ts`
- Modify: `src/components/BChat/index.vue`
- Test: `test/components/BChat/use-chat-composer-file-mentions.test.ts`

**Interfaces:**
- Consumes: `useWorkspaceFileMentions({ workspaceRoot, enabled })`
- Produces: `UseChatComposerOptions.workspaceRoot`
- Produces: `UseChatComposerOptions.workspaceOverride`
- Produces: `fileMentionOptions` switching behavior

- [x] **Step 1: Write failing tests**

Create tests that call `useChatComposer` with mocked recent files and workspace scanner output:
- no override returns only recent Markdown files
- manual override returns workspace file mentions and does not mix recent files
- manual override with unavailable workspace returns an empty candidate list

- [x] **Step 2: Run composer tests and verify RED**

Run: `pnpm exec vitest run test/components/BChat/use-chat-composer-file-mentions.test.ts`

Expected: fail because `useChatComposer` does not accept workspace inputs or scanner output.

- [x] **Step 3: Wire composer and BChat**

Add `workspaceRoot` and `workspaceOverride` refs to `UseChatComposerOptions`, call the scanner hook from composer, and pass both refs from `BChat/index.vue`.

- [x] **Step 4: Run composer and boundary tests**

Run: `pnpm exec vitest run test/components/BChat/use-chat-composer-file-mentions.test.ts test/components/BChat/chat-composer-boundary.test.ts`

Expected: pass.

### Task 3: Changelog And Verification

**Files:**
- Modify: `changelog/2026-08-02.md`

**Interfaces:**
- Consumes: implementation from Tasks 1-2
- Produces: changelog entry and verified worktree

- [x] **Step 1: Update changelog**

Add a `## Changed` bullet describing manual chat workspace `@` file candidates.

- [x] **Step 2: Run focused verification**

Run: `pnpm exec vitest run test/components/BChat/use-workspace-file-mentions.test.ts test/components/BChat/use-chat-composer-file-mentions.test.ts test/components/BChat/chat-composer-boundary.test.ts`

Expected: pass.

- [x] **Step 3: Run static verification**

Run: `pnpm exec eslint src/components/BChat/hooks/useWorkspaceFileMentions.ts src/components/BChat/hooks/useChatComposer.ts src/components/BChat/index.vue test/components/BChat/use-workspace-file-mentions.test.ts test/components/BChat/use-chat-composer-file-mentions.test.ts --ext .vue,.ts`

Expected: pass.

Run: `pnpm exec tsc --noEmit`

Expected: pass or report existing unrelated type failures clearly.

Run: `git diff --check`

Expected: pass.
