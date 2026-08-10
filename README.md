# Tibis

Tibis 是一款**Markdown 桌面编辑器**，数据保存在你的电脑上，并将 AI 对话与文档编辑深度集成。

适合写作、知识整理、技术文档草稿和 AI 辅助内容生产。

![Tibis 界面截图](https://github.com/user-attachments/assets/de65140e-7d7d-40e6-b5da-d81876e71987)

## 核心亮点

- **双视图编辑器** — 富文本（TipTap）与源码（CodeMirror）无缝切换，所见即所得 + 精确控制
- **AI 聊天侧边栏** — 流式对话、工具调用、上下文压缩，模型随时辅助写作
- **多 AI 服务商支持** — OpenAI / Anthropic / Google / DeepSeek，可自由切换和配置
- **MCP 工具集成** — 支持 Model Context Protocol，AI 可操作文件、执行命令、读写编辑器内容
- **技能系统** — 可注册自定义技能，扩展 AI 的写作和编辑能力
- **提示词编辑器** — 斜杠命令 `/`、文件引用 `@`，快速构建复杂提示词
- **本地优先** — SQLite 持久化 + 加密存储，数据归你所有

## 界面预览

应用围绕三个核心界面展开：

| 界面 | 说明 |
|------|------|
| 编辑器页面 | Markdown 双视图编辑 + AI 侧边栏 + 文件标签页 |
| 设置中心 | 服务商配置、模型分配、MCP 管理、技能注册 |
| 欢迎页 | 拖拽打开文件、最近文件列表 |

## 技术栈

| 技术 | 说明 |
|------|------|
| 桌面框架 | Electron 41 |
| 前端框架 | Vue 3.5 + Composition API |
| 构建工具 | Vite 8（Rolldown） |
| 语言 | TypeScript 5.9（strict） |
| 状态管理 | Pinia 3 |
| 路由 | Vue Router 5（Hash + KeepAlive） |
| 富文本编辑器 | TipTap 3（ProseMirror） |
| 源码编辑器 | CodeMirror 6 |
| UI 组件库 | Ant Design Vue 4 + UnoCSS |
| AI SDK | Vercel AI SDK v6 |
| MCP 协议 | @modelcontextprotocol/sdk |
| 数据库 | better-sqlite3 |
| 安全存储 | electron-store（API Key 加密） |
| 图片处理 | sharp |
| Markdown 渲染 | marked + KaTeX + Mermaid |

## 快速开始

### 前置要求

- Node.js >= 22
- pnpm（推荐）

### 安装与运行

```bash
# 安装依赖
pnpm install

# 启动开发模式（前端 + Electron 桌面应用）
pnpm dev

# 仅启动前端开发服务（浏览器预览）
pnpm serve
```

`pnpm dev` 会并行启动 Vite 前端服务、Electron 主进程编译和桌面窗口。

### 构建

```bash
pnpm build
pnpm electron:build
```

产物会生成在 `dist-electron/` 目录下。

### 代码检查

```bash
pnpm lint          # ESLint 检查 + 自动修复
pnpm lint:style    # Stylelint 检查 + 自动修复
pnpm exec tsc --noEmit  # TypeScript 类型检查
```

## 下载

从 [GitHub Releases](https://github.com/xbinator/tibis/releases) 下载最新版本：

- macOS：`.dmg`
- Windows：`.exe`
- Linux：`.AppImage` / `.deb`

> macOS 首次打开可能提示无法验证开发者，请在系统设置中允许打开。若安装后仍提示无法打开，可在终端执行：
>
> ```bash
> xattr -dr com.apple.quarantine /Applications/Tibis.app
> ```
>
> Windows 可能触发 SmartScreen，确认来源后继续运行即可。

## 项目结构

```text
tibis/
├── src/                    # 渲染进程（Vue 前端）
│   ├── views/              # 页面视图（editor / settings / welcome / webview）
│   ├── components/         # 通用组件（BEditor / BChatSidebar / BPromptEditor 等）
│   ├── stores/             # Pinia 状态管理
│   ├── ai/                 # AI 子系统（工具 / 记忆 / 技能）
│   ├── hooks/              # 组合式函数
│   ├── shared/             # 平台抽象 / 存储 / 日志
│   └── utils/              # 工具函数
├── electron/               # 主进程 + preload
│   ├── main/modules/       # IPC 模块（15 个）
│   └── preload/            # contextBridge 安全桥接
├── types/                  # 全局类型声明
├── test/                   # 测试套件（100+ 测试文件）
├── docs/                   # 项目文档
├── changelog/              # 变更日志
└── scripts/                # 构建与工具脚本
```

## 许可证

MIT License

## 致谢

感谢 [FCDFW](https://github.com/FCDFW) 的大力 token 支持，为项目的 AI 模型调试与功能开发提供了重要的算力保障。

## 贡献

欢迎提交 Issue 和 Pull Request。
