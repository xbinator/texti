# Rich 选区源码行号映射加固设计

## 背景

Rich 编辑器把 ProseMirror 选区转换为聊天文件引用时，原实现会先尝试 Markdown 映射，失败后回退到节点 sourceLineStart / sourceLineEnd。Markdown token 原文、Rich 可见文本和 parser attrs 分属不同坐标语义；行内格式、空白 token、围栏、列表或表格均可能让精确映射失败，并把源码第 99 行误报为第 59 行。

## 目标

- Rich 模式选择文本时，引用使用 Markdown 原文中的真实物理行号。
- 支持段落、标题、代码、引用、列表、表格及其嵌套结构。
- 正向选区映射和反向源码跳转使用同一套可验证语义。
- 原始 Markdown 存在但无法证明精确对齐时失败关闭，绝不混用 parser attrs 猜测。
- 保持聊天文件引用协议和聊天展示逻辑不变。

## 非目标

- 不修改聊天输入组件和文件引用 token 格式。
- 不用选中文字做全文模糊搜索。
- 不让不可见的 Markdown 空白行伪装成可见 Rich 文本范围。

## 设计

### 共享行内语义

src/components/BEditor/utils/markdownInlineSemantics.ts 集中定义 Rich Markdown 解析和源码映射共同使用的规则：

- 递归展开强调、删除线和显式链接；
- 按现有 Rich 解析层级处理引用式链接；
- 区分邮箱自动链接、HTTP 自动链接和显式链接；
- 去除安全行内 HTML 标签但保留未知 HTML 原文；
- 把 HTML br 转成 Rich 文本行边界；
- 图片、行内数学公式等无 textContent 原子节点不参与文本比较；
- 去除行内批注包装；
- 精确复现顶层段落与容器子块不同的 XML 命名实体行为。

src/components/BEditor/hooks/useExtensions.ts 复用同一份链接和安全 HTML 规则，避免解析器与映射器再次漂移。

### 物理文本行模型

src/components/BEditor/adapters/sourceLineMapping.ts 不再用“块起始行 + Rich 换行数”推测物理行，而是分别构建：

- Markdown 物理文本行：sourceLine + visible text；
- ProseMirror 文本行：from + to + visible text。

两组文本行按顶层块、可见文本和出现顺序对齐。选区只聚合实际相交的已对齐文本行；反向定位只返回目标物理行对应的 Rich 位置。

### 结构处理

- 围栏代码跳过开始/结束围栏，内容首行对应围栏下一物理行。
- 代码内部空行不阻止顶层 code token 对齐。
- 引用和列表去除容器标记，并用 marked 容器 AST 修正引用定义、实体、批注和嵌套格式语义。
- 表格按单元格建立文本行；同一 Markdown 行的多个单元格共享物理行号。
- 引用或列表内的嵌套表格先去除容器前缀定位物理行，再复用原 AST 单元格语义。
- 开头连续空行和块间空行分别推进游标。
- CRLF 的回车换行组合只计为一个物理换行。

### 权威来源与失败策略

src/components/BEditor/adapters/richSelectionAssistant.ts 在 Markdown 原文存在时只接受精确 Markdown 映射；失败时生成 startLine: 0, endLine: 0 的无行号引用。仅没有 Markdown 原文时才允许 parser attrs 回退。

反向映射也在非空 Markdown 存在时失败关闭。目标为空白行、token 未对齐或语义无法证明时返回 null，不会再次落入过期 attrs 坐标。

## 数据流

1. SelectionToolbar.vue 触发插入对话。
2. richSelectionAssistant.ts 把 ProseMirror 选区和持久化 Markdown 交给映射器。
3. 映射器对齐顶层块和逐物理文本行。
4. 成功时发送真实 startLine/endLine；失败时发送 0/0。
5. 聊天侧沿用现有协议插入文件引用。

## 测试

- test/components/BEditor/source-line-mapping.test.ts 覆盖第 99 行复现、CRLF、空白行、过期 attrs、混合列表和任务列表。
- test/components/BEditor/source-line-mapping.matrix.test.ts 使用真实 Rich parser 对 109 组结构场景执行正向和反向断言，共 218 个断言。
- test/components/BEditor/rich-selection-assistant.test.ts 覆盖 Markdown 权威失败关闭和无 Markdown 时的 attrs 回退。

## 验收标准

- 复现结构中选择“已生成行程地图（高德）”得到第 99 行。
- 不再出现同一选区从第 99 行退化为第 59 行。
- 所有新回归测试经历 RED → GREEN。
- 相关 Vitest、ESLint、Stylelint、TypeScript 和 diff 检查全部通过。
