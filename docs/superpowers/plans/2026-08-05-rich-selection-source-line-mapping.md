# Rich Selection Source Line Mapping Implementation Plan

**Goal:** Rich 编辑器选区始终生成可验证的 Markdown 物理行号，源码存在时不再回退到不兼容的 parser attrs 坐标。

**Architecture:** 共享 Rich 行内解析语义，分别构建 Markdown 物理文本行与 ProseMirror 文本行，再按顶层块、文本和顺序双向对齐。源码存在但无法证明映射时失败关闭。

**Tech Stack:** TypeScript、Vue 3、Tiptap/ProseMirror、marked、Vitest、pnpm

## Constraints

- 不修改聊天文件引用协议或聊天渲染路径。
- 不使用 any。
- 所有新增函数、接口和复杂逻辑添加意图注释。
- 函数名不超过四个单词。
- 记录 changelog/2026-08-05.md。

## Task 1：复现与根因

- [x] 用真实 Rich parser 构造第 99 行行内格式复现。
- [x] 证明精确 Markdown 映射返回 null 后错误回退到 attrs 第 59 行。
- [x] 添加 Markdown 存在时失败关闭、源码为空时允许 attrs 的策略测试。

## Task 2：共享行内语义

- [x] 新增 src/components/BEditor/utils/markdownInlineSemantics.ts。
- [x] 统一引用链接、显式链接、自动链接和嵌套 mark 的可见文本。
- [x] 统一安全 HTML、硬换行、图片、批注、数学公式和实体规则。
- [x] 让 src/components/BEditor/hooks/useExtensions.ts 复用链接与安全 HTML 常量。

## Task 3：逐物理行双向映射

- [x] 为 Markdown token 构建物理文本行。
- [x] 为 ProseMirror textblock 构建绝对位置文本行。
- [x] 正向映射仅聚合与 Rich 选区相交的已对齐行。
- [x] 反向映射仅返回目标源码行对应的已对齐 Rich 位置。
- [x] Markdown 存在时禁止 attrs 回退。

## Task 4：结构边界加固

- [x] 修复 CRLF 和文档开头连续空行计数。
- [x] 修复围栏代码首行、内部空行和未闭合围栏。
- [x] 修复引用、列表、任务列表、续行和嵌套格式。
- [x] 修复表格单元格、硬换行、图片和嵌套表格。
- [x] 修复引用定义、HTML 实体、批注及数学公式造成的语义漂移。

## Task 5：重复审计

- [x] 第一轮 96 个断言发现 40 个失败并修复。
- [x] 第二轮扩大到 144 个断言，发现开头空行和实体问题并修复。
- [x] 第三轮扩大到 170 个断言，发现容器 AST 与代码空行问题并修复。
- [x] 第四轮扩大到 202 个断言，发现实体边界和表格硬换行问题并修复。
- [x] 第五轮扩大到 218 个断言，发现数学公式和嵌套表格问题并修复。

## Task 6：最终验证

- [x] 用用户提供的深圳行程文件重新验证目标文本为第 99 行。
- [x] 运行相关和全量 Vitest。
- [x] 运行 ESLint、Stylelint、TypeScript 和 git diff 检查。
- [x] 检查性能及最终 diff 范围。
