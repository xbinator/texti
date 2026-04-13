# Tasks
- [x] Task 1: 扩展消息类型定义: 在 `src/components/BChat/types.ts` 中更新 `Message` 接口，增加唯一 ID、多模态支持（如图片列表）以及操作相关的回调类型。
- [x] Task 2: 创建 `Messages` 组件: 接收 `Message[]` 数组，循环渲染列表数据。利用现有的 `BBubbleText` 组件渲染气泡和内容，实现 hover 时显示操作栏（复制、编辑、删除、重新生成），并透传这些交互事件。
- [x] Task 3: 集成到主视图: 在 `src/components/BChat/index.vue` 中引入 `Messages` 组件，结合现有的 `Container.vue` 展示消息流，并补充基础交互逻辑的框架。

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 2
