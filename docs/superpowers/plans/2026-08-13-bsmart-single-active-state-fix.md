# BSmart 单一活动态与手动展开修复实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复变量列表同一项出现内外两层高亮，并让 Input 与 Select 切换到变量模式后保持下拉关闭，直到用户点击 chevron。

**Architecture:** `VariableInput` 继续用当前模型路径初始化 `activeIndex`、展开祖先并滚动定位，但 `VariableSelect` 只渲染通用下拉的活动态，不再维护独立模型选中态。删除 `openOnMount` 状态链，Input 与 Select 的模式按钮只切换控件，变量下拉完全由 suffix chevron 控制。

**Tech Stack:** Vue 3 `<script setup>`、TypeScript strict、Ant Design Vue、Vitest、Vue Test Utils、Less。

## Global Constraints

- Input 与 Select 切换到变量模式时均不得自动打开下拉。
- 打开下拉时仍按当前变量路径展开祖先、初始化活动项并滚动定位。
- 变量列表任何时刻只渲染一个活动项背景，不保留独立模型选中样式。
- 键盘和鼠标改变活动项后，原模型变量不继续高亮。
- 不改变 `{ type: 'variable', value: path }` 的模型协议。
- 不使用 `any`；所有函数和类型继续遵守仓库注释规范。
- 不运行 `git add` 或 `git commit`，由用户自行提交。

---

### Task 1: 用失败测试锁定单一活动态

**Files:**

- Modify: `test/components/BSmart/variable-select-layout.test.ts`
- Modify: `test/components/BSmart/variable-input.component.test.ts`

**Interfaces:**

- Consumes: `VariableInput.value: string` 与 `activeIndex` 初始化逻辑。
- Produces: `VariableSelect` 仅由 `activeIndex` 决定视觉高亮的测试契约。

- [ ] **Step 1: 替换独立选中态测试**

把现有“模型选中态与活动态独立”测试改为：

```ts
it('renders only the active variable highlight', (): void => {
  const wrapper = mount(VariableSelect, {
    props: {
      visible: true,
      variables: [
        { label: '城市', value: '$input.city' },
        { label: '图片', value: '$input.image' }
      ],
      activeIndex: 1,
      position: { top: 0, left: 0, bottom: 0 }
    },
    global: { components: { BButton: BButtonStub } }
  });

  expect(document.body.querySelectorAll('.select-dropdown__item.active')).toHaveLength(1);
  expect(document.body.querySelectorAll('.variable-item.is-selected')).toHaveLength(0);
  wrapper.unmount();
});
```

- [ ] **Step 2: 改写变量定位测试为手动打开**

不再传 `openOnMount`，先断言下拉关闭，再点击 `.b-smart-variable-input__dropdown-button`，断言当前路径对应的外层行拥有 `active` 且调用 `scrollIntoView`：

```ts
const wrapper = mountVariableInput('weather.icon');
expect(wrapper.find('.select-dropdown').exists()).toBe(false);
await wrapper.find('.b-smart-variable-input__dropdown-button').trigger('click');
await nextTick();
expect(wrapper.find('[data-variable-value="weather.icon"]').element.closest('.select-dropdown__item')?.classList.contains('active')).toBe(true);
```

- [ ] **Step 3: 运行红灯测试**

Run:

```bash
pnpm exec vitest run test/components/BSmart/variable-select-layout.test.ts test/components/BSmart/variable-input.component.test.ts
```

Expected: FAIL，因为 `VariableSelect` 仍渲染 `is-selected`，`VariableInput` 仍支持 `openOnMount`。

- [ ] **Step 4: 审查测试失败原因**

确认失败来自独立选中样式或自动挂载打开行为，而不是选择器错误或测试环境异常。

---

### Task 2: 删除独立选中态和 openOnMount

**Files:**

- Modify: `src/components/BSmart/components/VariableSelect.vue`
- Modify: `src/components/BSmart/components/VariableInput.vue`
- Modify: `src/components/BSmart/Input.vue`
- Modify: `src/components/BSmart/Select.vue`
- Modify: `test/components/BSmart/input.component.test.ts`
- Modify: `test/components/BSmart/select.component.test.ts`

**Interfaces:**

- `VariableSelect` 保留 `activeIndex?: number`，删除 `selectedValue?: string`。
- `VariableInput` 保留 `value`、`options`、`disabled`、`readonly`，删除 `openOnMount`。
- Input 与 Select 的变量模式继续发送字符串路径并由外层包装成 `BSmartValue<T>`。

- [ ] **Step 1: 写 Input 与 Select 的关闭态失败测试**

Input 和 Select 点击外部变量按钮后断言变量输入存在但 `.select-dropdown` 不存在；随后点击 chevron 并断言下拉出现：

```ts
await wrapper.find('.b-smart-input__variable-button').trigger('click');
expect(wrapper.find('.b-smart-variable-input').exists()).toBe(true);
expect(wrapper.find('.select-dropdown').exists()).toBe(false);
await wrapper.find('.b-smart-variable-input__dropdown-button').trigger('click');
expect(wrapper.find('.select-dropdown').exists()).toBe(true);
```

Select 使用 `.b-smart-select__variable-button` 执行同一断言。

- [ ] **Step 2: 运行 Input 与 Select 红灯测试**

Run:

```bash
pnpm exec vitest run test/components/BSmart/input.component.test.ts test/components/BSmart/select.component.test.ts
```

Expected: FAIL，因为模式切换仍传递 `openOnMount: true`。

- [ ] **Step 3: 实现单一活动态**

在 `VariableSelect.vue` 中删除：

- `selectedValue` prop。
- 模板中的 `is-selected` class。
- `.variable-item.is-selected` 和其 label 样式。

`SelectDropdown` 的 `.active` 继续作为唯一背景来源。

- [ ] **Step 4: 删除自动挂载打开状态链**

在 `VariableInput.vue` 中删除 `openOnMount` prop/default、`:selected-value` 传递和 mounted 自动 `openDropdown()`。在 Input 与 Select 中删除 `openVariableOnMount` ref、模板属性及所有赋值。`switchToVariableMode()` 只设置草稿与 `variableMode.value = true`。

- [ ] **Step 5: 更新依赖 openOnMount 的测试操作**

所有 VariableInput 测试通过点击 `.b-smart-variable-input__dropdown-button` 显式打开下拉；折叠、键盘、禁用和外部点击测试保持原断言。

- [ ] **Step 6: 运行四个组件测试**

Run:

```bash
pnpm exec vitest run test/components/BSmart/variable-select-layout.test.ts test/components/BSmart/variable-input.component.test.ts test/components/BSmart/input.component.test.ts test/components/BSmart/select.component.test.ts
```

Expected: PASS，且无未处理 Vue warning。

---

### Task 3: 文档记录与完整验证

**Files:**

- Modify: `changelog/2026-08-13.md`
- Verify: `docs/superpowers/specs/2026-08-13-bsmart-structured-value-design.md`

- [ ] **Step 1: 更新变更日志**

在 Changed 中记录：变量列表改成单一活动态，Input 与 Select 切换变量模式后不再自动展开。

- [ ] **Step 2: 运行定向测试**

Run:

```bash
pnpm exec vitest run test/components/BSmart test/components/theme-design-token-styles.test.ts test/components/theme-input-token-styles.test.ts
```

Expected: PASS。

- [ ] **Step 3: 运行静态检查**

Run separately:

```bash
pnpm lint
pnpm lint:style
pnpm exec tsc --noEmit
```

Expected: 全部退出码为 0。

- [ ] **Step 4: 运行完整测试**

Run: `pnpm test`

Expected: 主 Vitest 与数据库测试全部通过。

- [ ] **Step 5: 复核工作树**

Run separately:

```bash
git diff --check
git diff --cached --stat
git status --short
```

Expected: 无空白错误，暂存区为空，修改保持未提交状态。
