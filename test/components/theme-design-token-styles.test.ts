/**
 * @file theme-design-token-styles.test.ts
 * @description 验证基础组件样式消费主题设计 Token。
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 读取源码。
 * @param filePath - 仓库相对文件路径
 * @returns 文件源码
 */
function readSource(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

describe('theme design token styles', (): void => {
  it('uses overlay and control radius tokens in dropdown components', (): void => {
    const dropdownSource = readSource('src/components/BDropdown/index.vue');
    const dropdownMenuSource = readSource('src/components/BDropdown/Menu.vue');

    expect(dropdownSource).toContain('border-radius: var(--overlay-radius);');
    expect(dropdownMenuSource).toContain('border-radius: var(--overlay-radius);');
    expect(dropdownMenuSource).toContain('border-radius: var(--control-radius);');
  });

  it('uses overlay and control radius tokens in modal and drawer chrome', (): void => {
    const modalSource = readSource('src/components/BModal/index.vue');
    const drawerSource = readSource('src/components/BDrawer/index.vue');

    expect(modalSource).toContain("'var(--overlay-radius)'");
    expect(modalSource).toContain('border-radius: var(--control-radius);');
    expect(drawerSource).toContain('border-radius: var(--overlay-radius);');
    expect(drawerSource).toContain('border-radius: var(--control-radius);');
  });

  it('uses control radius and motion tokens in select custom chrome', (): void => {
    const selectSource = readSource('src/components/BSelect/index.vue');

    expect(selectSource).toContain('transition: border-color var(--motion-duration-base) var(--motion-easing-standard)');
    expect(selectSource).toContain('box-shadow var(--motion-duration-base) var(--motion-easing-standard)');
    expect(selectSource).toContain('background var(--motion-duration-base) var(--motion-easing-standard)');
    expect(selectSource).toContain('border-radius: 0 0 var(--control-radius) var(--control-radius);');
  });

  it('uses design tokens in segmented controls and toolbar menus', (): void => {
    const segmentedSource = readSource('src/components/BSegmented/index.vue');
    const toolbarSource = readSource('src/components/BToolbar/index.vue');

    expect(segmentedSource).toContain('border-radius: var(--control-radius);');
    expect(segmentedSource).toContain('transition: color var(--motion-duration-base) var(--motion-easing-standard);');
    expect(segmentedSource).toContain('transition: width var(--motion-duration-base) var(--motion-easing-standard)');
    expect(segmentedSource).toContain('transform var(--motion-duration-base) var(--motion-easing-standard)');
    expect(toolbarSource).toContain('border-radius: var(--control-radius);');
    expect(toolbarSource).toContain('border-radius: var(--overlay-radius);');
    expect(toolbarSource).toContain('background var(--motion-duration-fast) var(--motion-easing-standard)');
  });

  it('uses design tokens in command panel and smart select chrome', (): void => {
    const commandPanelSource = readSource('src/components/BCommandPanel/index.vue');
    const smartSelectSource = readSource('src/components/BSmart/Select.vue');
    const smartDropdownSource = readSource('src/components/BSmart/components/_SelectDropdown.vue');

    expect(commandPanelSource).toContain('border-radius: var(--control-radius);');
    expect(commandPanelSource).toContain('transition: background var(--motion-duration-fast) var(--motion-easing-standard)');
    expect(commandPanelSource).toContain('border-color var(--motion-duration-fast) var(--motion-easing-standard)');
    expect(smartSelectSource).toContain('border-radius: var(--control-radius);');
    expect(smartSelectSource).toContain('transition: color var(--motion-duration-base) var(--motion-easing-standard)');
    expect(smartSelectSource).toContain('background var(--motion-duration-base) var(--motion-easing-standard)');
    expect(smartSelectSource).toContain('border-color var(--motion-duration-base) var(--motion-easing-standard)');
    expect(smartDropdownSource).toContain('border-radius: var(--overlay-radius);');
    expect(smartDropdownSource).toContain('border-radius: var(--control-radius);');
    expect(smartDropdownSource).toContain('transition: background var(--motion-duration-base) var(--motion-easing-standard);');
  });

  it('uses design tokens in chat composer and message chrome', (): void => {
    const chatSource = readSource('src/components/BChat/index.vue');
    const inputToolbarSource = readSource('src/components/BChat/components/InputToolbar.vue');
    const messageBubbleSource = readSource('src/components/BChat/components/MessageBubble.vue');
    const questionCardSource = readSource('src/components/BChat/components/QuestionCard.vue');
    const confirmationSource = readSource('src/components/BChat/components/ConfirmationSheet.vue');
    const sessionHistorySource = readSource('src/components/BChat/components/SessionHistory.vue');
    const modelSelectorSource = readSource('src/components/BChat/components/InputToolbar/ModelSelector.vue');

    expect(chatSource).toContain('border-radius: var(--input-radius);');
    expect(chatSource).toContain('background var(--motion-duration-slow) var(--motion-easing-standard)');
    expect(inputToolbarSource).toContain('border-radius: var(--control-radius);');
    expect(inputToolbarSource).toContain('opacity var(--motion-duration-fast) var(--motion-easing-standard)');
    expect(messageBubbleSource).toContain('border-radius: var(--surface-radius);');
    expect(messageBubbleSource).toContain('border-radius: var(--radius-full);');
    expect(questionCardSource).toContain('border-radius: var(--surface-radius);');
    expect(questionCardSource).toContain('border-radius: var(--control-radius);');
    expect(questionCardSource).toContain('background var(--motion-duration-fast) var(--motion-easing-standard)');
    expect(confirmationSource).toContain('border-radius: var(--surface-radius);');
    expect(confirmationSource).toContain('border-radius: var(--control-radius);');
    expect(sessionHistorySource).toContain('border-radius: var(--overlay-radius);');
    expect(sessionHistorySource).toContain('border-radius: var(--control-radius);');
    expect(sessionHistorySource).toContain('opacity var(--motion-duration-base) var(--motion-easing-standard)');
    expect(modelSelectorSource).toContain('border-radius: var(--overlay-radius);');
    expect(modelSelectorSource).toContain('border-radius: var(--control-radius);');
  });

  it('uses semantic border width tokens in themed chrome', (): void => {
    const buttonSource = readSource('src/components/BButton/index.vue');
    const dropdownSource = readSource('src/components/BDropdown/index.vue');
    const dropdownMenuSource = readSource('src/components/BDropdown/Menu.vue');
    const segmentedSource = readSource('src/components/BSegmented/index.vue');
    const toolbarSource = readSource('src/components/BToolbar/index.vue');
    const smartSelectSource = readSource('src/components/BSmart/Select.vue');
    const smartDropdownSource = readSource('src/components/BSmart/components/_SelectDropdown.vue');
    const chatSource = readSource('src/components/BChat/index.vue');
    const messageBubbleSource = readSource('src/components/BChat/components/MessageBubble.vue');
    const questionCardSource = readSource('src/components/BChat/components/QuestionCard.vue');
    const confirmationSource = readSource('src/components/BChat/components/ConfirmationSheet.vue');

    expect(buttonSource).toContain('border: var(--button-border-width) solid var(--button-border);');
    expect(buttonSource).toContain('border-color: var(--button-border);');
    expect(buttonSource).toContain('border: var(--control-border-width) solid var(--color-danger-border);');
    expect(dropdownSource).toContain('border: var(--overlay-border-width) solid var(--dropdown-border);');
    expect(dropdownMenuSource).toContain('border: var(--overlay-border-width) solid var(--dropdown-border);');
    expect(segmentedSource).toContain('border: var(--control-border-width) solid var(--border-primary);');
    expect(toolbarSource).toContain('border: var(--control-border-width) solid var(--border-primary);');
    expect(toolbarSource).toContain('border: var(--overlay-border-width) solid var(--dropdown-border);');
    expect(smartSelectSource).toContain('border: var(--control-border-width) solid var(--border-primary);');
    expect(smartDropdownSource).toContain('border: var(--overlay-border-width) solid var(--border-primary);');
    expect(chatSource).toContain('border: var(--input-border-width) solid var(--input-border);');
    expect(messageBubbleSource).toContain('border: var(--surface-border-width) solid var(--border-primary);');
    expect(questionCardSource).toContain('border: var(--surface-border-width) solid var(--border-primary);');
    expect(questionCardSource).toContain('border: var(--control-border-width) solid var(--border-primary);');
    expect(confirmationSource).toContain('border: var(--surface-border-width) solid var(--border-primary);');
  });

  it('uses theme font tokens in global and display chrome styles', (): void => {
    const resetSource = readSource('src/assets/styles/reset.less');
    const buttonSource = readSource('src/components/BButton/index.vue');

    expect(resetSource).toContain('font-family: var(--font-sans);');
    expect(resetSource).toContain('font-family: var(--font-mono);');
    expect(existsSync('src/assets/styles/theme-fonts.less')).toBe(false);
    expect(buttonSource).toContain('font-family: var(--font-display);');
  });

  it('uses interaction shadow tokens in pressable themed chrome', (): void => {
    const buttonSource = readSource('src/components/BButton/index.vue');
    const questionCardSource = readSource('src/components/BChat/components/QuestionCard.vue');

    expect(buttonSource).toContain('box-shadow: var(--button-shadow);');
    expect(buttonSource).toContain('box-shadow: var(--button-pressed-shadow);');
    expect(buttonSource).toContain('translate(var(--interaction-press-offset), var(--interaction-press-offset))');
    expect(questionCardSource).toContain('box-shadow: var(--interaction-raised-shadow);');
  });

  it('uses design tokens in remaining chat internals', (): void => {
    const editorSource = readSource('src/components/BSmart/Editor.vue');
    const imagePreviewSource = readSource('src/components/BChat/components/ImagePreview.vue');
    const todoPanelSource = readSource('src/components/BChat/components/TodoPanel.vue');
    const noticeSource = readSource('src/components/BChat/components/AgentTaskProjectionNotice.vue');
    const toastSource = readSource('src/components/BChat/components/InteractionContainer/ToastItem.vue');
    const bubblePartSource = readSource('src/components/BChat/components/MessageBubble/BubblePart/index.vue');
    const bubbleTextSource = readSource('src/components/BChat/components/MessageBubble/BubblePartText/index.vue');
    const bubbleAgentSource = readSource('src/components/BChat/components/MessageBubble/BubblePartAgent/index.vue');
    const bubbleStatusSource = readSource('src/components/BChat/components/MessageBubble/BubblePartStatus/index.vue');

    expect(editorSource).toContain('border-radius: var(--input-radius);');
    expect(editorSource).toContain('border: var(--input-border-width) solid var(--input-border);');
    expect(imagePreviewSource).toContain('border-radius: var(--surface-radius);');
    expect(todoPanelSource).toContain('border-radius: var(--surface-radius);');
    expect(noticeSource).toContain('border-radius: var(--surface-radius);');
    expect(toastSource).toContain('border-radius: var(--surface-radius);');
    expect(bubblePartSource).toContain('border-radius: var(--surface-radius);');
    expect(bubbleTextSource).toContain('border-radius: var(--surface-radius);');
    expect(bubbleAgentSource).toContain('border-radius: var(--surface-radius);');
    expect(bubbleStatusSource).toContain('border-radius: var(--radius-full);');
  });
});
