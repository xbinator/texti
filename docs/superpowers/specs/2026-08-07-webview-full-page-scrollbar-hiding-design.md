# WebView 全页截图滚动条隐藏设计

## 背景

WebView 完整页面截图会逐屏滚动并拼接页面，但当前截图控制样式只处理 `fixed` / `sticky` 定位层。页面根滚动条以及内部滚动容器的滚动条仍可能进入每个截图切片，最终出现在长图中。

## 目标

- 完整页面截图期间隐藏页面根滚动条和所有内部滚动容器的滚动条。
- 保留页面和内部滚动容器的滚动能力，不修改 `overflow` 行为。
- 截图成功、失败或中断后恢复页面原有滚动条样式。
- 重复执行逐屏定位层扫描时不重复创建样式节点。

## 非目标

- 不改变当前视口截图和选中元素截图。
- 不裁剪截图边缘来模拟隐藏滚动条。
- 不遍历并修改每个滚动容器的内联样式。
- 不改变现有 `fixed` / `sticky` 首屏顶部、末屏底部保留规则。

## 方案

在 `src/views/webview/web/utils/screenshot.ts` 的完整页面截图初始化脚本中创建独立的临时滚动条样式节点。该节点与定位层显隐样式节点分离，避免 `createFixedElementVisibilityScript()` 更新定位层规则时覆盖滚动条规则。

临时样式同时覆盖 Chromium 和标准属性：

- 使用 `scrollbar-width: none !important` 隐藏支持该属性的滚动条。
- 使用 `html::-webkit-scrollbar`、`body::-webkit-scrollbar` 和 `*::-webkit-scrollbar` 隐藏 Chromium 页面根滚动条与内部滚动容器滚动条。
- 仅隐藏滚动条外观，不修改 `overflow`、滚动位置或滚动尺寸。

初始化脚本按固定 ID 查找样式节点，已存在时不重复创建。现有完整页面截图清理脚本负责删除该节点；清理仍位于 `finally`，因此异常路径也会恢复页面样式。

## 测试

在 `test/views/webview/web-use-screenshot.test.ts` 增加脚本级回归测试：

- 执行初始化脚本后存在滚动条样式节点，并包含页面根元素与任意内部元素的滚动条隐藏规则。
- 重复执行初始化脚本只保留一个滚动条样式节点。
- 执行清理脚本后滚动条样式节点被移除。

随后运行 WebView 截图目标测试、ESLint、Stylelint 和 TypeScript 类型检查。

## 变更范围

- 修改 `src/views/webview/web/utils/screenshot.ts`。
- 修改 `test/views/webview/web-use-screenshot.test.ts`。
- 更新 `changelog/2026-08-07.md`。
- 所有改动保留在工作区，不执行 Git 暂存或提交。
