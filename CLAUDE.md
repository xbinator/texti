# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
pnpm dev                    # Vite dev server only (port 1420)
pnpm electron:dev           # Full Electron dev mode (Vite + main watch + Electron run)

# Build
pnpm build                  # TypeScript check + Vite build to dist/
pnpm electron:build         # Full production build (web + Electron packaging)
pnpm electron:build-main    # Compile Electron main process only

# Lint
pnpm lint                   # ESLint fix on .vue/.ts/.tsx/.js/.jsx files
pnpm lint:style             # StyleLint fix on .vue/.less/.css files
```

No test runner is configured.

## Architecture

**Tibis** is a local-first desktop Markdown editor built with Electron + Vue 3 + TypeScript.

### Process Separation

**Electron Main** (`electron/main/`) handles all privileged operations via IPC modules:
- `ai/` — streaming AI text generation using the `ai` SDK (OpenAI/Anthropic/Google)
- `database/` — SQLite via `better-sqlite3`
- `file/` — file watch with chokidar
- `store/` — `electron-store` for sensitive/config data
- `dialog/`, `menu/`, `shell/`, `window/` — native desktop APIs

**Preload** (`electron/preload/index.mts`) exposes a typed `contextBridge` API. All IPC calls from the renderer go through `src/shared/platform/electron-api.ts` which wraps `window.electronAPI` safely.

**Renderer** (`src/`) is a standard Vue 3 SPA served by Vite.

### Frontend Architecture

- **Router**: Two top-level routes — `/` (Editor) and `/settings` (Settings with nested provider/service-model routes)
- **State**: Pinia stores in `src/stores/` — `setting.ts` (theme), `service-model.ts` (AI service config), `tabs.ts` (multi-tab state with localStorage persistence)
- **Storage layer** (`src/shared/storage/`): `providers/` and `service-models/` use SQLite via Electron IPC; `files/` uses localStorage
- **Platform abstraction** (`src/shared/platform/`): `env.ts` for environment detection, `native/` for capability switching between Electron and web

### Key Components

- `BEditor/` — TipTap-based rich text editor (headings, tables, code, math/KaTeX, images)
- `BChat/` — Chat interface for AI interactions
- `BLayout/` — App shell with header tabs and panel layout
- `BPanelSplitter/` — Resizable panels

### CSS / Styling

UnoCSS (`uno.config.ts`) with Wind3 + Attributify presets. Ant Design Vue is used for UI components. Theme colors are CSS variables consumed by UnoCSS custom rules.

## Code Standards (from AGENTS.md)

- **No `any` type** — use `unknown` or specific types; use `interface` extension or type assertions instead
- All function parameters and return values must have explicit type annotations
- Use `import type` for type-only imports
- All code must pass ESLint and TypeScript strict mode checks

## Changelog

Every code change requires a changelog entry in `changelog/YYYY-MM-DD.md`:

```markdown
# YYYY-MM-DD

## Added
- [new feature description]

## Changed
- [modification description]

## Removed
- [removal description]
```

If the file for today doesn't exist, create it. If it does, append to the relevant section.
