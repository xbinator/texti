# Texti

Texti 是一款面向本地写作与 AI 工作流的 Markdown 桌面编辑器，基于 Tauri + Vue 3 + TypeScript 构建。

它把文档编辑、本地文件管理和多模型配置放在同一个桌面应用里，适合用于写作、知识整理、技术文档草稿和 AI 辅助内容生产。

## 🎯 这个项目是做什么的

Texti 的目标不是单纯做一个 Markdown 输入框，而是提供一套完整的桌面端写作体验：

- 用富文本与源码双视图编辑 Markdown 内容
- 通过本地文件能力管理文档、最近文件和自动保存
- 在设置中统一接入和管理多个 AI 服务商与模型
- 为后续 AI 辅助写作、生成、理解和模型能力扩展提供基础设施

如果用一句话概括，它更像是一个“支持多模型配置的本地优先 Markdown 写作工作台”。

## ✨ 特性

### 📝 强大的 Markdown 编辑
- **双视图编辑**: 富文本编辑 + 源码编辑无缝切换
- **丰富的格式支持**: 标题、列表、表格、代码块、任务列表等
- **代码高亮**: 支持多种编程语言的语法高亮
- **实时预览**: 所见即所得的编辑体验
- **公式支持**: 支持 LaTeX 数学公式渲染

### 🤖 AI 智能集成
- **多提供商支持**: OpenAI、Anthropic、Google 等主流 AI 服务
- **灵活模型配置**: 自定义模型参数、上下文窗口、能力配置
- **模型能力**: 视觉识别、深度思考、联网搜索、图片生成、视频识别
- **本地持久化**: 服务商配置和模型设置可保存在本地数据库中

### 🎨 优雅的用户界面
- **明暗主题**: 支持浅色/深色主题切换
- **现代化设计**: 基于 Ant Design Vue 的精美 UI
- **响应式布局**: 适配不同屏幕尺寸

### 💾 本地文件管理
- **文件操作**: 新建、打开、保存 Markdown 文件
- **最近文件**: 快速访问最近编辑的文件
- **自动保存**: 自动保存编辑内容，防止数据丢失

### ⌨️ 高效的快捷键
- 丰富的键盘快捷键支持
- 快捷键查询对话框

## 👥 适合谁使用

- 需要在本地桌面环境下写 Markdown 的用户
- 需要同时管理多个 AI 提供商 API 和模型的用户
- 希望把文档编辑与 AI 能力配置放在一个工具中的开发者或内容创作者

## 🧩 当前核心模块

- **编辑器**: 文档标题、正文、查找、视图切换、最近文件、快捷键
- **设置中心**: AI 服务商开关、API 配置、模型管理
- **本地存储**: 最近文件、本地配置、SQLite 持久化
- **桌面能力**: 基于 Tauri 的文件系统与原生运行能力

## 🛠️ 技术栈

| 技术 | 版本 | 说明 |
|------|------|------|
| Vue | 3.5.x | 前端框架 |
| TypeScript | 6.0.x | 类型安全 |
| Tauri | 2.x | 桌面应用框架 |
| Ant Design Vue | 4.2.x | UI 组件库 |
| TipTap | 3.21.x | 富文本编辑器 |
| Pinia | 3.0.x | 状态管理 |
| Vue Router | 4.6.x | 路由管理 |
| UnoCSS | 66.6.x | 原子化 CSS |
| SQLite | - | 本地数据库 |

## 🖥️ 运行形态

- 前端使用 Vue 3 构建交互界面
- 桌面端使用 Tauri 提供原生壳和本地能力
- 数据层同时使用浏览器侧存储和 Tauri SQLite 插件

这意味着 Texti 更偏“本地优先的桌面应用”，而不是纯在线编辑器。

## 🚀 快速开始

### 前置要求

- Node.js >= 18
- Rust (rustup + cargo)
- pnpm (推荐) 或 npm/yarn

### 安装依赖

```bash
pnpm install
```

### 开发模式

#### macOS / Linux

```bash
pnpm tauri dev
```

#### Windows

```bash
pnpm start:windows
```

### 构建生产版本

```bash
pnpm build
pnpm tauri build
```

### 代码检查

```bash
# ESLint 检查
pnpm lint

# Stylelint 检查
pnpm lint:style
```

## 📂 项目结构

```
texti/
├── src/
│   ├── components/          # 自定义组件
│   │   ├── BEditor/         # 编辑器核心组件
│   │   ├── BButton/         # 按钮组件
│   │   ├── BModal/          # 模态框组件
│   │   └── ...
│   ├── views/               # 页面视图
│   │   ├── editor/          # 编辑器页面
│   │   └── settings/        # 设置页面
│   ├── router/              # 路由配置
│   ├── stores/              # Pinia 状态管理
│   ├── utils/               # 工具函数
│   │   ├── native/          # 原生能力封装
│   │   └── storage/         # 存储相关
│   ├── hooks/               # 组合式函数
│   └── assets/              # 静态资源
├── src-tauri/               # Tauri Rust 后端
│   ├── src/
│   │   ├── commands/        # Tauri 命令
│   │   └── main.rs
│   └── Cargo.toml
├── changelog/               # 变更日志
├── openspec/                # 功能规范文档
└── ...
```

## 📖 开发指南

### 推荐 IDE 配置

- [VS Code](https://code.visualstudio.com/)
- [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar)
- [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

### 代码规范

项目遵循严格的代码规范，详见 [AGENTS.md](./AGENTS.md)：

- 禁止使用 `any` 类型
- 所有代码必须通过 ESLint 和 TypeScript 检查
- 使用 `strict` 模式
- 每次代码改动必须记录到 changelog

## 📌 当前状态

从现有代码结构来看，项目已经具备以下基础能力：

- Markdown 编辑器主界面
- 设置页与 AI 服务商配置页
- 多服务商和模型的基础抽象层
- Tauri 桌面端集成与本地数据存储

如果后续继续演进，README 中描述的 AI 工作流能力可以在现有架构上继续扩展。

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
