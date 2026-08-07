# Command Panel Question Menu Design

## Goal

Change `src/components/BCommandPanel` so users no longer use `>` to choose command modes. The `?` input opens a command menu, selecting a command writes a plain prefix such as `model ` or `chat `, and users may also type those prefixes directly.

## Current Behavior

`src/components/BCommandPanel/utils/query.ts` currently treats `?` as a hint source that exposes a single `>` jump item. The `>` source then offers `model` and `chat`, and selected jump items write values such as `> model ` back into the input.

## Target Behavior

- Empty or ordinary input continues to search recent records.
- Input `?` opens the command menu.
- The command menu contains `model` and `chat`.
- Selecting `model` writes `model ` into the input and routes to the model source.
- Selecting `chat` writes `chat ` into the input and routes to the chat source.
- Typing `model ` routes to the model source; the search keyword is the text after `model `.
- Typing `chat ` routes to the chat source; the search keyword is the text after `chat `.
- Typing `model` or `chat` without a trailing space remains ordinary recent-record search.
- The `>` command path is removed from parsing, source results, user-facing hints, and tests.

## Architecture

Keep the existing source abstraction. `hint.ts` becomes the command-menu source and returns two jump items whose `routeInput` values are `model` and `chat`. `query.ts` routes only exact `?` input to the hint source and routes plain command prefixes with trailing whitespace to `model` or `chat`.

The main component can keep the existing jump-item selection flow. Because jump items already append a trailing space through `handleSelectItem`, changing `routeInput` from `> model` to `model` produces the desired `model ` value without new component state.

## Data Flow

1. User types in the command input.
2. `parseCommandPanelQuery(scope, keyword)` returns the active source and keyword.
3. `index.vue` loads and searches the matching source.
4. If the user selects a jump item from the `?` menu, `handleSelectItem` writes `${item.routeInput} ` to the store keyword.
5. The existing keyword watcher refreshes results for the new route.

## Error Handling

This change does not add new asynchronous behavior. Existing `asyncTo` handling in `index.vue` continues to contain source load, search, selection, and removal errors.

## Testing

Update `test/components/BCommandPanel/query.test.ts` to cover `?`, `model `, `chat `, no-space `model` and no-space `chat`, and removal of `>` routing. Update `test/components/BCommandPanel/sources.test.ts` for the new command menu items. Update `test/components/BCommandPanel/index.test.ts` for selecting `model` from `?` and ensuring direct prefix input routes correctly.
