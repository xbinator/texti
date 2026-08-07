# BChat ToolActivity Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every BChat tool activity card display only its current status while preserving idle “continue waiting / stop” controls and continuous Shell terminal output.

**Architecture:** Remove presentation-only progress fields from the `ToolActivity` component contract and from its `BubblePartTool` caller. Keep the complete persisted activity snapshot and Runtime control path unchanged; `ToolShellDisplay` remains a continuous string renderer.

**Tech Stack:** TypeScript, Vue 3, Vue Test Utils, Vitest, Less.

## Global Constraints

- Do not stage or commit changes.
- All tools show only the activity status label; `running_idle` controls remain available.
- Do not modify `ChatToolActivityState`, Runtime activity events, watchdog behavior, persistence, or control actions.
- Do not modify `ToolShellDisplay`, `shellOutput`, or the continuous terminal-content data flow.
- Follow the repository TypeScript, comments, ESLint, Stylelint, and changelog requirements.

---

### Task 1: Reduce ToolActivity to status and controls

**Files:**

- Modify: `test/components/BChat/bubble-part-tool-activity.component.test.ts`
- Modify: `src/components/BChat/components/MessageBubble/BubblePartTool/ToolActivity.vue`
- Modify: `src/components/BChat/components/MessageBubble/BubblePartTool/index.vue`

**Interfaces:**

- Consumes: `ChatMessageToolPart.activity`, existing `activityLabel`, `showIdleControls`, `controlPending`, and the `control` event.
- Produces: a `ToolActivity` component whose Props are limited to `activity`, `activityLabel`, `showIdleControls`, and `controlPending`.

- [ ] **Step 1: Write the failing status-only test**

Replace the current progress-detail test with a status-only contract:

```ts
it('renders only persisted activity status labels', (): void => {
  const executing = mountTool(createPart('executing'));
  expect(executing.text()).toContain('执行中');
  expect(executing.text()).not.toContain('download');
  expect(executing.text()).not.toContain('4 / 10');
  expect(executing.text()).not.toContain('已下载 4 项');
  expect(executing.text()).not.toContain('1 分钟前有进展');

  const waitingUser = mountTool(createPart('waiting_user'));
  expect(waitingUser.text()).toContain('等待用户');
  expect(waitingUser.text()).not.toContain('请选择目标文件');

  const waitingExternal = mountTool(createPart('waiting_external'));
  expect(waitingExternal.text()).toContain('等待外部条件');
  expect(waitingExternal.text()).not.toContain('等待远端任务');

  const labels = new Map<NonNullable<ChatMessageToolPart['activity']>['state'], string>([
    ['running_idle', '仍在运行'],
    ['stopping', '正在停止'],
    ['interrupted', '已中断']
  ]);
  for (const [state, label] of labels) {
    expect(mountTool(createPart(state)).text()).toContain(label);
  }
});
```

The existing tests named `submits continue and stop actions for the exact runtime tool` and `hides idle controls without a runtime or after the tool is done` remain in the file and must continue to pass without assertion changes.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run test/components/BChat/bubble-part-tool-activity.component.test.ts
```

Expected: FAIL because phase, count, progress message, waiting reason, or elapsed-time text is still rendered.

- [ ] **Step 3: Simplify the ToolActivity template and Props**

Change `ToolActivity.vue` so the template contains only the status label and the existing action block:

```vue
<div :class="bem('activity', { [activityState]: true })">
  <span :class="bem('activity-state')">{{ activityLabel }}</span>
  <div v-if="showIdleControls" :class="bem('activity-actions')">
    <BButton
      type="secondary"
      size="mini"
      :disabled="controlPending !== null"
      :loading="controlPending === 'continue_waiting'"
      @click="emit('control', 'continue_waiting')"
    >
      继续等待
    </BButton>
    <BButton type="secondary" size="mini" danger :disabled="controlPending !== null" :loading="controlPending === 'stop'" @click="emit('control', 'stop')">
      停止
    </BButton>
  </div>
</div>
```

The Props interface becomes:

```ts
interface Props {
  /** Main 持久化的工具活动状态快照。 */
  activity: NonNullable<ChatMessageToolPart['activity']>;
  /** 当前活动状态文案。 */
  activityLabel: string;
  /** 是否展示继续等待和停止按钮。 */
  showIdleControls: boolean;
  /** 当前正在提交的控制动作。 */
  controlPending: ChatRuntimeControlToolInput['action'] | null;
}
```

Delete `activityPhase` and remove styles used only by the deleted header/count/phase/message/time nodes. Keep state background modifiers, `activity-state`, and `activity-actions` styles.

- [ ] **Step 4: Remove obsolete parent data preparation**

In `BubblePartTool/index.vue`, update the component call to:

```vue
<ToolActivity
  v-if="part.activity"
  :activity="part.activity"
  :activity-label="activityLabel"
  :show-idle-controls="showIdleControls"
  :control-pending="controlPending"
  @control="handleToolControl"
/>
```

Delete the `activityCount`, `activityMessage`, and `lastProgressText` computed values. Do not change `activityLabel`, `showIdleControls`, `handleToolControl`, or Shell computed values.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
pnpm exec vitest run test/components/BChat/bubble-part-tool-activity.component.test.ts
```

Expected: all activity tests PASS, including exact Runtime/toolCall control actions.

---

### Task 2: Record and verify the UI simplification

**Files:**

- Modify: `changelog/2026-08-07.md`
- Verify: `src/components/BChat/components/MessageBubble/BubblePartTool/ToolShellDisplay.vue` remains unchanged.

**Interfaces:**

- Consumes: Task 1’s status-only `ToolActivity` contract.
- Produces: changelog coverage and regression evidence for continuous Shell output.

- [ ] **Step 1: Update the changelog**

Add this entry under `## Changed`:

```md
- 精简 BChat 工具活动区域，所有工具仅显示当前状态，并保留空闲工具的继续等待与停止控制。
```

- [ ] **Step 2: Run focused activity and Shell regression tests**

Run:

```bash
pnpm exec vitest run test/components/BChat/bubble-part-tool-activity.component.test.ts test/components/BChat/bubble-part-tool-shell.test.ts --no-file-parallelism
```

Expected: both files PASS; Shell pipe output remains continuous and ordered.

- [ ] **Step 3: Run static verification**

Run:

```bash
pnpm exec tsc --noEmit
pnpm exec eslint src/components/BChat/components/MessageBubble/BubblePartTool/ToolActivity.vue src/components/BChat/components/MessageBubble/BubblePartTool/index.vue test/components/BChat/bubble-part-tool-activity.component.test.ts
pnpm exec stylelint 'src/components/BChat/components/MessageBubble/BubblePartTool/ToolActivity.vue'
```

Expected: every command exits with status 0.

- [ ] **Step 4: Review the final working tree**

Run:

```bash
git diff --check
git status --short
git diff --cached --name-only
git diff -- src/components/BChat/components/MessageBubble/BubblePartTool/ToolShellDisplay.vue
```

Expected: no whitespace errors, no staged files, and no `ToolShellDisplay.vue` diff. Preserve all previously existing user changes.
