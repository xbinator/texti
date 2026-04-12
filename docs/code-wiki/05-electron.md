# 05-Electron（主进程与 Preload）

## 主进程入口

- `electron/main/index.mts`
  - `bootstrap()` 负责初始化与编排：logger → store → migrate → database → IPC handlers → window

## 窗口管理

- `electron/main/window.mts`
  - `createWindow()`：创建无边框窗口（`frame: false`），开启 `contextIsolation: true`，禁用 `nodeIntegration`
  - Dev 环境：`loadURL('http://localhost:1420')` + `openDevTools()`
  - Prod 环境：`loadFile(dist/index.html)`

## 主进程模块化（IPC handlers）

`electron/main/modules/` 以“能力模块”组织 IPC：

- `modules/index.mts`：统一注册 `registerAllIpcHandlers()`
- dialog：`modules/dialog/ipc.mts`
- file：`modules/file/ipc.mts`
- window：`modules/window/ipc.mts`
- database：`modules/database/ipc.mts`（调用 `database/service.mts`）
- store：`modules/store/ipc.mts`（调用 `store/service.mts`）
- shell：`modules/shell/ipc.mts`
- ai：`modules/ai/ipc.mts`（调用 `ai/service.mts`）
- logger：`modules/logger/*`（`electron-log`）

这层的设计目的：

- IPC 通道集中管理，避免散落在各处导致命名冲突
- service 与 ipc 分离：service 负责纯逻辑，ipc 负责通道映射与参数校验

## Preload（contextBridge）

- `electron/preload/index.mts`
  - 通过 `contextBridge.exposeInMainWorld('electronAPI', electronAPI)` 暴露 API
  - IPC 交互范式：
    - request/response：`ipcRenderer.invoke(channel, ...args)`
    - event stream：`ipcRenderer.on(channel, handler)` + 返回 unsubscribe

### Preload 暴露的关键通道

| 能力 | 渲染进程 API | 主进程通道 |
|---|---|---|
| 打开/保存文件 | `openFile` / `saveFile` | `dialog:openFile` / `dialog:saveFile` |
| 写文件 | `writeFile` | `fs:writeFile` |
| 窗口控制 | `setWindowTitle` / `windowMinimize` 等 | `window:*` |
| SQLite | `dbSelect` / `dbExecute` | `db:select` / `db:execute` |
| 加密存储 | `storeGet` / `storeSet` / `storeDelete` | `store:*` |
| 打开外链 | `openExternal` | `shell:openExternal` |
| AI | `aiInvoke` / `aiStream` | `ai:invoke` / `ai:stream` |
| AI 流式事件 | `onAiStreamChunk/Complete/Error` | `ai:stream:*`（send 到渲染） |

## 安全边界

- `contextIsolation: true`：渲染进程无法直接访问 Node API
- 只暴露必要能力：渲染进程通过 typed API 调用，不直接用 `ipcRenderer`
- 类型收口：`types/electron-api.d.ts` 定义渲染进程可见的 API 面
