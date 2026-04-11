# Texti

Texti 是一款面向本地写作与 AI 工作流的 Markdown 桌面编辑器，基于 Electron + Vue 3 + TypeScript 构建。

它把文档编辑、本地文件管理和多模型配置放在同一个桌面应用里，适合用于写作、知识整理、技术文档草稿和 AI 辅助内容生产。

## 项目目标

Texti 的目标不是单纯做一个 Markdown 输入框，而是提供一套完整的桌面端写作体验：

- 用富文本与源码双视图编辑 Markdown 内容
- 通过本地文件能力管理文档、最近文件和自动保存
- 在设置中统一接入和管理多个 AI 服务商与模型
- 为后续 AI 辅助写作、生成、理解和模型能力扩展提供基础设施

如果用一句话概括，它更像是一个“支持多模型配置的本地优先 Markdown 写作工作台”。

## 特性

### Markdown 编辑

- 双视图编辑：富文本编辑 + 源码编辑无缝切换
- 丰富格式支持：标题、列表、表格、代码块、任务列表等
- 代码高亮：支持多种编程语言的语法高亮
- 公式支持：支持 LaTeX 数学公式渲染
- 编辑器能力：查找、最近文件、快捷键、自动保存

### AI 集成

- 多提供商支持：OpenAI、Anthropic、Google 等主流 AI 服务
- 灵活模型配置：统一管理 Provider、模型、可用性和自定义配置
- 本地持久化：服务商与服务模型配置可保存在本地数据库中

### 桌面能力

- 基于 Electron 的桌面壳
- 通过 preload 暴露文件、窗口、数据库、store 等原生能力
- 支持本地 SQLite 与 Electron store

### 界面体验

- 明暗主题切换
- 基于 Ant Design Vue 的桌面 UI
- 适配编辑器与设置中心两类主要工作流

## 当前核心模块

- 编辑器：文档标题、正文、查找、视图切换、最近文件、快捷键
- 设置中心：AI 服务商开关、API 配置、模型管理
- 本地存储：最近文件、本地配置、SQLite 持久化
- AI 服务层：多 Provider 抽象、模型解析、流式文本生成
- 桌面桥接：Electron preload、窗口能力、数据库 IPC、store IPC

## 技术栈

| 技术 | 版本 | 说明 |
|------|------|------|
| Vue | 3.5.x | 前端框架 |
| TypeScript | 6.0.x | 类型安全 |
| Electron | 34.x | 桌面应用框架 |
| Ant Design Vue | 4.2.x | UI 组件库 |
| TipTap | 3.21.x | 富文本编辑器 |
| Pinia | 3.0.x | 状态管理 |
| Vue Router | 4.6.x | 路由管理 |
| UnoCSS | 66.6.x | 原子化 CSS |
| SQLite | - | 本地数据库 |

## 运行形态

- 前端使用 Vue 3 构建交互界面
- 桌面端使用 Electron 提供原生壳、本地文件能力和预加载桥接
- 数据层同时支持浏览器侧存储与 Electron 侧 SQLite / store

这意味着 Texti 更偏“本地优先的桌面应用”，而不是纯在线编辑器。

## 快速开始

### 前置要求

- Node.js >= 18
- pnpm（推荐）或 npm / yarn

### 安装依赖

```bash
pnpm install
```

如果本地 Electron 二进制缺失，可以补执行：

```bash
node node_modules/.pnpm/electron@34.5.8/node_modules/electron/install.js
```

### 开发模式

#### 前端开发

```bash
pnpm dev
```

默认启动在 [http://localhost:1420/](http://localhost:1420/)。

#### Electron 桌面开发

```bash
pnpm electron:dev
```

这个命令会并行启动：

- Vite 前端开发服务
- Electron 主进程 / preload TypeScript watch 编译
- Electron 桌面应用

### 构建生产版本

```bash
pnpm build
pnpm electron:build
```

### 代码检查

```bash
pnpm exec tsc --noEmit
pnpm exec eslint src --ext .vue,.ts,.tsx,.js,.jsx
pnpm lint:style
```

## 项目结构

```text
texti/
├── electron/                # Electron 主进程与 preload 源码
│   ├── main/
│   ├── preload/
│   ├── package.json         # dist-electron 的 CommonJS 边界
│   └── tsconfig.json        # Electron 独立编译配置
├── src/
│   ├── components/          # 通用组件
│   │   ├── BEditor/         # 编辑器核心组件
│   │   ├── BButton/
│   │   ├── BModal/
│   │   └── ...
│   ├── views/               # 页面视图与页面级逻辑
│   │   ├── editor/
│   │   └── settings/
│   ├── shared/              # 跨页面共享能力
│   │   ├── platform/        # Electron / Web 平台能力封装
│   │   └── storage/         # localforage / SQLite / store
│   ├── services/            # 业务服务层
│   │   └── ai/              # AI provider 抽象与调用入口
│   ├── router/              # 路由配置
│   ├── stores/              # Pinia 状态管理
│   ├── hooks/               # 组合式函数
│   ├── utils/               # 通用工具
│   └── assets/              # 静态资源
├── dist-electron/           # Electron 编译产物（生成目录）
├── changelog/               # 变更日志
└── ...
```

## 开发说明

### Electron 桥接

项目通过 `types/electron-api.d.ts` 维护 Electron 桥接类型，并通过 `src/shared/platform/electron-api.ts` 统一暴露运行时访问 helper：

- `ElectronAPI`
- `getElectronAPI()`
- `hasElectronAPI()`

所有原生桥接调用都应该通过这个 helper 收口，不建议直接在业务代码里访问裸 `window.electronAPI`。

### 目录约定

- `src/views` 放页面和页面级逻辑
- `src/components` 放通用组件
- `src/shared/platform` 放平台能力封装
- `src/shared/storage` 放本地存储与数据库访问
- `src/services/ai` 放 AI 服务抽象

### 代码规范

项目遵循严格的代码规范，详见 [AGENTS.md](./AGENTS.md)：

- 禁止使用 `any`
- 所有代码必须通过 ESLint 和 TypeScript 检查
- 使用 `strict` 模式
- 每次改动需要补充 changelog

## 当前状态

当前项目已经具备以下基础能力：

- Markdown 编辑器主界面
- 设置页与 AI 服务商配置页
- 多服务商和模型的基础抽象层
- Electron 桌面端集成与本地数据存储
- preload 桥接、SQLite、本地 store 三类原生能力打通

如果后续继续演进，README 中描述的 AI 工作流能力可以在现有架构上继续扩展。

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request。
