# Ask User Choice Remaining Work

> **Current branch:** `codex/ask-user-choice-tool`

## Completed

- Phase 1: Added `awaiting_user_input` as a terminal tool execution status.
- Phase 1: Added choice-question payload types and `createAwaitingUserInputResult()`.
- Phase 1: Tightened tool execution result typing into a discriminated union.
- Phase 2: Added the builtin `ask_user_choice` executor.
- Phase 2: Registered `ask_user_choice` in the default readonly builtin tool catalog.
- Phase 2: Added execution-time validation for pending-question conflicts, invalid modes, option limits, invalid options, `allowOther` defaulting, and `maxSelections` rules.
- Phase 2: Passed spec compliance review after the validation fixes.
- Phase 2 review follow-up: Replaced renderer-unsafe `node:crypto` UUID usage with an injectable/nanoid question ID provider.
- Phase 2 review follow-up: Wired `createBuiltinTools()` to host pending-question state instead of always returning null.
- Phase 3: Injected `toolCallId` into `awaiting_user_input` results in the stream execution path while keeping stream behavior terminal and non-blocking.
- Phase 4: Added BChat message helpers so submitted user-choice answers flow back through the existing tool result channel.
- Phase 5: Added the ask-user-choice interaction card with single choice, multiple choice, max-selection limiting, and optional manual input.
- Phase 6: Connected answer submission to pending-state clearing and next-round generation.
- Phase 7: Updated changelog entries and ran targeted AI tool and BChat regression suites plus `pnpm build`.

## Remaining

- No known implementation tasks remain for the scoped `ask_user_choice` plan.

## Suggested Next Step

Do a manual chat smoke test with a model that calls `ask_user_choice`, then decide whether to add richer styling or persisted answer-edit affordances.
