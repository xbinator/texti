# Chat Background Runtime and Sidebar Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow running chat tabs to close without aborting, unlock every ChatSider session action, and preserve strict session isolation for background Renderer tools and confirmations.

**Architecture:** Keep ChatRuntime and Chat Actor ownership at application scope. Detach active runtime records from closed tabs, bind Renderer tool executors to immutable runtime/session context, and move transient Runtime confirmation resolution from component ownership to an application-level broker. A reopened BChat reloads the persisted message snapshot, attaches to the existing Session Actor, and safely rebinds only the original capability allowlist.

**Tech Stack:** Vue 3, Pinia, XState, TypeScript strict mode, Electron IPC, Vitest, Vue Test Utils.

## Global Constraints

- Do not use `any`; all parameters and return values require explicit types.
- New and modified functions, interfaces, and complex logic require accurate JSDoc comments.
- Use `asyncTo()` for asynchronous error normalization outside tests.
- Keep deletion blocked for `running`, `waiting`, or promoting chat sessions.
- Do not add dependencies.
- Record implementation changes in `changelog/2026-07-31.md`.
- Do not create Git commits; the user will commit the final changes.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/components/BChat/hooks/useRuntimeTools.ts` | Build candidate tools and bind fresh executors to immutable Runtime context. |
| `src/components/BChat/hooks/useChatRuntimeLauncher.ts` | Register only bound executors and enforce descriptor/session allowlists on takeover. |
| `types/chat-runtime.d.ts` | Carry the frozen workspace identity in the capability descriptor. |
| `src/components/BChat/utils/confirmationController.ts` | Provide a session-filtered BChat view over the application confirmation broker. |
| `src/stores/chat/confirmationQueue.ts` | Store serializable Runtime confirmation identity by session/runtime instead of component owner. |
| `src/hooks/useChat/useRuntimeEvents.ts` | Expire broker entries on Runtime cancellation/terminal events and fail closed without a safe capability. |
| `src/stores/chat/tab.ts` | Detach active Runtime records from closed tabs and clean detached terminal records. |
| `src/layouts/default/hooks/useTabCloseGuard.ts` | Close chat tabs without Runtime confirmation or abort. |
| `src/hooks/useChat/useRuntimeRecovery.ts` | Restore detached background records without close controllers. |
| `src/views/chat/index.vue` | Remove close-only Runtime controller registration. |
| `src/components/BChat/index.vue` | Remove host abort exposure, bind confirmation UI to the active session, and supply immutable tool binding dependencies. |
| `src/components/BChat/hooks/useChatSessionRuntime.ts` | Merge history snapshots with newer live Runtime updates during reconnect. |
| `src/layouts/default/components/ChatSider.vue` | Remove all session action disabled state and guards. |
| `src/layouts/default/hooks/useChatSession.ts` | Allow session switching and draft creation during background work. |
| `src/layouts/default/hooks/useChatRoute.ts` | Allow page opening while running and distinguish detached records from visible tab ownership. |
| `src/components/BChat/components/SessionHistory.vue` | Remove generic disabled API while retaining active-session deletion protection. |

---

### Task 1: Bind Renderer Tools to Immutable Runtime Context

**Files:**
- Modify: `types/chat-runtime.d.ts`
- Modify: `src/components/BChat/hooks/useRuntimeTools.ts`
- Modify: `src/components/BChat/hooks/useChatRuntimeLauncher.ts`
- Modify: `src/components/BChat/index.vue`
- Test: `test/components/BChat/use-runtime-tools.test.ts`
- Test: `test/components/BChat/session-id-runtime.test.ts`

**Interfaces:**
- Produce `RuntimeToolBinding` with fixed `sessionId`, `runtimeId`, and `workspaceRoot`.
- Change `getActiveTools()` to `getActiveTools(binding?: RuntimeToolBinding): AIToolExecutor[]`.
- Extend `ChatRuntimeCapabilityDescriptor` with optional `workspaceRoot?: string`.

- [x] **Step 1: Write failing immutable-binding tests**

Add tests proving a bound `todowrite` executor keeps session A and a bound Shell executor keeps workspace A after the source refs switch to session/workspace B. Add a launcher integration assertion that `registerRuntime()` receives fresh bound executors rather than `prepared.rendererTools`.

```ts
const binding: RuntimeToolBinding = {
  sessionId: 'session-a',
  runtimeId: 'runtime-a',
  workspaceRoot: '/workspace-a'
};

const tools = runtimeTools.getActiveTools(binding);
activeSessionId.value = 'session-b';
workspaceRoot.value = '/workspace-b';

await tools.find((tool): boolean => tool.definition.name === 'todowrite')?.execute({ todos: [] });
expect(boundBuiltinOptions.getSessionId?.()).toBe('session-a');
expect(boundBuiltinOptions.getWorkspaceRoot?.()).toBe('/workspace-a');
```

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run test/components/BChat/use-runtime-tools.test.ts test/components/BChat/session-id-runtime.test.ts
```

Expected: FAIL because `getActiveTools` has no binding parameter and launcher registers mutable prepared executors.

- [x] **Step 3: Implement two-phase tool selection and binding**

Add the exported binding contract:

```ts
/** Immutable Renderer tool identity for one Runtime. */
export interface RuntimeToolBinding {
  /** Persistent chat session identity. */
  sessionId: string;
  /** Main-process Runtime identity. */
  runtimeId: string;
  /** Workspace captured when the request was prepared. */
  workspaceRoot: string | null;
}
```

Move `createBuiltinTools()` into a factory invoked by `getActiveTools(binding)`. Bound callbacks must return constants from `binding`; the unbound call remains definition-selection only. Derive pending Question state through a new session-addressed callback supplied by BChat, never from `options.messages.value` after binding.

In `useChatRuntimeLauncher.start()`, generate the Runtime address, create a binding, rebuild active tools, and filter them to the names already present in `prepared.rendererTools` before `registerRuntime()`.

```ts
const allowedToolNames = new Set(prepared.rendererTools.map((tool): string => tool.definition.name));
const boundTools = options
  .getActiveTools({ sessionId, runtimeId, workspaceRoot: prepared.config.workspaceRoot ?? null })
  .filter((tool): boolean => allowedToolNames.has(tool.definition.name));
```

Persist `workspaceRoot` in the descriptor. During capability takeover, require address.sessionId to equal the mounted BChat session and rebuild only the descriptor allowlist.

- [x] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: PASS with no warnings.

---

### Task 2: Move Runtime Confirmation Resolution to an Application Broker

**Files:**
- Modify: `src/stores/chat/confirmationQueue.ts`
- Modify: `src/components/BChat/utils/confirmationController.ts`
- Modify: `src/components/BChat/index.vue`
- Modify: `src/components/BChat/hooks/useChatWorkflow.ts`
- Modify: `src/hooks/useChat/useRuntimeEvents.ts`
- Test: `test/stores/chat/confirmation-queue.test.ts`
- Test: `test/components/BChat/confirmation-controller.test.ts`
- Test: `test/components/BChat/session-id-runtime.test.ts`
- Test: `test/hooks/use-runtime-events.test.ts`

**Interfaces:**
- Replace Runtime queue `ownerId` with immutable `sessionId`, `runtimeId`, and optional `toolCallId`.
- Add `RuntimeConfirmationBinding` and globally shared request/settle/expire functions keyed by the Pinia store instance.
- Make BChat confirmation projection session-filtered.

- [x] **Step 1: Write failing broker lifetime and isolation tests**

Cover:

```ts
const controllerA = createChatConfirmationController(ref('session-a'));
const adapterA = controllerA.createAdapter({ sessionId: 'session-a', runtimeId: 'runtime-a' });
const decisionPromise = adapterA.confirm(request);

controllerA.dispose();
const controllerA2 = createChatConfirmationController(ref('session-a'));
controllerA2.approveConfirmation(queue.pending[0].confirmationId);

await expect(decisionPromise).resolves.toMatchObject({ approved: true });
expect(createChatConfirmationController(ref('session-b')).currentConfirmation.value).toBeNull();
```

Also prove a replayed Main confirmationId creates only one decision flight and only one IPC submission owner.

- [x] **Step 2: Run broker tests and verify RED**

Run:

```bash
pnpm exec vitest run test/stores/chat/confirmation-queue.test.ts test/components/BChat/confirmation-controller.test.ts test/components/BChat/session-id-runtime.test.ts test/hooks/use-runtime-events.test.ts
```

Expected: FAIL because confirmation resolvers are component-owned and Runtime items lack session/runtime identity.

- [x] **Step 3: Implement the application-level broker**

Use a module-level `WeakMap<object, Map<string, RuntimeConfirmationFlight>>`, keyed by the Pinia queue instance, to keep Promise resolvers outside serializable state. The flight identity is confirmationId and contains the immutable binding plus a single Promise.

```ts
/** Runtime confirmation identity independent from a BChat instance. */
export interface RuntimeConfirmationBinding {
  sessionId: string;
  runtimeId: string;
  toolCallId?: string;
}

/** Result of requesting a deduplicated confirmation flight. */
export interface RuntimeConfirmationRequest {
  created: boolean;
  decision: Promise<AIToolConfirmationDecision>;
}
```

`createAdapter(binding)` maps `confirm()` to the shared broker. `dispose()` only releases the component view and must not settle active Runtime flights. `approveConfirmation()` and `cancelConfirmation()` settle by confirmationId from any BChat mounted for the same session.

For Main confirmation replay, pass the Main confirmationId into the broker. Only the caller receiving `created: true` awaits and submits the IPC decision; later BChat replays only display the existing flight.

Export an expiration function used by Runtime cancelled/error/completed handlers. Expiration removes the queue projection and resolves local renderer confirmation as rejected without allowing another session to answer it.

- [x] **Step 4: Run broker tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

---

### Task 3: Detach Running Runtime State When a Tab Closes

**Files:**
- Modify: `src/stores/chat/tab.ts`
- Modify: `src/layouts/default/hooks/useTabCloseGuard.ts`
- Modify: `src/hooks/useChat/useRuntimeRecovery.ts`
- Modify: `src/hooks/useChat/useRuntimeEvents.ts`
- Modify: `src/views/chat/index.vue`
- Modify: `src/components/BChat/index.vue`
- Test: `test/stores/chat/tab-runtime.test.ts`
- Test: `test/layouts/default/use-tab-close-guard.test.ts`
- Test: `test/hooks/use-runtime-recovery.test.ts`
- Test: `test/views/chat/index.test.ts`
- Test: `test/components/BChat/session-id-runtime.test.ts`

**Interfaces:**
- Remove `ChatTabRuntimeController`, controller Map, and `abortTabs()`.
- Add `closeTab(tabId: string): void` to detach active state or remove terminal state.
- Make terminal state cleanup remove detached records while preserving visible-tab projection.

- [x] **Step 1: Write failing close-without-abort and detach tests**

Require that closing a running persisted tab keeps `chat:session-a` as a background record, closing a running `chat:new` record with `sessionId: session-a` rekeys it to `chat:session-a`, and closing an idle tab removes it. Require the close guard not to show Runtime confirmation or invoke abort.

- [x] **Step 2: Run close-state tests and verify RED**

Run:

```bash
pnpm exec vitest run test/stores/chat/tab-runtime.test.ts test/layouts/default/use-tab-close-guard.test.ts test/hooks/use-runtime-recovery.test.ts test/views/chat/index.test.ts test/components/BChat/session-id-runtime.test.ts
```

Expected: FAIL on abort expectations and missing detached-record behavior.

- [x] **Step 3: Implement detached Runtime lifecycle**

`closeTab()` uses `isActiveRuntimeStatus(record.status)` and `record.sessionId`:

```ts
if (isActiveRuntimeStatus(record.status) && record.sessionId) {
  const detachedTabId = createChatTabId(record.sessionId);
  this.records[detachedTabId] = { ...record, tabId: detachedTabId };
  if (detachedTabId !== tabId) delete this.records[tabId];
  syncTabStatus(tabId, 'idle');
  return;
}
this.removeTab(tabId);
```

Adapt the implementation to avoid importing router helpers into the Store if that would create a cycle; a local documented `chat:${sessionId}` helper is acceptable.

Remove all close-only controllers. `useTabCloseGuard.canClose()` keeps promotion, duplicate-close, dirty-content, and navigation behavior but skips Runtime confirmation entirely. `cleanupClosedTabs()` calls `closeTab()`.

Runtime complete/error handlers remove a detached record when no matching visible tab exists. Recovery creates a detached record for active snapshots without visible tabs and never creates an abort controller.

- [x] **Step 4: Run close-state tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

---

### Task 4: Make Reconnect History Merge Monotonic

**Files:**
- Modify: `src/components/BChat/hooks/useChatHistory.ts`
- Modify: `src/components/BChat/hooks/useChatSessionRuntime.ts`
- Modify: `src/components/BChat/hooks/useChatWorkflow.ts`
- Test: `test/components/BChat/session-id-runtime.test.ts`

**Interfaces:**
- Add a monotonically increasing visible-message revision.
- Add `mergeLoadedMessages(loadedMessages: Message[], baselineRevision: number): void` that prefers newer live messages by message ID.

- [x] **Step 1: Write a failing reconnect race test**

Defer `getSessionMessages()`, mount BChat for session A, emit a newer `messageUpdated`, then resolve history with an older copy. Assert the newer content remains visible and later deltas continue updating it.

- [x] **Step 2: Run the race test and verify RED**

Run:

```bash
pnpm exec vitest run test/components/BChat/session-id-runtime.test.ts
```

Expected: FAIL because `setLoadedMessages()` overwrites the newer event.

- [x] **Step 3: Implement revision-aware merge**

Increment the revision on live upsert/delete. Capture the revision before history IO. If unchanged, replace normally; if changed, merge loaded messages with current visible messages by ID and let current live copies win. Reject stale load results when the active session changed during IO.

- [x] **Step 4: Run the race test and verify GREEN**

Run the Step 2 command. Expected: PASS.

---

### Task 5: Unlock ChatSider and Preserve Delete Protection

**Files:**
- Modify: `src/layouts/default/components/ChatSider.vue`
- Modify: `src/layouts/default/hooks/useChatSession.ts`
- Modify: `src/layouts/default/hooks/useChatRoute.ts`
- Modify: `src/components/BChat/components/SessionHistory.vue`
- Test: `test/layouts/default/chat-sider.test.ts`
- Test: `test/layouts/default/use-chat-session.test.ts`
- Test: `test/layouts/default/use-chat-route.test.ts`
- Test: `test/components/BChat/session-history.test.ts`

**Interfaces:**
- `useChatSession()` no longer accepts options.
- `useChatRoute()` no longer accepts `isSessionActionDisabled`.
- `SessionHistory` no longer exposes a `disabled` prop.
- `resolveRoute()` returns an owner only when that owner has a visible tab.

- [x] **Step 1: Write failing unlocked-action tests**

Require no disabled attributes during BChat loading or session collection loading. Require switching, draft creation, title editing, and page opening to execute while Runtime is running. Require a detached owner record without a visible tab to switch into ChatSider rather than navigate immediately.

Keep tests proving active Runtime delete actions remain hidden and direct deletion is rejected.

- [x] **Step 2: Run sidebar tests and verify RED**

Run:

```bash
pnpm exec vitest run test/layouts/default/chat-sider.test.ts test/layouts/default/use-chat-session.test.ts test/layouts/default/use-chat-route.test.ts test/components/BChat/session-history.test.ts
```

Expected: FAIL because the disabled props and hidden guards still exist.

- [x] **Step 3: Remove disabled plumbing and guards**

Remove `chatLoading`, `isSessionActionDisabled`, `@loading-change`, and all three ChatSider disabled bindings. Keep only `!session` and `titleEditor.saving` guards for title editing.

Remove `UseChatSessionOptions` and `shouldRejectSessionAction()`. Remove `isSessionActionDisabled` from `UseChatRouteOptions` and `openChatPage()`.

Remove generic disabled state from SessionHistory. Retain `chatStore.sessionsLoading` and `activeRuntimeIds` checks in `handleDeleteSession()` and the active Runtime action visibility guard.

- [x] **Step 4: Run sidebar tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

---

### Task 6: Changelog and Full Verification

**Files:**
- Modify: `changelog/2026-07-31.md`

- [x] **Step 1: Record the behavior change**

Add explicit `## Changed` entries for background Runtime continuation, ChatSider action unlocking, immutable capability binding, confirmation broker handoff, and reconnect race protection.

- [x] **Step 2: Run focused chat suites**

```bash
pnpm exec vitest run test/stores/chat/tab-runtime.test.ts test/stores/chat/confirmation-queue.test.ts test/layouts/default/use-tab-close-guard.test.ts test/layouts/default/chat-sider.test.ts test/layouts/default/use-chat-session.test.ts test/layouts/default/use-chat-route.test.ts test/components/BChat/session-history.test.ts test/components/BChat/confirmation-controller.test.ts test/components/BChat/use-runtime-tools.test.ts test/components/BChat/session-id-runtime.test.ts test/hooks/use-runtime-events.test.ts test/hooks/use-runtime-recovery.test.ts test/views/chat/index.test.ts
```

Expected: all tests PASS.

- [x] **Step 3: Run project quality checks**

```bash
pnpm lint
pnpm lint:style
pnpm exec tsc --noEmit
```

Expected: all commands exit 0. If an existing unrelated failure appears, record its exact file and diagnostic without modifying unrelated user work.

- [x] **Step 4: Inspect the final diff**

Run `git diff --check` and `git status --short`. Confirm there are no whitespace errors, no `any`, no accidental unrelated edits, and no staged or committed files.
