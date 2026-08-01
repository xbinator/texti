/**
 * @file theme-deep-token-styles.test.ts
 * @description Verifies deeper app chrome consumes theme design tokens.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 读取源码。
 * @param filePath - 仓库相对文件路径
 * @returns 文件源码
 */
function readSource(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

describe('deep theme token styles', (): void => {
  it('uses design tokens in markdown and legacy message surfaces', (): void => {
    const markdownSource = readSource('src/assets/styles/markdown.less');
    const messageSource = readSource('src/components/BMessage/index.vue');
    const codeBlockNodeSource = readSource('src/components/BMessage/components/CodeBlockNode.vue');
    const imageNodeSource = readSource('src/components/BMessage/components/ImageNode.vue');
    const bubbleSource = readSource('src/components/BBubble/index.vue');

    expect(markdownSource).toContain('font-family: var(--font-mono);');
    expect(markdownSource).toContain('border: var(--surface-border-width) solid var(--border-secondary);');
    expect(markdownSource).toContain('border-radius: var(--surface-radius);');
    expect(markdownSource).toContain('border-radius: var(--control-radius);');
    expect(messageSource).toContain('border: var(--surface-border-width) solid var(--border-secondary);');
    expect(messageSource).toContain('border-radius: var(--surface-radius);');
    expect(codeBlockNodeSource).toContain('border: var(--surface-border-width) solid var(--border-secondary);');
    expect(codeBlockNodeSource).toContain('border-radius: var(--surface-radius);');
    expect(codeBlockNodeSource).toContain('border-radius: var(--control-radius);');
    expect(codeBlockNodeSource).toContain('transition: color var(--motion-duration-base) var(--motion-easing-standard)');
    expect(imageNodeSource).toContain('border-radius: var(--control-radius);');
    expect(imageNodeSource).toContain('opacity var(--motion-duration-fast) var(--motion-easing-standard)');
    expect(bubbleSource).toContain('border-radius: var(--surface-radius) var(--control-radius) var(--surface-radius) var(--surface-radius);');
  });

  it('uses design tokens in editor deep chrome', (): void => {
    const markdownShellSource = readSource('src/components/BEditor/Markdown.vue');
    const editorCodeBlockSource = readSource('src/components/BEditor/components/CodeBlock.vue');
    const currentBlockMenuSource = readSource('src/components/BEditor/components/CurrentBlockMenu.vue');
    const linkPopoverSource = readSource('src/components/BEditor/components/LinkPopover.vue');
    const selectionToolbarSource = readSource('src/components/BEditor/shared/SelectionToolbar.vue');
    const selectionInputSource = readSource('src/components/BEditor/shared/SelectionAIInput.vue');
    const findBarSource = readSource('src/components/BEditor/shared/FindBar.vue');
    const commentCardSource = readSource('src/components/BEditor/shared/CommentCard.vue');

    expect(markdownShellSource).toContain('border: var(--surface-border-width) solid var(--border-primary);');
    expect(markdownShellSource).toContain('border-radius: var(--surface-radius);');
    expect(editorCodeBlockSource).toContain('border: var(--surface-border-width) solid var(--code-border);');
    expect(editorCodeBlockSource).toContain('border-radius: var(--surface-radius);');
    expect(editorCodeBlockSource).toContain('border-radius: var(--control-radius);');
    expect(editorCodeBlockSource).toContain('transition: color var(--motion-duration-base) var(--motion-easing-standard)');
    expect(currentBlockMenuSource).toContain('border: var(--control-border-width) solid var(--border-primary);');
    expect(currentBlockMenuSource).toContain('border: var(--overlay-border-width) solid var(--dropdown-border);');
    expect(currentBlockMenuSource).toContain('border-radius: var(--overlay-radius);');
    expect(linkPopoverSource).toContain('border: var(--overlay-border-width) solid var(--border-primary);');
    expect(linkPopoverSource).toContain('border-radius: var(--overlay-radius);');
    expect(linkPopoverSource).toContain('border-radius: var(--control-radius);');
    expect(selectionToolbarSource).toContain('border: var(--overlay-border-width) solid var(--border-primary);');
    expect(selectionToolbarSource).toContain('border-radius: var(--overlay-radius);');
    expect(selectionToolbarSource).toContain('border-radius: var(--control-radius);');
    expect(selectionInputSource).toContain('border: var(--overlay-border-width) solid var(--border-secondary);');
    expect(selectionInputSource).toContain('border-radius: var(--overlay-radius);');
    expect(findBarSource).toContain('border: var(--overlay-border-width) solid var(--border-secondary);');
    expect(findBarSource).toContain('border-radius: var(--overlay-radius);');
    expect(commentCardSource).toContain('border: var(--overlay-border-width) solid var(--border-primary);');
    expect(commentCardSource).toContain('border-radius: var(--overlay-radius);');
  });

  it('uses design tokens in widget and webview chrome', (): void => {
    const sidebarToolsSource = readSource('src/views/widget/components/SidebarTools.vue');
    const sidebarLayerSource = readSource('src/views/widget/components/SidebarLayer.vue');
    const controlPanelSource = readSource('src/views/widget/components/DesignSetter/ControlPanel.vue');
    const batchSetterSource = readSource('src/views/widget/components/BatchSetter.vue');
    const widgetToolbarSource = readSource('src/components/BWidget/components/Toolbar.vue');
    const webAddressSource = readSource('src/views/webview/web/components/AddressBar.vue');
    const nativeAddressSource = readSource('src/views/webview/native/components/AddressBar.vue');
    const webShellSource = readSource('src/views/webview/web/index.vue');
    const nativeShellSource = readSource('src/views/webview/native/index.vue');
    const inspectorSource = readSource('src/views/webview/web/components/InspectorPanel.vue');

    expect(sidebarToolsSource).toContain('border: var(--control-border-width) solid transparent;');
    expect(sidebarToolsSource).toContain('border-radius: var(--control-radius);');
    expect(sidebarLayerSource).toContain('border: var(--control-border-width) solid transparent;');
    expect(sidebarLayerSource).toContain('border-radius: var(--control-radius);');
    expect(controlPanelSource).toContain('border: var(--control-border-width) solid var(--border-primary);');
    expect(controlPanelSource).toContain('border-radius: var(--control-radius);');
    expect(batchSetterSource).toContain('border: var(--surface-border-width) solid var(--border-primary);');
    expect(batchSetterSource).toContain('border-radius: var(--surface-radius);');
    expect(widgetToolbarSource).toContain('border: var(--overlay-border-width) solid var(--border-secondary);');
    expect(widgetToolbarSource).toContain('border-radius: var(--overlay-radius);');
    expect(webAddressSource).toContain('border: var(--input-border-width) solid var(--input-border);');
    expect(webAddressSource).toContain('border-radius: var(--input-radius);');
    expect(nativeAddressSource).toContain('border: var(--input-border-width) solid var(--input-border);');
    expect(nativeAddressSource).toContain('border-radius: var(--input-radius);');
    expect(webShellSource).toContain('border-radius: var(--surface-radius);');
    expect(webShellSource).toContain('border: var(--overlay-border-width) solid color-mix');
    expect(nativeShellSource).toContain('border-radius: var(--surface-radius);');
    expect(inspectorSource).toContain('font-family: var(--font-mono);');
    expect(inspectorSource).toContain('border-radius: var(--control-radius);');
  });

  it('uses design tokens in viewer utility chrome', (): void => {
    const colorPickerSource = readSource('src/components/BColorPicker/index.vue');
    const imageViewerSource = readSource('src/components/BImageViewer/index.vue');
    const carouselSource = readSource('src/components/BImageViewer/components/Carousel.vue');
    const jsonViewerSource = readSource('src/components/BJsonViewer/index.vue');
    const nodeDetailSource = readSource('src/components/BJsonViewer/components/NodeDetailModal.vue');

    expect(colorPickerSource).toContain('border: var(--control-border-width) solid var(--border-primary');
    expect(colorPickerSource).toContain('border: var(--overlay-border-width) solid var(--border-primary);');
    expect(colorPickerSource).toContain('border-radius: var(--overlay-radius);');
    expect(colorPickerSource).toContain('border-radius: var(--control-radius);');
    expect(colorPickerSource).toContain('transition: transform var(--motion-duration-fast) var(--motion-easing-standard);');
    expect(imageViewerSource).toContain('border-radius: var(--control-radius);');
    expect(imageViewerSource).toContain('transition: opacity var(--motion-duration-slow) var(--motion-easing-standard)');
    expect(carouselSource).toContain('border-radius: var(--radius-full);');
    expect(jsonViewerSource).toContain('font-family: var(--font-mono);');
    expect(nodeDetailSource).toContain('font-family: var(--font-mono);');
    expect(nodeDetailSource).toContain('border-radius: var(--control-radius);');
    expect(nodeDetailSource).toContain('border-radius: var(--surface-radius);');
  });

  it('uses design tokens in editor content block chrome', (): void => {
    const mathBlockSource = readSource('src/components/BEditor/components/MathBlock.vue');
    const tableViewSource = readSource('src/components/BEditor/components/TableView.vue');
    const frontMatterSource = readSource('src/components/BEditor/components/FrontMatterBlock.vue');
    const imageBlockSource = readSource('src/components/BEditor/components/ImageBlock.vue');
    const hoverIndicatorSource = readSource('src/components/BEditor/components/HoverIndicator.vue');

    expect(mathBlockSource).toContain('border: var(--surface-border-width) solid var(--code-border);');
    expect(mathBlockSource).toContain('border-radius: var(--surface-radius);');
    expect(mathBlockSource).toContain('font-family: var(--font-mono);');
    expect(mathBlockSource).toContain('border-radius: var(--control-radius);');
    expect(tableViewSource).toContain('border: var(--surface-border-width) solid var(--editor-table-border);');
    expect(tableViewSource).toContain('border-radius: var(--surface-radius);');
    expect(tableViewSource).toContain('border: var(--overlay-border-width) solid var(--border-primary);');
    expect(tableViewSource).toContain('border-radius: var(--overlay-radius);');
    expect(tableViewSource).toContain('border-radius: var(--control-radius);');
    expect(frontMatterSource).toContain('border: var(--surface-border-width) solid var(--frontmatter-border);');
    expect(frontMatterSource).toContain('border-radius: var(--surface-radius);');
    expect(frontMatterSource).toContain('font-family: var(--font-mono);');
    expect(frontMatterSource).toContain('border: var(--control-border-width) solid var(--border-primary);');
    expect(frontMatterSource).toContain('border-radius: var(--control-radius);');
    expect(imageBlockSource).toContain('border-radius: var(--surface-radius);');
    expect(imageBlockSource).toContain('border-radius: var(--control-radius);');
    expect(imageBlockSource).toContain('opacity var(--motion-duration-fast) var(--motion-easing-standard)');
    expect(hoverIndicatorSource).toContain('border: var(--control-border-width) solid var(--hover-indicator-border);');
    expect(hoverIndicatorSource).toContain('border-radius: var(--control-radius);');
  });
});
