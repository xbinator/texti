# Overworld Theme QA Checklist

## Setup

- Start the app locally.
- Set theme preset to `overworld`.
- Check light mode and dark mode.

## Screens

- Chat screen: input composer, model selector, session history, question card, confirmation sheet.
- Default layout: header buttons, tabs, update notice, tab context menu, shortcuts help, right chat sider.
- Welcome, chat, skill, and widget page shells.
- Settings basic page: theme selector and controls.
- Provider/settings tools: provider cards, model rows, search/sidebar controls, logger timeline, MCP tools, memory, skill, and widget management pages.
- Editor: command panel, toolbar menus, code block surfaces, selection toolbar.
- Editor deep blocks: math, table, image, frontmatter, find bar, link popover, comment card.
- Widget/Webview panels: sidebars, toolbars, inspector, address bar, agent activity overlay.
- Webview element picker overlay inside the loaded page.
- Utility viewers: color picker panel, image viewer controls, JSON viewer detail modal.

## Visual Checks

- Cobalt primary color is visible in primary actions and selection states.
- Control, surface, and overlay corners are square in Overworld.
- Control, surface, and overlay borders read as 2px pixel edges where applicable.
- Input fields use paper-like fill, square corners, thick ink borders, readable placeholder color, and optional keycap styling where the component exposes a shortcut hint.
- Buttons and selectable options show hard-shadow press feedback after Task 9.
- Text remains readable with the Overworld font stack.
- No text overlaps or clips after thicker borders.
- Ant Design controls match custom components for radius and border weight after Task 10.
- Markdown-rendered content, editor content blocks, widget/webview chrome, and utility viewers do not retain isolated modern 4px/6px/8px corners.
- Page shells, default layout chrome, settings tool pages, and Webview element picker injection follow the same token contract.

## Findings

- Not run yet in this implementation pass. Run the setup above and record concrete file references for every visual mismatch.
