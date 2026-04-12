# 01-整体概览

## 项目定位

Texti 是一款“本地优先”的 Markdown 桌面编辑器：渲染进程提供编辑/设置 UI（Vue3），主进程提供本地文件、SQLite、加密存储与 AI 调用等能力（Electron）。

## 代码结构（按职责）

```text
texti/
├─ src/                         # 渲染进程（Vite + Vue3 + TS）
│  ├─ views/                    # 页面：editor / settings
│  ├─ components/               # 通用组件（BEditor 等）
│  ├─ shared/
│  │  ├─ platform/              # Electron/Web 平台能力抽象
│  │  └─ storage/               # Provider/ServiceModel 等存储适配
│  ├─ stores/                   # Pinia stores
│  └─ hooks/                    # 组合式 hooks（useAgent 等）
├─ electron/                    # 主进程 + preload（独立 tsconfig）
│  ├─ main/                     # Electron 主进程入口与模块
│  └─ preload/                  # contextBridge 暴露 API
├─ types/                       # 全局类型声明（Electron API / AI 类型等）
└─ changelog/                   # 变更日志（按日期）
```

## 核心工作流

### 编辑工作流

1. `src/views/editor/index.vue` 组装工具栏、文件打开/保存、查找等页面能力
2. `src/components/BEditor/*` 封装“富文本/源码”双视图、目录（heading anchors）、搜索高亮、front-matter
3. Electron 环境下文件读写通过 `window.electronAPI`（preload）→ IPC → 主进程模块完成

### AI 工作流

1. 设置页维护 Provider（服务商）与 Service Model（某业务能力选择哪个 provider+model+prompt）
2. 渲染进程通过 `useAgent` 封装的 `electronAPI.aiInvoke/aiStream` 发起请求
3. 主进程 `AIService` 调用 `ai` SDK（generateText/streamText），并通过 IPC 将流式 chunk 逐步推送回渲染进程

## 关键“入口/收口点”

| 入口/收口点 | 职责 | 位置 |
|---|---|---|
| 渲染进程入口 | 创建 Vue App、挂载 Router/Pinia/样式 | `src/main.ts` |
| 主进程入口 | 初始化 store / 数据库 / IPC handlers / 主窗口 | `electron/main/index.mts` |
| Bridge helper | 渲染进程统一访问 `window.electronAPI` | `src/shared/platform/electron-api.ts` |
| Preload API 面 | `contextBridge` 暴露 IPC 调用与事件订阅 | `electron/preload/index.mts` |
| Provider 存储接口 | Provider 列表与 CRUD（SQLite/Web fallback） | `src/shared/storage/providers/sqlite.ts` |
| ServiceModel 存储接口 | ServiceModel 配置与 legacy 迁移 | `src/shared/storage/service-models/sqlite.ts` |
| AI 主进程服务 | provider registry + 生成/流式生成 | `electron/main/modules/ai/service.mts` |
