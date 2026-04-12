# Texti Code Wiki

这是一套面向代码阅读与二次开发的 Wiki 文档，内容以“架构 → 模块 → 关键入口/收口点 → 依赖关系 → 运行方式”为主线，帮助快速定位代码与理解设计取舍。

## 目录

- [01-整体概览](./01-overview.md)
- [02-架构与运行时](./02-architecture.md)
- [03-前端（Vue）模块](./03-frontend.md)
- [04-编辑器（BEditor）](./04-editor.md)
- [05-Electron（主进程与 Preload）](./05-electron.md)
- [06-存储与数据库](./06-storage.md)
- [07-AI 模块](./07-ai.md)
- [08-开发与构建](./08-development.md)
- [09-依赖与调用关系图](./09-dependency-map.md)

## 快速定位

- 应用启动（渲染进程）：`src/main.ts`
- 应用启动（主进程）：`electron/main/index.mts`
- 桥接 API（渲染进程侧 helper）：`src/shared/platform/electron-api.ts`
- 桥接 API（preload 暴露面）：`electron/preload/index.mts`
- 编辑器主组件：`src/components/BEditor/index.vue`
- 设置中心（provider / service-model）：`src/views/settings/*`
