# BWidget Swiper Element Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in lightweight BWidget `swiper` element for carousel images.

**Architecture:** Follow the existing BWidget element pattern. Add `Swiper/schema.ts`, `Swiper/index.vue`, and `Swiper/Setter.vue`, then register schema/view/setter through `src/components/BWidget/elements/index.ts`.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript strict mode, Vitest, Vue Test Utils, existing BWidget render/template hooks, existing BSmart/BSection/BColorPicker/BInputNumber/BSelect controls.

## Global Constraints

- Do not add a third-party carousel/swiper dependency.
- Do not use `any`.
- Use TDD: write failing tests before production code.
- Keep the element data model manual-list based; do not support whole-list runtime array binding in this version.
- Do not commit changes; the user will commit.
- Update `changelog/2026-08-03.md` for code changes.

---

### Task 1: Registry And Schema Contract

**Files:**
- Modify: `test/components/BWidget/widget-elements-registry.test.ts`
- Create: `src/components/BWidget/elements/Swiper/schema.ts`
- Modify: `src/components/BWidget/elements/index.ts`

**Interfaces:**
- Produces: `swiperElementSchema`, `WidgetSwiperElementMetadata`, `WidgetSwiperImageItem`, `WidgetSwiperIndicatorShape`

- [ ] **Step 1: Write the failing registry test**

Update `widget-elements-registry.test.ts` to assert that `swiper` exists, has label `轮播图`, icon `lucide:gallery-horizontal-end`, default metadata, view, setter, and role `basic`.

- [ ] **Step 2: Run registry test to verify red**

Run:

```bash
pnpm exec vitest run test/components/BWidget/widget-elements-registry.test.ts
```

Expected: FAIL because the `swiper` schema and mappings do not exist.

- [ ] **Step 3: Implement schema and registry**

Create `Swiper/schema.ts` with the agreed metadata and default style based on `WIDGET_DEFAULT_ELEMENT_STYLE`. Register schema, view, and setter in `elements/index.ts`; view/setter component files can be minimal placeholders until later tasks fill them.

- [ ] **Step 4: Run registry test to verify green**

Run:

```bash
pnpm exec vitest run test/components/BWidget/widget-elements-registry.test.ts
```

Expected: PASS.

### Task 2: Swiper View Behavior

**Files:**
- Create: `test/components/BWidget/swiper-element-view.component.test.ts`
- Modify: `src/components/BWidget/elements/Swiper/index.vue`

**Interfaces:**
- Consumes: `WidgetSwiperElementMetadata`, `WidgetSwiperImageItem`, `WidgetSwiperIndicatorShape`
- Produces: BWidget element view for `swiper`

- [ ] **Step 1: Write failing view tests**

Add tests for rendering current image, runtime variable interpolation, design-mode placeholder hiding, empty placeholder, horizontal/vertical transform, transition duration, no-loop navigation, autoplay with fake timers, and indicator shape/color.

- [ ] **Step 2: Run view tests to verify red**

Run:

```bash
pnpm exec vitest run test/components/BWidget/swiper-element-view.component.test.ts
```

Expected: FAIL because the view does not implement the behavior.

- [ ] **Step 3: Implement view**

Use existing `useElementValue` with a custom transform for `images`, computed normalization helpers, timer lifecycle with `setInterval`, accessible buttons/indicators, placeholder state, and CSS transforms.

- [ ] **Step 4: Run view tests to verify green**

Run:

```bash
pnpm exec vitest run test/components/BWidget/swiper-element-view.component.test.ts
```

Expected: PASS.

### Task 3: Swiper Setter Behavior

**Files:**
- Create: `test/components/BWidget/swiper-setter.component.test.ts`
- Modify: `src/components/BWidget/elements/Swiper/Setter.vue`

**Interfaces:**
- Consumes: `WidgetSwiperElementMetadata`, `WIDGET_SWIPER_INDICATOR_SHAPE_OPTIONS`, `WIDGET_SWIPER_BOOLEAN_OPTIONS`
- Produces: BWidget element setter for `swiper`

- [ ] **Step 1: Write failing setter tests**

Add tests for image src/alt editing, variable options, add/remove rows with one-row minimum, fit, autoplay interval, animation duration, initial index, loop, show indicator, vertical, indicator color, and indicator shape.

- [ ] **Step 2: Run setter tests to verify red**

Run:

```bash
pnpm exec vitest run test/components/BWidget/swiper-setter.component.test.ts
```

Expected: FAIL because the setter does not implement the behavior.

- [ ] **Step 3: Implement setter**

Use `defineModel`, `useElementVariables`, immutable metadata replacement helpers for image list edits, `BSmartInput`, `BSelect`, `BInputNumber`, `BColorPicker`, and `BButton`.

- [ ] **Step 4: Run setter tests to verify green**

Run:

```bash
pnpm exec vitest run test/components/BWidget/swiper-setter.component.test.ts
```

Expected: PASS.

### Task 4: Changelog And Verification

**Files:**
- Modify or create: `changelog/2026-08-03.md`

- [ ] **Step 1: Add changelog entry**

Record the new BWidget swiper element under `## Added`.

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm exec vitest run test/components/BWidget/widget-elements-registry.test.ts test/components/BWidget/swiper-element-view.component.test.ts test/components/BWidget/swiper-setter.component.test.ts
pnpm exec tsc --noEmit
pnpm exec eslint src/components/BWidget/elements/Swiper src/components/BWidget/elements/index.ts test/components/BWidget/widget-elements-registry.test.ts test/components/BWidget/swiper-element-view.component.test.ts test/components/BWidget/swiper-setter.component.test.ts --ext .vue,.ts
pnpm exec stylelint 'src/components/BWidget/elements/Swiper/**/*.{vue,less,css}'
```

Expected: all commands exit 0.

### Task 5: Swiper Setter Row Refinement

**Files:**
- Modify: `src/components/BWidget/elements/Swiper/index.vue`
- Modify: `src/components/BWidget/elements/Swiper/Setter.vue`
- Create: `src/components/BWidget/elements/Swiper/components/ImageItem.vue`
- Modify: `test/components/BWidget/swiper-element-view.component.test.ts`
- Modify: `test/components/BWidget/swiper-setter.component.test.ts`
- Create: `test/components/BWidget/swiper-image-item.component.test.ts`
- Modify: `changelog/2026-08-03.md`

**Interfaces:**
- Consumes: `WidgetSwiperImageItem`
- Produces: `SwiperImageItem` component with `update`, `remove`, and `toggle-collapse` events

- [ ] **Step 1: Write failing tests**

Assert `Swiper/index.vue` no longer renders `.widget-swiper-element__nav`. Assert `Setter.vue` renders the add-image button through `BSectionBlock` `extra`, wraps image rows in `BDraggable`, reorders images from `move.nextList`, and keeps collapsed row state outside metadata. Assert `Swiper/components/ImageItem.vue` renders a compact bar with drag handle, collapse toggle, delete button, and expanded src/alt inputs.

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
pnpm exec vitest run test/components/BWidget/swiper-element-view.component.test.ts test/components/BWidget/swiper-setter.component.test.ts test/components/BWidget/swiper-image-item.component.test.ts
```

Expected: FAIL because nav still exists and the image-item component/drag list do not exist.

- [ ] **Step 3: Implement minimal code**

Remove nav buttons, nav computed values, nav methods, and nav styles from `Swiper/index.vue`. Add `Swiper/components/ImageItem.vue`. Refactor `Setter.vue` so the add button lives in the `图片` block `extra` slot and image rows are rendered through `BDraggable` and `SwiperImageItem`; keep collapsed keys in local `ref<Set<string>>`, not metadata.

- [ ] **Step 4: Run tests to verify green**

Run:

```bash
pnpm exec vitest run test/components/BWidget/swiper-element-view.component.test.ts test/components/BWidget/swiper-setter.component.test.ts test/components/BWidget/swiper-image-item.component.test.ts
```

Expected: PASS.
