# Chat Slash Commands Design

## Overview

Add first-class slash commands to the chat sidebar input so users can trigger high-frequency chat actions from the keyboard. The first version only activates when `/` appears at the start of a line and supports action-style commands instead of prompt templates.

This design keeps the existing toolbar entry points intact and adds a keyboard-first command surface on top of them. It also preserves a clean path for a future second phase where slash commands can insert prompt templates into the editor.

## Goals

- Support a unified slash command menu inside the chat input.
- Trigger only when `/` is typed at line start.
- Execute action commands without sending `/command` as a user message.
- Keep the editor responsible for command discovery and keyboard interaction.
- Keep `BChatSidebar` responsible for chat-specific business actions.
- Make the command model extensible for future prompt-template commands.

## Non-Goals

- No free-form command parser in v1.
- No slash trigger in the middle of a line.
- No remote command loading or user-defined commands.
- No direct model switching from the slash list in v1.
- No prompt-template insertion behavior in v1, only an extensible foundation for it.

## First-Version Commands

The first release exposes four action commands:

| Command | Type | Behavior |
| --- | --- | --- |
| `/model` | `action` | Open the existing model selector UI. |
| `/usage` | `action` | Show current session token usage. |
| `/new` | `action` | Create a new session by reusing the existing new-session flow. |
| `/clear` | `action` | Clear the current editor content and draft file references only. |

## User Experience

### Trigger Rules

- The slash menu opens only when `/` is typed at the start of a line.
- "Start of a line" means either:
  - The first character in the document.
  - The first character after a newline.
- The menu remains open while the user continues typing a slash query on the same line.
- If the user moves the cursor away from the active slash range, the menu closes.
- If the content no longer matches the slash trigger rule, the menu closes.

### Keyboard Behavior

- `ArrowUp` and `ArrowDown` move the active command.
- `Enter` executes the highlighted command.
- `Escape` closes the menu without modifying editor content.
- `Shift+Enter` always inserts a newline and does not execute a command.
- If the slash menu is not open, existing editor submit behavior stays unchanged.

### Execution Semantics

- Selecting an action command removes the active slash text from the editor before executing the command.
- Action commands do not create a chat message.
- `/clear` clears only the current draft input state.
- `/new` follows the same loading guards as the existing new-session button.
- `/model` opens the same model-selection surface that is already reachable from the toolbar.
- `/usage` opens a lightweight usage display scoped to the current session.

## Architecture

### Command Registry

Create a dedicated slash command registry for chat sidebar commands. Each command should declare presentation metadata and execution type.

Suggested shape:

```ts
interface ChatSlashCommand {
  /** Stable command id, such as "model" */
  id: string;
  /** Full trigger text, such as "/model" */
  trigger: string;
  /** User-facing title */
  title: string;
  /** Short helper description shown in the menu */
  description: string;
  /** Action for v1, prompt reserved for v2 */
  type: 'action' | 'prompt';
}
```

The registry should be a plain data module so it can be reused by:

- the editor trigger UI
- sidebar command execution
- future tests

### Editor Responsibility

`BPromptEditor` should own:

- detecting the slash trigger
- maintaining slash menu visibility
- filtering command candidates by query text
- positioning the menu
- keyboard navigation
- emitting a selected command event

The editor should not know how chat actions are implemented. It only reports which command the user chose and removes the temporary slash text from the document when appropriate.

### Sidebar Responsibility

`BChatSidebar` should own:

- mapping selected slash commands to chat behaviors
- opening model selection
- opening usage view
- reusing `handleNewSession()`
- clearing `inputValue` and `draftReferences`

This keeps chat business logic in the sidebar instead of pushing it into the general-purpose editor component.

## Component Changes

### `src/components/BPromptEditor/index.vue`

Add a second trigger flow alongside the existing variable trigger flow. The slash trigger should:

- inspect the current line and cursor position
- match only line-start slash patterns
- surface a command picker UI
- expose a new emit such as `slash-command`
- remove the active slash token before emitting the selected command

The implementation should avoid coupling to chat-only data structures. Pass command options in through props rather than hardcoding them in the editor.

### `src/components/BChatSidebar/index.vue`

Add:

- slash command option data wiring
- a handler for slash command selection
- action implementations for `/model`, `/usage`, `/new`, `/clear`

The component should continue to own loading guards and session side effects.

### Usage Display

`/usage` needs a visible session-scoped output. The preferred v1 behavior is a lightweight popover or modal opened from the chat sidebar. The content should show:

- input tokens
- output tokens
- total tokens

If the current session has no recorded usage yet, show an empty-state message instead of failing silently.

## Data Flow

1. User types `/` at line start in `BPromptEditor`.
2. The editor opens the slash command menu and filters candidates by the trailing query.
3. User confirms a command with keyboard input.
4. The editor removes the active slash text and emits the selected command id.
5. `BChatSidebar` receives the event and dispatches by command id.
6. The selected action updates UI state without sending a message.

## Future Compatibility With Prompt Commands

The registry must support a future `prompt` command type so both command styles can share one menu. The future behavior should be:

- `action` commands execute immediately.
- `prompt` commands insert text into the editor and keep focus in the input.

That compatibility requirement affects v1 in two places:

- the registry must include `type`
- the event payload should carry the full command object or a stable command id that can be resolved back to the command definition

This lets phase two add prompt-template commands without replacing the menu system.

## Error Handling

- If a slash command is selected but cannot execute because the sidebar is in a guarded state, no message should be sent and the UI should remain stable.
- `/new` should no-op while streaming, matching the current new-session guard.
- `/usage` should show a clear empty state when no session or no usage data is available.
- `/model` should fail safely if the model selector cannot open, without corrupting editor state.

## Testing Strategy

Add tests in two layers.

### Editor Tests

Cover:

- slash menu opens only at line start
- slash menu does not open in the middle of a line
- arrow key navigation works
- enter emits the selected command
- selecting a command removes the slash token
- existing submit behavior still works when the slash menu is closed

### Sidebar Tests

Cover:

- `/new` reuses existing new-session flow
- `/clear` resets input value and draft references only
- `/usage` resolves current session usage correctly
- `/model` triggers the model-selection open flow

## Open Implementation Decisions

These decisions are intentionally resolved for v1 to avoid ambiguity:

- The slash trigger is line-start only.
- The first version ships action commands only.
- The registry is shared, even before prompt commands exist.
- Slash commands complement the existing toolbar instead of replacing it.

## Recommended Implementation Order

1. Add the shared slash command registry.
2. Extend `BPromptEditor` with slash trigger state and selection emit.
3. Handle command execution in `BChatSidebar`.
4. Add a lightweight usage display.
5. Add regression tests for editor and sidebar behaviors.
