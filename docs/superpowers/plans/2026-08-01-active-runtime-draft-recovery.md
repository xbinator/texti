# Active Runtime Draft Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent session reload from converting an assistant draft into an interruption while its main-process Runtime is still active.

**Architecture:** Keep hard-interruption recovery in the chat session store, but gate the destructive recovery against both active Runtime snapshots and active Agent checkpoints. Treat unavailable or failed activity queries as blocked so a transient IPC problem cannot finalize a live draft.

**Tech Stack:** Vue 3, Pinia, TypeScript, Electron IPC, Vitest.

## Global Constraints

- Do not use `any`.
- Add explicit TypeScript parameter and return types plus required JSDoc comments.
- Use `asyncTo` for asynchronous error normalization.
- Do not stage or commit; the user will commit.
- Record the change in `changelog/2026-08-01.md`.

---

### Task 1: Protect live Runtime drafts

**Files:**

- Modify: `test/stores/chat/session.test.ts`
- Modify: `src/stores/chat/session.ts`

**Interfaces:**

- Consumes: `ElectronAPI.chatRuntimeListActive(): Promise<ChatRuntimeHandlerResult<ChatRuntimeRecoverySnapshot[]>>`
- Consumes: `ElectronAPI.chatAgentListActive(): Promise<ChatHandlerResult<ChatAgentCheckpointSnapshot[]>>`
- Produces: `readRecoveryGate(sessionId: string): Promise<'legacy' | 'blocked' | 'clear'>`

- [x] **Step 1: Write the failing Runtime regression tests**

Add a `chatRuntimeListActive` mock and verify that a snapshot for the loaded session preserves the unfinished assistant draft without writing an interrupt message. Also verify fail-closed behavior when the Runtime query rejects or returns an unsuccessful result.

```typescript
mockElectronAPI.chatRuntimeListActive.mockResolvedValue({
  ok: true,
  data: [createRuntimeSnapshot('session-1')]
});

await expect(store.getSessionMessages('session-1')).resolves.toEqual([expect.objectContaining({ loading: true, finished: false })]);
expect(mockElectronAPI.chatMessageAdd).not.toHaveBeenCalled();
```

- [x] **Step 2: Run the regression tests and confirm failure**

Run: `pnpm exec vitest run test/stores/chat/session.test.ts`

Expected: FAIL because `readRecoveryGate` ignores `chatRuntimeListActive` and persists an interrupt marker.

- [x] **Step 3: Extend the recovery gate**

Query active Runtime snapshots first. Return `blocked` when the Runtime API fails or contains the session. Only query Agent checkpoints after Runtime ownership is clear; preserve the existing legacy fallback when neither API exists.

```typescript
const runtimeGate = await readRuntimeGate(sessionId);
if (runtimeGate !== 'clear') return runtimeGate;
return readAgentGate(sessionId);
```

- [x] **Step 4: Run the focused store tests**

Run: `pnpm exec vitest run test/stores/chat/session.test.ts`

Expected: PASS.

### Task 2: Audit related session-switch races and document the fix

**Files:**

- Inspect: `src/components/BChat/hooks/useChatHistory.ts`
- Inspect: `src/components/BChat/hooks/useChatSessionRuntime.ts`
- Inspect: `src/hooks/useChat/useRuntimeRecovery.ts`
- Modify when a confirmed defect requires coverage: the corresponding focused test and source file
- Create: `changelog/2026-08-01.md`

**Interfaces:**

- Consumes: Runtime message-created, message-updated, message-deleted, and complete events.
- Produces: A verified session-switch path with no false interruption or stale-history overwrite.

- [x] **Step 1: Audit all unfinished-draft finalization paths**

Trace switch-away, switch-back, late history response, Runtime completion, and pending user-input flows. Confirm that only the store recovery path can persist the false interrupt and that revision merging keeps later live events authoritative.

- [x] **Step 2: Add a regression test for each additional confirmed defect**

Run the narrow test first and verify it fails for the diagnosed reason before modifying production code.

- [x] **Step 3: Implement only confirmed fixes**

Keep session identity checks at every asynchronous boundary and avoid UI-only filtering of persisted corruption.

- [x] **Step 4: Record the behavior change**

Create `changelog/2026-08-01.md` with a `## Fixed` entry describing that reopening a live streaming chat no longer creates a false interruption marker.

- [x] **Step 5: Verify the affected surface**

Run:

```bash
pnpm exec vitest run test/stores/chat/session.test.ts test/components/BChat/use-chat-history.test.ts test/components/BChat/session-id-runtime.test.ts test/hooks/use-runtime-recovery.test.ts
pnpm exec eslint src/stores/chat/session.ts test/stores/chat/session.test.ts --ext .ts
pnpm exec tsc --noEmit
git diff --check
```

Expected: focused tests, ESLint, TypeScript, and diff checks all pass.
