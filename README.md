# Tauri + Vue + TypeScript

This template should help get you started developing with Vue 3 and TypeScript in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

Windows Development Bootstrap (Rust toolchain verification)

- This project assumes Rust toolchain (rustup + cargo) is installed and on PATH for Windows.
- A bootstrap script is added to help verify and guide installation before starting the Tauri dev flow:
- New script: scripts/windows_rust_bootstrap.ps1
- New npm script: npm run start:windows (or pnpm start:windows) to bootstrap and start tauri dev.
- Typical dev flow on Windows:
  1. Run: npm run start:windows
  2. If Rust is installed, it will proceed to start tauri dev.
  3. If not installed, you will receive guidance to install Rust via rustup.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
