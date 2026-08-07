# BChat Shell Pipe Realtime Output Implementation Plan

> **For Codex:** Use the executing-plans skill to implement this plan task by task. Apply test-driven-development for every behavior change and verification-before-completion before reporting success.

**Goal:** Make ordinary `run_shell_command` pipe-mode stdout/stderr visible in BChat while the command is running, without changing PTY capability gates or sending automatic input.

**Architecture:** Route the existing `shell:output` IPC chunks through the Runtime-scoped command route into a transient Session UI event. BChat appends those chunks to the matching Shell tool part with bounded memory, while completed tools continue to render their final structured result as the authoritative output.

**Tech Stack:** TypeScript, Vue 3, Electron preload IPC, Vitest, Vue Test Utils.

**Global constraints:** Do not stage or commit changes. Preserve `TIBIS_SHELL_AUTO_DEFAULT_CAPABILITY`, Shell safety analysis, publishing gates, cancellation behavior, and the existing PTY `shell:run-event` path. Do not add CLI-specific rewrites or automatic stdin input.

---

### Task 1: Route pipe output through Runtime session events

**Files:**

- Modify: `test/hooks/use-runtime-events.test.ts`
- Modify: `src/ai/chat/sessionEvents.ts`
- Modify: `src/hooks/useChat/useRuntimeEvents.ts`

**Step 1: Write failing Runtime routing tests**

Extend the Electron API mock so tests can capture `onShellCommandOutput` listeners and can simulate a preload where that method is absent. Add tests that:

- start two ordinary pipe Shell tool requests with the same original toolCallId in different runtimes;
- emit chunks using each Runtime-encoded commandId;
- assert each Session receives only its own `shellCommandOutput` event with the original toolCallId restored;
- assert output progress uses `phase: 'shell_output'` and a monotonically increasing character count;
- assert unknown or unmanaged commandIds are ignored;
- assert initialization succeeds when `onShellCommandOutput` is unavailable.

Use an output chunk shaped like:

```ts
const chunk: ElectronShellCommandOutputChunk = {
  commandId: runtimeCommandId,
  stream: 'stdout',
  text: 'installing\n',
  sequence: 1,
  createdAt: Date.now(),
}
```

**Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm exec vitest run test/hooks/use-runtime-events.test.ts
```

Expected: FAIL because no pipe-output subscription or `shellCommandOutput` Session UI event exists.

**Step 3: Add the transient Session UI event**

In `src/ai/chat/sessionEvents.ts`, import `ElectronShellCommandOutputChunk` and add:

```ts
| { type: 'shellCommandOutput'; chunk: ElectronShellCommandOutputChunk }
```

Do not add the event to confirmation caching; live chunks remain transient.

**Step 4: Generalize Shell route creation**

In `src/hooks/useChat/useRuntimeEvents.ts`:

- recognize every `run_shell_command` request, not only `interactionMode: 'auto-default'`;
- add a cumulative `outputChars` field to `ShellEventRoute`;
- create the route for all Shell requests while retaining the existing five-second cleanup grace period;
- keep the existing PTY `handleShellRunEvent` behavior unchanged.

All new functions and fields must have the comments and explicit types required by `AGENTS.md`.

**Step 5: Subscribe and route pipe chunks**

Add a handler that:

1. resolves the route by encoded commandId;
2. ignores missing routes and non-managed runtimes;
3. republishes the chunk with the original toolCallId as commandId;
4. increments `outputChars` by `chunk.text.length`;
5. reports bounded progress using the existing Shell summary helper.

Subscribe through a compatibility guard:

```ts
if (!window.electronAPI?.onShellCommandOutput) {
  return () => undefined
}
```

**Step 6: Run the Runtime test and confirm GREEN**

Run:

```bash
pnpm exec vitest run test/hooks/use-runtime-events.test.ts
```

Expected: PASS, including existing PTY concurrency coverage.

---

### Task 2: Append pipe chunks to bounded BChat message state

**Files:**

- Create: `test/components/BChat/shell-output.test.ts`
- Modify: `src/components/BChat/utils/messageHelper.ts`
- Modify: `src/components/BChat/hooks/useChatWorkflow.ts`

**Step 1: Write failing message-state tests**

Create focused tests for `append.shellOutputPart` that assert:

- stdout and stderr chunks are appended in receive order;
- a mismatched commandId leaves the message unchanged;
- 81 one-character chunks retain only the last 80;
- two 8,000-character chunks retain exactly the newest 12,000 characters, trimming the head of the first retained chunk while preserving metadata.

Also add or extend workflow coverage so publishing a `shellCommandOutput` Session UI event applies the chunk to the current matching tool message.

**Step 2: Run the focused tests and confirm RED**

Run:

```bash
pnpm exec vitest run test/components/BChat/shell-output.test.ts
```

Expected: FAIL on the 12,000-character limit and workflow event handling.

**Step 3: Implement bounded output retention**

In `src/components/BChat/utils/messageHelper.ts`:

- retain the existing maximum of 80 chunks;
- add a 12,000-character limit across retained chunk text;
- keep the newest tail;
- when the boundary cuts through a chunk, clone it and retain only its text tail;
- only mutate a matching `run_shell_command` tool part.

The bound helper should make one reverse pass through at most 80 chunks.

**Step 4: Handle the Session UI event in BChat**

In `src/components/BChat/hooks/useChatWorkflow.ts`, handle `shellCommandOutput` before the existing general event branches and apply it to each current message using `append.shellOutputPart`. Do not create a new message when no matching tool part exists.

**Step 5: Run focused message/workflow tests and confirm GREEN**

Run the exact focused test files identified in Step 1.

Expected: PASS with stable order, command isolation, and both capacity bounds.

---

### Task 3: Render live pipe output while preserving final-result authority

**Files:**

- Modify: `test/components/BChat/bubble-part-tool-shell.test.ts`
- Modify: `src/components/BChat/components/MessageBubble/BubblePartTool/index.vue`

**Step 1: Write failing component tests**

Add tests that assert:

- an executing Shell tool with `shellOutput` renders stdout/stderr chunks in state order;
- a done Shell tool with both stale live chunks and a final structured result renders the final result;
- the existing PTY terminal snapshot test remains unchanged and passing.

**Step 2: Run the component test and confirm RED**

Run:

```bash
pnpm exec vitest run test/components/BChat/bubble-part-tool-shell.test.ts
```

Expected: FAIL because the component currently ignores `shellOutput`.

**Step 3: Implement the output priority**

Refactor the computed Shell terminal content into these priorities:

1. done state: final `terminalOutput` or stdout/stderr;
2. executing PTY: `shellRunState.terminalContent`;
3. executing pipe: joined `shellOutput[].text`;
4. fallback: final structured content or empty text.

Do not change terminal styling or PTY projector behavior.

**Step 4: Run the component test and confirm GREEN**

Run:

```bash
pnpm exec vitest run test/components/BChat/bubble-part-tool-shell.test.ts
```

Expected: PASS for live pipe, final-result priority, and PTY regression coverage.

---

### Task 4: Document the fix and run verification

**Files:**

- Modify: `changelog/2026-08-07.md`
- Verify all files changed by Tasks 1–3

**Step 1: Update the changelog**

Under `## Changed`, add a concise entry stating that BChat now displays ordinary pipe Shell stdout/stderr in real time with Runtime isolation and bounded retention.

**Step 2: Run focused regression tests**

Run:

```bash
pnpm exec vitest run test/hooks/use-runtime-events.test.ts test/components/BChat/shell-output.test.ts test/components/BChat/bubble-part-tool-shell.test.ts
```

Also include the exact workflow test file if workflow coverage was added elsewhere.

Expected: all focused tests PASS.

**Step 3: Run static verification**

Run:

```bash
pnpm exec tsc --noEmit
pnpm exec eslint src/ai/chat/sessionEvents.ts src/hooks/useChat/useRuntimeEvents.ts src/components/BChat/utils/messageHelper.ts src/components/BChat/hooks/useChatWorkflow.ts src/components/BChat/components/MessageBubble/BubblePartTool/index.vue test/hooks/use-runtime-events.test.ts test/components/BChat/shell-output.test.ts test/components/BChat/bubble-part-tool-shell.test.ts
pnpm exec stylelint 'src/components/BChat/components/MessageBubble/BubblePartTool/index.vue'
```

Expected: all commands exit with status 0.

**Step 4: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Confirm there are no unrelated modifications, no staged changes, no hardcoded local absolute paths in source or repository documentation, and no accidental capability or Shell execution-policy changes.

