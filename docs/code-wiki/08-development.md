# 08-开发与构建

## 环境要求

- Node.js >= 18
- pnpm（推荐）

## 常用命令（package.json scripts）

```bash
pnpm install

# 仅前端（Vite）
pnpm dev

# Electron 桌面开发（并行：vite + electron tsc watch + electron run）
pnpm electron:dev

# 生产构建（前端）
pnpm build

# 生产打包（electron-builder）
pnpm electron:build
```

脚本定义见：`package.json`。

## 开发模式运行形态

### 前端 dev server

- Vite 默认端口：1420（见 `vite.config.ts`）
- Electron dev 模式下主窗口会加载 `http://localhost:1420`

### Electron dev

- `electron:watch-main`：`tsc -p electron/tsconfig.json -w` 输出到 `dist-electron/`
- `electron:run`：等待 `dist-electron/main/index.mjs` 存在后启动 Electron，并监控 `dist-electron` 变化自动重启

## 代码质量与检查

```bash
pnpm exec tsc --noEmit
pnpm exec eslint src --ext .vue,.ts,.tsx,.js,.jsx
pnpm lint:style
```

## 调试建议

- UI 调试：Electron dev 默认会打开 devtools（`electron/main/window.mts`）
- 主进程日志：使用 `electron-log` 输出到控制台（并提供 IPC logger 通道给渲染进程）
- IPC 调试：
  - 从渲染进程侧检查 `window.electronAPI` 是否存在（建议通过 `hasElectronAPI()`）
  - 需要新增通道时遵循现有模块化约定：`electron/main/modules/<capability>/{service,ipc}.mts`
