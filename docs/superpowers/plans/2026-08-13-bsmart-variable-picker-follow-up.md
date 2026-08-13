# BSmart 变量输入交互重构实现计划

> **执行方式：** 当前会话直接在 `main` 工作树执行；不暂存、不提交，由用户自行提交。

**目标：** 让 `BSmartInput` 与 `BSmartSelect` 直接复用同一套可编辑变量输入体验，修复键盘循环和选中变量定位，并同步 Developing Widget 文档与校验器的结构化 Smart 值协议。

**架构：** 新建只管理变量路径字符串与变量浮层的内部 `VariableInput` 控件。`BSmartInput`、`BSmartSelect` 继续拥有各自的 `BSmartValue<T>` 模型和模式切换逻辑，避免共享控件耦合静态值类型。变量树工具负责查找祖先路径，`VariableSelect` 只负责渲染稳定选中态，通用下拉继续负责活动项滚动。

**技术栈：** Vue 3 `<script setup>`、TypeScript strict、Ant Design Vue、Vitest、Vue Test Utils、Node.js ESM Widget 校验器、Markdown。

## 全局约束

- 不兼容历史基本类型和 Smart 字段中的旧 `{{ }}` 字符串。
- variable 路径编辑始终写回 `{ type: 'variable', value: 新路径 }`。
- `BSmartSelect` 不得导入、渲染或测试桩替代 `BSmartInput`。
- Text 元素的混合 moustache 内容保持不变。
- 不使用 `any`；新增和修改的函数、接口、复杂逻辑按仓库规范补齐注释。
- 先写会失败的测试，确认失败原因后再写最小实现。
- 保留工作树现有修改，不运行 `git add` 或 `git commit`。

---

### 任务 1：为共享变量输入建立失败测试

**文件：**

- 新建：`test/components/BSmart/variable-input.component.test.ts`
- 修改：`test/components/BSmart/variable-select-layout.test.ts`
- 修改：`test/components/BSmart/input.component.test.ts`
- 修改：`test/components/BSmart/select.component.test.ts`

**步骤：**

1. 为尚不存在的 `VariableInput.vue` 编写测试，覆盖输入路径、选择路径、suffix 的 `lucide:chevron-down`、打开时当前路径定位，以及 `ArrowDown` 尾到首和 `ArrowUp` 首到尾。
2. 为 `VariableSelect` 添加 `selected-value` 测试，断言真实选中项拥有 `is-selected`，并与活动项状态互不覆盖。
3. 改写 Input 测试，断言 literal 状态变量按钮位于输入框外、variable 状态 suffix 为 chevron、变量路径编辑仍为 variable、`lucide:type` 转换为 literal。
4. 改写 Select 测试，删除 `BSmartInput` 测试桩，断言切换后直接出现共享变量输入、立即打开列表、路径编辑仍为 variable，且源码不包含 `BSmartInput`。
5. 运行：

   ```bash
   pnpm exec vitest run test/components/BSmart/variable-input.component.test.ts test/components/BSmart/variable-select-layout.test.ts test/components/BSmart/input.component.test.ts test/components/BSmart/select.component.test.ts
   ```

   预期：因共享控件、选中属性和新交互尚未实现而失败。

---

### 任务 2：实现共享 VariableInput 和选中定位

**文件：**

- 新建：`src/components/BSmart/components/VariableInput.vue`
- 修改：`src/components/BSmart/components/VariableSelect.vue`
- 修改：`src/components/BSmart/utils/variables.ts`
- 必要时修改：`src/components/BSmart/components/_SelectDropdown.vue`

**步骤：**

1. 在变量工具中增加查找选中路径祖先值的纯函数，并为嵌套对象/数组路径保留完整 `Variable.value` 匹配。
2. 创建 `VariableInput`：接收路径字符串、变量分组、禁用/只读状态和首次自动打开标记；发送路径更新和选择事件。
3. 把 Input 当前的浮层定位、折叠状态、外部点击、焦点关闭、活动索引和键盘逻辑迁移到共享控件。
4. 打开列表前移除选中变量祖先的折叠状态；在可见列表中定位完整路径，设置活动索引，并打开 `scroll-active-into-view`。
5. 使用模运算实现上下方向键首尾循环；空列表不执行选择。
6. 给 `VariableSelect` 增加 `selectedValue?: string` 和稳定 `is-selected` 样式；继续由 `_SelectDropdown` 的活动索引驱动滚动。
7. 运行任务 1 的四个测试文件，预期共享控件和 VariableSelect 测试通过，Input/Select 仍因未接入而失败。

---

### 任务 3：接入 BSmartInput 和 BSmartSelect

**文件：**

- 修改：`src/components/BSmart/Input.vue`
- 修改：`src/components/BSmart/Select.vue`

**步骤：**

1. Input 增加本地变量模式与变量草稿：literal 模式渲染普通 `AInput` 和外部 braces 按钮；点击只切换界面并要求共享控件首次打开，不立即改模型。
2. Input 的 variable 模式渲染 `VariableInput` 和外部 `lucide:type`；路径更新包装为 variable，类型按钮把当前路径包装为 literal。
3. 保留 Input 的 `change` 事件语义；literal 编辑和 variable 编辑都发送完整结构化值。
4. Select 删除所有 `BSmartInput` 类型、计算属性和模板依赖；variable 模式直接渲染 `VariableInput`。
5. Select 的变量按钮只切换界面并首次打开列表；路径输入或选择后写回 variable；`lucide:list` 只返回静态界面，直到选择静态选项才写 literal。
6. 运行任务 1 的四个测试文件，预期全部通过。

---

### 任务 4：用测试锁定 Developing Widget 结构化协议

**文件：**

- 新建：`test/skills/developing-widget-validator.test.ts`
- 修改：`skills/developing-widget/scripts/validate-widget.js`
- 修改：`skills/developing-widget/assets/widget-template/widget.json`

**步骤：**

1. 使用临时 Widget 目录编写校验器测试，覆盖合法 literal/variable 的 Button、Image、Swiper、Loop 和 action args。
2. 添加旧基本类型、错误 literal 类型、variable 非字符串路径的拒绝测试。
3. 添加静态图片资源检查与 variable 图片跳过本地资源检查的测试。
4. 先运行新测试并确认旧校验器失败。
5. 在校验器中增加 Smart 值形状与 literal 类型校验帮助函数；按字段分别约束 string/boolean。
6. Loop 启用时要求 `source` 是非空 variable 路径或有效 Smart 字符串值；绑定根校验只针对 variable 路径。
7. Button action args 逐项校验为字符串 Smart 值；Image/Swiper 图片、Swiper 布尔值全部使用对应 Smart 校验。
8. 资源收集只提取 image 与 swiper 中 `type: 'literal'` 的字符串地址。
9. 更新模板中出现的默认 Smart 字段，保证模板本身通过新版校验器。
10. 运行：

    ```bash
    pnpm exec vitest run test/skills/developing-widget-validator.test.ts
    node skills/developing-widget/scripts/validate-widget.js skills/developing-widget/assets/widget-template
    ```

    预期：全部通过。

---

### 任务 5：更新 Developing Widget 引用和变更日志

**文件：**

- 修改：`skills/developing-widget/references/elements-and-bindings.md`
- 修改：`skills/developing-widget/references/runtime-api.md`
- 修改：`skills/developing-widget/references/widget-format.md`
- 修改：`changelog/2026-08-13.md`

**步骤：**

1. 把 Loop、Button、Image、Swiper 与 action args 示例改为 `{ "type": "literal" | "variable", "value": ... }`。
2. 明确 variable 只存路径，不包含 `{{ }}`；明确 Text 内容仍可使用 moustache 混合模板。
3. 在格式与运行时文档中说明 schema 根声明同时约束 Text 模板和 Smart variable 路径。
4. 更新图片资源说明：仅 literal 本地地址进入包内资源校验。
5. 在当天 changelog 记录交互、定位、文档与校验器同步。

---

### 任务 6：完整验证与复核

**步骤：**

1. 运行所有 BSmart 和 Widget 相关定向测试。
2. 运行 `pnpm lint`、`pnpm lint:style`、`pnpm exec tsc --noEmit`。
3. 运行完整 `pnpm test`；若数据库子进程受 Electron 环境影响，单独报告主 Vitest 与数据库测试结果。
4. 用 `rg` 确认 `src/components/BSmart/Select.vue` 不含 `BSmartInput`，文档 Smart 示例不再使用旧基本类型。
5. 检查 `git diff --check` 和 `git status --short`，确保没有暂存或提交任何文件。
