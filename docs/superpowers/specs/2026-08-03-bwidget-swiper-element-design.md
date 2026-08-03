# BWidget Swiper Element Design

## Goal

Add a built-in lightweight `swiper` element to BWidget so users can place a carousel image component on the widget canvas without adding a third-party swiper dependency.

## Context

Existing BWidget elements live under `src/components/BWidget/elements`. Each element follows the same pattern:

- `schema.ts` defines the sidebar tool metadata, default element style, default element metadata, and creation behavior.
- `index.vue` renders the element inside the widget canvas and runtime.
- `Setter.vue` provides the element-specific right-side configuration panel.
- `src/components/BWidget/elements/index.ts` registers the schema, view component, and optional setter component.

The new swiper element should follow the existing `Image` element model: image URLs and alt text are configured manually in the setter and can use `{{ }}` template variables. The first version does not support binding the entire image list to a runtime array.

## Requirements

- Add a `swiper` element named `轮播图`.
- Keep it built in and lightweight; do not add `swiper.js` or another carousel dependency.
- Put it in the `basic` sidebar category.
- Allow element resizing through the existing Moveable behavior.
- Support multiple manually configured images.
- Each image item has `src` and optional `alt`; both support `{{ }}` template interpolation like the existing `Image` element.
- Support image fit modes matching `Image`: `cover`, `contain`, `fill`, `none`, and `scale-down`.
- Support autoplay configuration:
  - `autoplay`: whether autoplay is enabled.
  - `autoplayInterval`: autoplay interval in milliseconds.
  - `animationDuration`: slide transition duration in milliseconds.
- Support `initialIndex` as the first visible image index.
- Support `loop` to control whether navigation wraps around.
- Support `showIndicator` to control indicator visibility.
- Support `vertical` to switch between horizontal and vertical slide motion.
- Support indicator styling:
  - `indicatorColor`: configurable color.
  - `indicatorShape`: one of `dot`, `line`, or `bar`.
- Empty `src` or failed image load shows a placeholder instead of a broken image.
- Respect `prefers-reduced-motion` by disabling animated transition duration when the user requests reduced motion.

## Metadata Shape

```ts
/**
 * 轮播图图片项。
 */
export interface WidgetSwiperImageItem {
  /** 图片地址，支持变量插值 {{ ... }} */
  src: string;
  /** 替代文本，用于无障碍；支持变量插值 */
  alt?: string;
}

/**
 * 轮播图指示器形状。
 */
export type WidgetSwiperIndicatorShape = 'dot' | 'line' | 'bar';

/**
 * 轮播图元素自定义元数据。
 */
export interface WidgetSwiperElementMetadata extends WidgetMetadata {
  /** 图片列表 */
  images: WidgetSwiperImageItem[];
  /** 图片填充模式 */
  fit?: WidgetImageFit;
  /** 是否自动轮播 */
  autoplay: boolean;
  /** 自动轮播间隔，单位 ms */
  autoplayInterval: number;
  /** 切换动画时长，单位 ms */
  animationDuration: number;
  /** 初始位置索引值 */
  initialIndex: number;
  /** 是否开启循环播放 */
  loop: boolean;
  /** 是否显示指示器 */
  showIndicator: boolean;
  /** 是否为纵向滚动 */
  vertical: boolean;
  /** 指示器颜色 */
  indicatorColor: string;
  /** 指示器形状 */
  indicatorShape: WidgetSwiperIndicatorShape;
}
```

Default metadata:

```ts
{
  images: [
    {
      src: '',
      alt: ''
    }
  ],
  fit: 'cover',
  autoplay: false,
  autoplayInterval: 3000,
  animationDuration: 300,
  initialIndex: 0,
  loop: true,
  showIndicator: true,
  vertical: false,
  indicatorColor: '#ffffff',
  indicatorShape: 'dot'
}
```

## Rendering Design

`src/components/BWidget/elements/Swiper/index.vue` renders one carousel viewport that fills the element box.

Rendering behavior:

- Resolve each image item's `src` and `alt` through the existing BWidget template evaluation path.
- Hide unresolved template placeholders in design mode, matching `Image`.
- Normalize the active index against the current image list length.
- Start from `initialIndex` on mount and whenever the element identity changes.
- Render a placeholder when the current image has no `src`, the list is empty, or the current image fails to load.
- Use a translated track for slide motion:
  - horizontal: `translateX(-activeIndex * 100%)`.
  - vertical: `translateY(-activeIndex * 100%)`.
- Use `animationDuration` for transition duration unless `prefers-reduced-motion: reduce` is active.
- Use `object-fit` from `fit`, defaulting to `cover`.
- Show previous and next icon buttons when there is more than one image.
- If `loop` is false, disable previous on the first image and next on the last image.
- If `autoplay` is true and there is more than one image, advance after `autoplayInterval`.
- If `loop` is false, autoplay stops advancing at the last image.

Accessibility:

- Images use resolved `alt` text.
- Previous and next buttons have accessible labels.
- Indicator buttons have accessible labels and `aria-current` for the active slide.

## Setter Design

`src/components/BWidget/elements/Swiper/Setter.vue` follows the existing `Image/Setter.vue` style and uses existing BWidget/BSmart controls.

Sections:

- `图片`
  - Repeated image rows with:
    - address input using `BSmartInput` and `variableOptions`.
    - alt input using `BSmartInput` and `variableOptions`.
    - remove button.
  - add image button.
  - keep at least one image row.
- `显示`
  - fit select using the same options as `Image`.
  - initial index numeric input.
  - vertical toggle.
- `播放`
  - autoplay toggle.
  - autoplay interval numeric input in ms.
  - animation duration numeric input in ms.
  - loop toggle.
- `指示器`
  - show indicator toggle.
  - indicator color input.
  - indicator shape select with `dot`, `line`, and `bar`.

Setter constraints:

- `autoplayInterval` minimum: `100`.
- `animationDuration` minimum: `0`.
- `initialIndex` minimum: `0`.
- `indicatorColor` should remain a string metadata value; use existing color input if available in the codebase, otherwise a normal text input is acceptable for the first version.

## Registration

Update `src/components/BWidget/elements/index.ts`:

- Import `Swiper/index.vue`, `Swiper/Setter.vue`, and `swiperElementSchema`.
- Add `swiperElementSchema` to `WIDGET_ELEMENT_SCHEMAS`.
- Add view and setter mappings for `swiper`.

The sidebar category test must be updated so the `basic` category includes `swiper`.

## Tests

Use TDD. Add focused tests before implementation:

- Registry test:
  - `swiper` schema appears in `WIDGET_ELEMENT_SCHEMAS`.
  - schema defaults include the agreed metadata.
  - view and setter are registered.
  - category map includes `swiper: 'basic'`.
- View test:
  - renders the current image from metadata.
  - resolves `src` and `alt` template variables in runtime mode.
  - hides variable-only `src` in design mode.
  - shows placeholder for empty image list or empty current `src`.
  - applies horizontal and vertical transform styles.
  - applies configured animation duration.
  - disables wrapping when `loop` is false.
  - advances with autoplay using fake timers.
  - renders indicator shape and color when `showIndicator` is true.
- Setter test:
  - updates image address and alt.
  - provides variable options to image fields.
  - adds and removes image rows while keeping at least one row.
  - updates fit, autoplay interval, animation duration, initial index, loop, indicator visibility, vertical mode, indicator color, and indicator shape.

Verification commands:

```bash
pnpm exec vitest run test/components/BWidget/widget-elements-registry.test.ts test/components/BWidget/swiper-element-view.component.test.ts test/components/BWidget/swiper-setter.component.test.ts
pnpm exec tsc --noEmit
```

## Out Of Scope

- No third-party carousel/swiper dependency.
- No runtime binding of the entire image list as `{{ images }}` in the first version.
- No drag-and-drop image row sorting in the first version.
- No per-slide click actions in the first version.
- No thumbnails strip in the first version.
