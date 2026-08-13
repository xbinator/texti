# BSmart Structured Value Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace primitive and `{{ }}`-encoded `BSmartInput`/`BSmartSelect` models with the shared discriminated union `BSmartValue<T>` across components and their direct Widget consumers.

**Architecture:** Define one UI-independent Smart value protocol and helper module, then make both Smart controls emit that protocol. Add a Widget runtime resolver that unwraps literals or evaluates variable paths through the existing safe expression host; migrate Button, Image, Swiper, Method, and Loop storage and rendering without changing Text's mixed-template system.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript strict mode, Ant Design Vue, Vitest, Vue Test Utils, ESLint, Stylelint, lodash-es.

## Global Constraints

- Do not support or migrate historical primitive Smart values or historical `{{ expression }}` Smart values.
- A Smart value is exactly one complete literal or one complete variable reference; mixed interpolation is not supported.
- Variable models store only the raw path and never store `{{ }}`, labels, descriptions, or variable option objects.
- `BSmartInput` uses a literal empty string when cleared; only `BSmartSelect` may use `undefined` for no selection.
- Preserve Text and other non-Smart mixed-template behavior.
- Do not use `any`; every function parameter and return value requires an explicit type annotation.
- Add the repository-required file header, JSDoc, type comments, and non-trivial logic comments to all created or changed code.
- Use `asyncTo` for asynchronous error handling if asynchronous code is introduced; this plan does not require new asynchronous failure handling.
- Use `createNamespace` BEM classes and do not introduce abbreviated `&__element` or `&--modifier` selectors.
- Do not run `git add` or `git commit`; the user will review and commit the working tree.
- Record the completed code change in `changelog/2026-08-13.md`.

---

## File Map

### Shared Smart value protocol

- Modify `src/components/BSmart/types.ts`: export `BSmartLiteralValue<T>`, `BSmartVariableValue`, `BSmartValue<T>`, generic select types, and structured method argument types.
- Create `src/components/BSmart/utils/value.ts`: constructors and runtime type guards for the new protocol.
- Create `test/components/BSmart/value.test.ts`: focused unit coverage for constructors and type guards.

### Smart controls

- Modify `src/components/BSmart/Input.vue`: replace template insertion with whole-value literal/variable behavior and add `readonly`.
- Modify `test/components/BSmart/input.component.test.ts`: assert structured emissions and removal of typed `{{` triggering.
- Modify `src/components/BSmart/Select.vue`: make static options generic and bridge its variable mode through a read-only `BSmartInput`.
- Modify `test/components/BSmart/select.component.test.ts`: assert generic structured values, mode switching, and `undefined` behavior.

### Runtime resolution

- Modify `src/components/BWidget/utils/widgetBindings.ts`: add `resolveWidgetSmartValue` and route structured values through the safe expression evaluator.
- Modify `src/components/BWidget/hooks/useElementValue.ts`: unwrap `BSmartValue<T>` in its result typing and normalization pipeline.
- Modify `test/components/BWidget/widget-bindings.test.ts`: cover structured literal and variable resolution.
- Modify `test/components/BWidget/use-element-value.test.ts`: cover text/boolean transformations after Smart resolution.

### Widget migrations

- Modify Button files: `src/components/BWidget/elements/Button/schema.ts`, `Setter.vue`, `index.vue`, and their setter/view tests.
- Modify Image files: `src/components/BWidget/elements/Image/schema.ts`, `Setter.vue`, `index.vue`, and their setter/view tests.
- Modify Swiper files: `src/components/BWidget/elements/Swiper/schema.ts`, `Setter.vue`, `components/ImageItem.vue`, `index.vue`, and their setter/image-item/view tests.
- Modify Method files: `src/components/BSmart/Method.vue`, `src/components/BWidget/utils/widgetMethods.ts`, `src/components/BWidget/hooks/useElementAction.ts`, and method/action tests.
- Modify Loop files: `src/components/BWidget/types.ts`, `src/components/BWidget/utils/widgetLoop.ts`, `src/views/widget/components/AdvancedSetter.vue`, and loop/advanced-setter tests.
- Delete `src/components/BWidget/hooks/useElementTemplate.ts` if `rg "useElementTemplate" src test` confirms it has no consumers after migration.

### Documentation and verification

- Create or update `changelog/2026-08-13.md`.
- Keep `docs/superpowers/specs/2026-08-13-bsmart-structured-value-design.md` and this plan uncommitted.

---

### Task 1: Add the shared Smart value protocol

**Files:**
- Modify: `src/components/BSmart/types.ts`
- Create: `src/components/BSmart/utils/value.ts`
- Create: `test/components/BSmart/value.test.ts`

**Interfaces:**
- Produces: `BSmartValue<T>`, `BSmartInputValue`, `BSmartSelectValue<T>`, `BSmartSelectOption<T>`, `createLiteralValue<T>()`, `createVariableValue()`, `isLiteralValue()`, `isVariableValue()`, and `isSmartValue()`.
- Consumes: existing `Variable`, `VariableOptionGroup`, and method option definitions from `src/components/BSmart/types.ts`.

- [ ] **Step 1: Write constructor and guard tests**

Create `test/components/BSmart/value.test.ts` with explicit cases:

```ts
/**
 * @file value.test.ts
 * @description 验证 BSmart 结构化值构造与类型守卫。
 */
import { describe, expect, it } from 'vitest';
import { createLiteralValue, createVariableValue, isLiteralValue, isSmartValue, isVariableValue } from '@/components/BSmart/utils/value';

describe('BSmart value helpers', (): void => {
  it('creates literal and variable values without template syntax', (): void => {
    expect(createLiteralValue(false)).toEqual({ type: 'literal', value: false });
    expect(createVariableValue('$input.disabled')).toEqual({ type: 'variable', value: '$input.disabled' });
  });

  it('accepts only complete structured values', (): void => {
    expect(isLiteralValue({ type: 'literal', value: '' })).toBe(true);
    expect(isVariableValue({ type: 'variable', value: '$input.name' })).toBe(true);
    expect(isSmartValue({ type: 'literal' })).toBe(false);
    expect(isSmartValue('{{ $input.name }}')).toBe(false);
    expect(isSmartValue(false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify the missing module failure**

Run: `pnpm exec vitest run test/components/BSmart/value.test.ts`

Expected: FAIL because `src/components/BSmart/utils/value.ts` and its exports do not exist.

- [ ] **Step 3: Add the exact shared types**

In `src/components/BSmart/types.ts`, replace the current non-structured select aliases with:

```ts
/** 静态 Smart 值。 */
export interface BSmartLiteralValue<T> {
  /** 值来源类型。 */
  type: 'literal';
  /** 实际静态值。 */
  value: T;
}

/** Smart 变量引用。 */
export interface BSmartVariableValue {
  /** 值来源类型。 */
  type: 'variable';
  /** 不带双花括号的变量路径。 */
  value: string;
}

/** 静态值或变量引用。 */
export type BSmartValue<T> = BSmartLiteralValue<T> | BSmartVariableValue;

/** 单行 Smart 输入值。 */
export type BSmartInputValue = BSmartValue<string>;

/** BSmartSelect 支持的静态选项值。 */
export type BSmartSelectStaticValue = string | number | boolean | null;

/** BSmartSelect 模型值。 */
export type BSmartSelectValue<T extends BSmartSelectStaticValue = BSmartSelectStaticValue> = BSmartValue<T> | undefined;

/** BSmartSelect 静态选项。 */
export interface BSmartSelectOption<T extends BSmartSelectStaticValue = BSmartSelectStaticValue> {
  /** 展示文本。 */
  label: string;
  /** 实际静态值。 */
  value: T;
  /** 选项说明。 */
  description?: string;
}
```

- [ ] **Step 4: Implement constructors and strict guards**

Create `src/components/BSmart/utils/value.ts`. Use a local `isRecord` helper, require an own `value` field for literals, require a string path for variables, and do not parse primitives or templates:

```ts
/**
 * @file value.ts
 * @description BSmart 结构化值构造与类型守卫。
 */
import type { BSmartLiteralValue, BSmartValue, BSmartVariableValue } from '../types';

/** 创建静态 Smart 值。 */
export function createLiteralValue<T>(value: T): BSmartLiteralValue<T> {
  return { type: 'literal', value };
}

/** 创建 Smart 变量引用。 */
export function createVariableValue(path: string): BSmartVariableValue {
  return { type: 'variable', value: path };
}

/** 判断未知值是否为静态 Smart 值。 */
export function isLiteralValue(value: unknown): value is BSmartLiteralValue<unknown> {
  return isRecord(value) && value.type === 'literal' && Object.prototype.hasOwnProperty.call(value, 'value');
}

/** 判断未知值是否为 Smart 变量引用。 */
export function isVariableValue(value: unknown): value is BSmartVariableValue {
  return isRecord(value) && value.type === 'variable' && typeof value.value === 'string';
}

/** 判断未知值是否为合法 Smart 值。 */
export function isSmartValue(value: unknown): value is BSmartValue<unknown> {
  return isLiteralValue(value) || isVariableValue(value);
}
```

Add the commented `isRecord(value: unknown): value is Record<string, unknown>` above the exported guards.

- [ ] **Step 5: Run helper tests**

Run: `pnpm exec vitest run test/components/BSmart/value.test.ts`

Expected: PASS.

---

### Task 2: Refactor BSmartInput to whole structured values

**Files:**
- Modify: `src/components/BSmart/Input.vue`
- Modify: `test/components/BSmart/input.component.test.ts`

**Interfaces:**
- Consumes: `BSmartInputValue`, `createLiteralValue`, `createVariableValue`, `isVariableValue` from Task 1.
- Produces: `v-model:value` and `change` events carrying `BSmartInputValue`; new `readonly?: boolean` prop.

- [ ] **Step 1: Rewrite input tests around structured models**

Update the mount helper to pass values such as `createLiteralValue('hello')`. Add or replace tests with these exact assertions:

```ts
it('emits a literal object when text changes', async (): Promise<void> => {
  const wrapper = mountInput({ value: createLiteralValue('old') });
  await wrapper.find<HTMLInputElement>('.b-smart-input__control input').setValue('new');
  expect(wrapper.emitted('update:value')?.at(-1)).toEqual([createLiteralValue('new')]);
  expect(wrapper.emitted('change')?.at(-1)).toEqual([createLiteralValue('new')]);
});

it('stores only the selected variable path', async (): Promise<void> => {
  const wrapper = mountInput({ value: createLiteralValue('text'), options: VARIABLE_OPTIONS });
  await wrapper.find('.b-smart-input__variable').trigger('click');
  await wrapper.find('[data-variable-value="$input.name"]').trigger('click');
  expect(wrapper.emitted('update:value')?.at(-1)).toEqual([createVariableValue('$input.name')]);
});

it('does not open variables when template braces are typed', async (): Promise<void> => {
  const wrapper = mountInput({ value: createLiteralValue('') });
  await wrapper.find<HTMLInputElement>('.b-smart-input__control input').setValue('{{');
  expect(wrapper.find('.select-dropdown').exists()).toBe(false);
});
```

Also cover clearing, editing a variable into a literal, and `readonly` blocking text updates while the variable button remains usable.

- [ ] **Step 2: Run the input test and verify old primitive assumptions fail**

Run: `pnpm exec vitest run test/components/BSmart/input.component.test.ts`

Expected: FAIL because `Input.vue` still exposes a string model and insertion semantics.

- [ ] **Step 3: Replace primitive display and updates**

In `Input.vue`:

- Type the model as `BSmartInputValue` with a factory default of `createLiteralValue('')`.
- Add `readonly?: boolean` to `Props` and forward it to `AInput`.
- Add `displayValue = computed<string>(() => modelValue.value.value)`.
- Change `updateValue` to accept and emit `BSmartInputValue`.
- Make `handleInput` call `updateValue(createLiteralValue(target.value))`.
- Make `handleVariableSelect` call `updateValue(createVariableValue(variable.value))` and close the dropdown.
- Remove `useTemplateSyntax`, `replaceEntireValue`, `TEXT_INPUT_TRIGGER_LOOKBEHIND`, `TemplateTriggerRange`, `triggerRange`, `cursorPosition`, `readTemplateTriggerRange`, cursor insertion, and all `{{` trigger synchronization.
- Compute visible variables with an empty query while retaining collapse state.
- Keep `activeIndex`, dropdown placement, focus containment, keyboard navigation, and pointer-outside handling.
- Mark the variable icon active when `isVariableValue(modelValue.value)` or the dropdown is open.

The template's core binding becomes:

```vue
<AInput
  ref="inputRef"
  :class="bem('control')"
  :value="displayValue"
  :placeholder="placeholder"
  :disabled="disabled"
  :readonly="readonly"
  @input="handleInput"
  @keydown="handleKeydown"
>
```

- [ ] **Step 4: Run input tests**

Run: `pnpm exec vitest run test/components/BSmart/input.component.test.ts test/components/BSmart/variable-select-layout.test.ts`

Expected: PASS.

---

### Task 3: Refactor BSmartSelect to generic structured values

**Files:**
- Modify: `src/components/BSmart/Select.vue`
- Modify: `test/components/BSmart/select.component.test.ts`

**Interfaces:**
- Consumes: `BSmartInputValue`, `BSmartSelectOption<T>`, `BSmartSelectValue<T>`, constructors, and guards from Task 1; structured `BSmartInput` from Task 2.
- Produces: generic static selection and variable selection without emitting invalid string literals for boolean or number selects.

- [ ] **Step 1: Replace select test fixtures and assertions**

Use boolean options for the type-sensitive cases and assert:

```ts
it('wraps a static option in a literal value', async (): Promise<void> => {
  const wrapper = mountSelect({ value: createLiteralValue(false) });
  await wrapper.find('[data-option-value="true"]').trigger('click');
  expect(wrapper.emitted('update:value')?.at(-1)).toEqual([createLiteralValue(true)]);
});

it('writes a variable reference selected in variable mode', async (): Promise<void> => {
  const wrapper = mountSelect({ value: createLiteralValue(false), variables: VARIABLE_OPTIONS });
  await wrapper.find('.b-smart-select__variable-button').trigger('click');
  wrapper.findComponent({ name: 'BSmartInputStub' }).vm.$emit('update:value', createVariableValue('$input.disabled'));
  expect(wrapper.emitted('update:value')?.at(-1)).toEqual([createVariableValue('$input.disabled')]);
});

it('does not mutate the value while only switching modes', async (): Promise<void> => {
  const wrapper = mountSelect({ value: createLiteralValue(false), variables: VARIABLE_OPTIONS });
  await wrapper.find('.b-smart-select__variable-button').trigger('click');
  expect(wrapper.emitted('update:value')).toBeUndefined();
});
```

Also cover initial `undefined`, external `literal`/`variable` prop updates, switching back to static mode, and ignoring a literal string emitted by the read-only variable editor.

- [ ] **Step 2: Run the select test and verify it fails**

Run: `pnpm exec vitest run test/components/BSmart/select.component.test.ts`

Expected: FAIL because the component still compares and emits primitive values and parses whole templates.

- [ ] **Step 3: Implement generic literal selection**

Change the script declaration to:

```vue
<script setup lang="ts" generic="T extends BSmartSelectStaticValue = BSmartSelectStaticValue">
```

Use generic `Props<T>`, `TextSelectOptionEntry<T>`, and `defineModel<BSmartSelectValue<T>>`. Remove `WHOLE_TEMPLATE_PATTERN`, `isTemplateValue`, `readTemplateExpression`, and `formatTemplateValue`.

Build `selectedKey` only when `isLiteralValue(modelValue.value)`, compare `entry.option.value` to `modelValue.value.value`, and wrap selected options with `createLiteralValue(entry.option.value)`.

- [ ] **Step 4: Implement the read-only variable bridge**

Create a computed `BSmartInputValue` bridge:

```ts
const variableInputValue = computed<BSmartInputValue>({
  get: (): BSmartInputValue => (isVariableValue(modelValue.value) ? modelValue.value : createLiteralValue('')),
  set: (value: BSmartInputValue): void => {
    if (isVariableValue(value)) {
      modelValue.value = value;
    }
  }
});
```

Bind it to `<BSmartInput readonly>`. Initialize and watch `inputMode` with `isVariableValue`; keep explicit button switching local so changing modes alone does not rewrite the model.

- [ ] **Step 5: Run select tests**

Run: `pnpm exec vitest run test/components/BSmart/select.component.test.ts`

Expected: PASS.

---

### Task 4: Add Widget Smart value resolution

**Files:**
- Modify: `src/components/BWidget/utils/widgetBindings.ts`
- Modify: `src/components/BWidget/hooks/useElementValue.ts`
- Modify: `test/components/BWidget/widget-bindings.test.ts`
- Modify: `test/components/BWidget/use-element-value.test.ts`

**Interfaces:**
- Consumes: `BSmartValue<T>` and `isSmartValue` from Task 1; existing `evaluateWidgetBindingExpression` and `WidgetRenderEvaluationOptions`.
- Produces: `resolveWidgetSmartValue<T>(value, options): unknown`; `useElementValue` returns the unwrapped literal/runtime type for Smart metadata fields.

- [ ] **Step 1: Add failing resolver tests**

Add cases to `widget-bindings.test.ts`:

```ts
expect(resolveWidgetSmartValue(createLiteralValue(false), runtimeOptions)).toBe(false);
expect(resolveWidgetSmartValue(createVariableValue('$input.disabled'), runtimeOptions)).toBe(true);
expect(resolveWidgetSmartValue(createVariableValue('$input.disabled'), designOptions)).toBeUndefined();
expect(resolveWidgetSmartValue(createVariableValue('$input.missing'), runtimeOptions)).toBeUndefined();
expect(resolveWidgetSmartValue('{{ $input.disabled }}' as unknown as BSmartValue<boolean>, runtimeOptions)).toBeUndefined();
```

Use the existing render-context factory in that test file rather than introducing a second context shape.

Add `use-element-value.test.ts` cases proving `{ type: 'literal', value: '标题' }` becomes text and a runtime variable resolving to `true` becomes boolean `true`.

- [ ] **Step 2: Run resolver tests and verify missing structured resolution**

Run: `pnpm exec vitest run test/components/BWidget/widget-bindings.test.ts test/components/BWidget/use-element-value.test.ts`

Expected: FAIL because `resolveWidgetSmartValue` is not exported and `useElementValue` returns structured objects.

- [ ] **Step 3: Implement strict Smart resolution**

In `widgetBindings.ts`, add:

```ts
export function resolveWidgetSmartValue<T>(value: BSmartValue<T> | undefined, options: WidgetRenderEvaluationOptions = {}): unknown {
  if (!isSmartValue(value)) {
    return undefined;
  }

  if (isLiteralValue(value)) {
    return value.value;
  }

  const { renderContext, renderOptions = { mode: 'design' } } = options;
  if (renderOptions.mode !== 'runtime' || !renderContext || !value.value.trim()) {
    return undefined;
  }

  const result = evaluateWidgetBindingExpression(value.value, renderContext);

  return result.resolved ? result.value : undefined;
}
```

Route valid Smart objects through this function before the existing primitive/string behavior in `resolveWidgetDisplayValue`. Do not remove the existing template functions because Text still consumes them.

- [ ] **Step 4: Correct the useElementValue result type**

Introduce an unwrapping type:

```ts
/** Smart 字段解析后的底层值类型。 */
type ResolvedMetadataValue<TValue> = NonNullable<TValue> extends BSmartValue<infer TLiteral> ? TLiteral | undefined : TValue | undefined;
```

Use it in `WidgetElementValue<TMetadata, TField>` so transform functions and untransformed consumers see `string | undefined`, `boolean | undefined`, or the original non-Smart type rather than the wrapper object.

- [ ] **Step 5: Run resolver and hook tests**

Run: `pnpm exec vitest run test/components/BWidget/widget-bindings.test.ts test/components/BWidget/use-element-value.test.ts`

Expected: PASS, including unchanged mixed-template tests.

---

### Task 5: Migrate Button and Image metadata

**Files:**
- Modify: `src/components/BWidget/elements/Button/schema.ts`
- Modify: `src/components/BWidget/elements/Button/Setter.vue`
- Modify: `src/components/BWidget/elements/Button/index.vue`
- Modify: `src/components/BWidget/elements/Image/schema.ts`
- Modify: `src/components/BWidget/elements/Image/Setter.vue`
- Modify: `src/components/BWidget/elements/Image/index.vue`
- Modify: `test/components/BWidget/button-setter.component.test.ts`
- Modify: `test/components/BWidget/button-element-view.component.test.ts`
- Modify: `test/components/BWidget/image-setter.component.test.ts`
- Modify: `test/components/BWidget/image-element-view.component.test.ts`
- Delete if unused: `src/components/BWidget/hooks/useElementTemplate.ts`

**Interfaces:**
- Consumes: `BSmartValue<T>`, `createLiteralValue`, structured controls, and the `useElementValue` Smart resolver pipeline.
- Produces: Button and Image schemas whose Smart fields are always structured.

- [ ] **Step 1: Convert test fixtures and add schema assertions**

Update Button fixtures to use:

```ts
metadata: {
  actions: [],
  disabled: createLiteralValue(false),
  loading: createVariableValue('$input.loading'),
  text: createLiteralValue('提交')
}
```

Update Image fixtures to use structured `src` and `alt`. Assert setter emissions remain objects and runtime view tests resolve variables only in runtime mode.

- [ ] **Step 2: Run Button and Image tests and verify failures**

Run: `pnpm exec vitest run test/components/BWidget/button-setter.component.test.ts test/components/BWidget/button-element-view.component.test.ts test/components/BWidget/image-setter.component.test.ts test/components/BWidget/image-element-view.component.test.ts`

Expected: FAIL because schemas, stubs, and render consumers still use primitives/templates.

- [ ] **Step 3: Migrate schemas and defaults**

Use these exact field types:

```ts
interface WidgetButtonElementMetadata extends WidgetMetadata {
  text: BSmartValue<string>;
  disabled: BSmartValue<boolean>;
  loading: BSmartValue<boolean>;
  actions: WidgetButtonAction[];
}

interface WidgetImageElementMetadata extends WidgetMetadata {
  src: BSmartValue<string>;
  fit?: WidgetImageFit;
  alt: BSmartValue<string>;
}
```

Wrap every schema default with `createLiteralValue`, including Image `alt: createLiteralValue('')`. Make Button option arrays `BSmartSelectOption<boolean>[]`.

- [ ] **Step 4: Migrate setters and views**

Bind Button `text` and Image `src`/`alt` directly to metadata. Remove `useElementTemplate` from both setters. Keep Button and Image views on `useElementValue`; use `{ transform: 'text' }` for text/URL/alt outputs where a definite string is required.

Update component stubs so their `value` props and emitted values are `BSmartValue<string>` or `BSmartValue<boolean>`, never primitives.

- [ ] **Step 5: Remove the obsolete template hook if unused**

Run: `rg -n "useElementTemplate" src test`

Expected after migration: only the hook file itself is returned. Delete `src/components/BWidget/hooks/useElementTemplate.ts` with `apply_patch`; otherwise retain it and document the remaining consumer in this task's review notes.

- [ ] **Step 6: Run Button and Image tests**

Run: `pnpm exec vitest run test/components/BWidget/button-setter.component.test.ts test/components/BWidget/button-element-view.component.test.ts test/components/BWidget/image-setter.component.test.ts test/components/BWidget/image-element-view.component.test.ts`

Expected: PASS.

---

### Task 6: Migrate Swiper fields and rendering

**Files:**
- Modify: `src/components/BWidget/elements/Swiper/schema.ts`
- Modify: `src/components/BWidget/elements/Swiper/Setter.vue`
- Modify: `src/components/BWidget/elements/Swiper/components/ImageItem.vue`
- Modify: `src/components/BWidget/elements/Swiper/index.vue`
- Modify: `test/components/BWidget/swiper-setter.component.test.ts`
- Modify: `test/components/BWidget/swiper-image-item.component.test.ts`
- Modify: `test/components/BWidget/swiper-element-view.component.test.ts`

**Interfaces:**
- Consumes: `BSmartValue<string>`, `BSmartValue<boolean>`, constructors, `resolveWidgetSmartValue`, and `useElementValue`.
- Produces: structured Swiper image fields and Smart booleans while leaving numeric, color, fit, and shape fields primitive.

- [ ] **Step 1: Rewrite Swiper fixtures and expected updates**

Use structured images:

```ts
{
  title: '首页',
  src: createLiteralValue('https://example.com/a.png'),
  alt: createVariableValue('$input.firstAlt')
}
```

Use structured booleans for `vertical`, `autoplay`, `loop`, and `showIndicator`. Add runtime view cases for a variable boolean and a variable image URL.

- [ ] **Step 2: Run Swiper tests and verify failures**

Run: `pnpm exec vitest run test/components/BWidget/swiper-setter.component.test.ts test/components/BWidget/swiper-image-item.component.test.ts test/components/BWidget/swiper-element-view.component.test.ts`

Expected: FAIL because normalization and rendering still call string methods or compare wrapper objects directly to booleans.

- [ ] **Step 3: Migrate Swiper schema and setter normalization**

Change `WidgetSwiperImageItem.src` and `.alt` to `BSmartValue<string>`. Change the four Smart booleans to `BSmartValue<boolean>`. Type `WIDGET_SWIPER_BOOLEAN_OPTIONS` as `BSmartSelectOption<boolean>[]` and wrap schema defaults with `createLiteralValue`.

In Setter helpers, create empty images with literal empty strings and clone only values accepted by `isSmartValue`; malformed or historical values fall back to new literal defaults rather than being converted.

- [ ] **Step 4: Migrate ImageItem display and events**

Keep `title` primitive because it uses a normal input. Derive the summary from `props.image.src.value.trim()` for either Smart branch, and update `updateSrc`/`updateAlt` parameter types to `BSmartValue<string>`.

- [ ] **Step 5: Resolve Swiper values before rendering**

Change `resolveImageField` to accept `BSmartValue<string> | undefined` and call `resolveWidgetSmartValue` with the current render context/options before `formatWidgetDisplayTextValue`.

Replace direct boolean comparisons with `useElementValue(elementRef, field, { transform: 'boolean' })` for `autoplay`, `loop`, `vertical`, and `showIndicator`. Keep numeric normalization and non-Smart fields unchanged.

- [ ] **Step 6: Run Swiper tests**

Run: `pnpm exec vitest run test/components/BWidget/swiper-setter.component.test.ts test/components/BWidget/swiper-image-item.component.test.ts test/components/BWidget/swiper-element-view.component.test.ts`

Expected: PASS.

---

### Task 7: Migrate Method arguments and Loop sources

**Files:**
- Modify: `src/components/BSmart/Method.vue`
- Modify: `src/components/BSmart/types.ts`
- Modify: `src/components/BWidget/utils/widgetMethods.ts`
- Modify: `src/components/BWidget/hooks/useElementAction.ts`
- Modify: `src/components/BWidget/types.ts`
- Modify: `src/components/BWidget/utils/widgetLoop.ts`
- Modify: `src/views/widget/components/AdvancedSetter.vue`
- Modify: `test/components/BSmart/method.component.test.ts`
- Modify: `test/components/BWidget/widget-loop.test.ts`
- Modify: `test/views/widget/advanced-setter.test.ts`
- Modify action tests found by: `rg -l "resolveElementAction|MethodAction|run\(" test/components/BWidget`

**Interfaces:**
- Consumes: `BSmartValue<string>`, constructors/guards, and `resolveWidgetSmartValue`.
- Produces: structured `MethodAction.args` and `WidgetElementLoopConfig.source` with runtime resolution.

- [ ] **Step 1: Add structured Method and Loop test cases**

Method tests must assert new empty parameters are `createLiteralValue('')`, edited parameters retain structured objects, and runtime invocation resolves variable arguments to their actual values.

Loop tests must construct sources as `createVariableValue('products')` or `createVariableValue('$input.items')`, assert a literal string source creates no iterations, and assert normalization does not accept a historical primitive source.

AdvancedSetter tests must emit `createVariableValue('$input.items')` from the Smart input stub and assert the complete object is stored.

- [ ] **Step 2: Run Method and Loop tests and verify failures**

Run: `pnpm exec vitest run test/components/BSmart/method.component.test.ts test/components/BWidget/widget-loop.test.ts test/views/widget/advanced-setter.test.ts`

Also run every action test returned by the `rg -l` command in the Files section.

Expected: FAIL because argument and loop source normalization still accepts strings and template evaluation.

- [ ] **Step 3: Migrate Method argument storage**

Change `MethodAction.args` to `BSmartValue<string>[]`. In `normalizeMethodAction`, retain only values accepted by `isSmartValue`; do not wrap old strings. In `Method.vue`, create missing and manually added arguments with `createLiteralValue('')`, update callback parameter types, and remove placeholder text claiming `{{ }}` support.

Clone each argument object when cloning an action so modal edits cannot mutate the source model by reference:

```ts
args: action.args.map((argument: BSmartValue<string>): BSmartValue<string> => ({ ...argument }))
```

- [ ] **Step 4: Resolve Method arguments at runtime**

Change `resolveElementActionArgument` to accept `BSmartValue<string>` and call:

```ts
return resolveWidgetSmartValue(argument, {
  renderContext,
  renderOptions: { mode: 'runtime' }
});
```

Map `MethodAction.args` with the new parameter type. A missing runtime context resolves variable arguments to `undefined`; literal arguments remain available.

- [ ] **Step 5: Migrate Loop source storage and normalization**

Change `WidgetElementLoopConfig.source` to `BSmartValue<string>`. Use `createLiteralValue('')` in `createDefaultWidgetElementLoopConfig`. In normalization, accept only `isSmartValue(config.source)` and otherwise use the default structured value.

In `AdvancedSetter.vue`, remove `use-template-syntax="false"` and keep direct structured binding.

- [ ] **Step 6: Resolve Loop sources through the shared resolver**

Replace manual string path parsing in `readLoopSourceItems` with `resolveWidgetSmartValue(source, { renderContext, renderOptions: { mode: 'runtime' } })`, preserving loop locals through the render context. Return the result only when `Array.isArray(result)`; otherwise return `[]`.

Remove `readBindingPathContextValue` and related imports only after `rg` confirms they have no other consumers in `widgetLoop.ts`.

- [ ] **Step 7: Run Method, action, Loop, and AdvancedSetter tests**

Run: `pnpm exec vitest run test/components/BSmart/method.component.test.ts test/components/BWidget/widget-loop.test.ts test/views/widget/advanced-setter.test.ts`

Run the action tests discovered in Step 2 again.

Expected: PASS.

---

### Task 8: Update changelog and perform repository verification

**Files:**
- Create or modify: `changelog/2026-08-13.md`
- Review: every file changed in Tasks 1–7

**Interfaces:**
- Consumes: all prior task deliverables.
- Produces: a lint-clean, type-safe, tested working tree ready for the user's own commit.

- [ ] **Step 1: Add the changelog entry**

Create the file if absent with:

```md
# 2026-08-13

## Changed

- 将 BSmartInput、BSmartSelect 及其 Widget 消费链路重构为显式的静态值/变量引用结构，不再使用基本类型或双花括号字符串区分值来源。
```

If the file exists by execution time, merge this bullet into its existing `## Changed` section without duplicating the date heading.

- [ ] **Step 2: Scan for obsolete Smart APIs and primitive fixtures**

Run:

```bash
rg -n "useTemplateSyntax|replaceEntireValue|use-template-syntax|replace-entire-value|WHOLE_TEMPLATE_PATTERN" src test
rg -n "BSmart(Input|Select).*\{\{" src test
rg -n "WidgetButtonBooleanValue" src test
```

Expected: no migrated production usage. Test strings may only remain in the explicit case proving typed `{{` has no trigger behavior or in non-Smart Text template tests.

- [ ] **Step 3: Run the focused regression suite**

Run:

```bash
pnpm exec vitest run \
  test/components/BSmart/value.test.ts \
  test/components/BSmart/input.component.test.ts \
  test/components/BSmart/select.component.test.ts \
  test/components/BSmart/method.component.test.ts \
  test/components/BWidget/widget-bindings.test.ts \
  test/components/BWidget/use-element-value.test.ts \
  test/components/BWidget/button-setter.component.test.ts \
  test/components/BWidget/button-element-view.component.test.ts \
  test/components/BWidget/image-setter.component.test.ts \
  test/components/BWidget/image-element-view.component.test.ts \
  test/components/BWidget/swiper-setter.component.test.ts \
  test/components/BWidget/swiper-image-item.component.test.ts \
  test/components/BWidget/swiper-element-view.component.test.ts \
  test/components/BWidget/widget-loop.test.ts \
  test/views/widget/advanced-setter.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run non-mutating type and lint checks**

Run:

```bash
pnpm exec tsc --noEmit
pnpm exec eslint src --ext .vue,.ts,.tsx,.js,.jsx,.mts
pnpm exec stylelint 'src/**/*.{vue,less,css}'
```

Expected: all commands exit with status 0. Fix only issues introduced by this work; do not change unrelated user files.

- [ ] **Step 5: Run the full test suite**

Run: `pnpm test`

Expected: PASS. If an unrelated pre-existing failure appears, record the exact command, test name, and failure output without weakening or deleting the test.

- [ ] **Step 6: Review the final working tree without committing**

Run:

```bash
git status --short
git diff --check
git diff --stat
```

Expected: only the planned source, test, changelog, spec, and plan files are changed; no whitespace errors. Leave all changes unstaged and uncommitted for the user.

