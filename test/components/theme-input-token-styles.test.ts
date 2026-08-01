/**
 * @file theme-input-token-styles.test.ts
 * @description Verifies input chrome consumes theme-level input tokens.
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

describe('theme input token styles', (): void => {
  it('uses input shell and keycap tokens in the command panel search box', (): void => {
    const commandPanelSource = readSource('src/components/BCommandPanel/index.vue');
    const resetSource = readSource('src/assets/styles/reset.less');

    expect(commandPanelSource).toContain(`:class="bem('search-shell')"`);
    expect(commandPanelSource).toContain(':bordered="false"');
    expect(commandPanelSource).toContain('icon="lucide:search"');
    expect(commandPanelSource).toContain(`:class="bem('search-keycap')"`);
    expect(commandPanelSource).toContain('border: var(--input-border-width) solid var(--input-border);');
    expect(commandPanelSource).toContain('border-radius: var(--input-radius);');
    expect(commandPanelSource).toContain('box-shadow: var(--input-shadow);');
    expect(commandPanelSource).toContain('padding: var(--input-padding-block) var(--input-padding-inline);');
    expect(commandPanelSource).toContain('gap: var(--input-gap);');
    expect(commandPanelSource).toContain('font-family: var(--input-font-family);');
    expect(commandPanelSource).toContain('color: var(--input-placeholder-color);');
    expect(commandPanelSource).toContain('border: var(--input-keycap-border-width) solid var(--input-border);');
    expect(commandPanelSource).toContain('min-width: var(--input-keycap-size);');
    expect(commandPanelSource).toContain('border-radius: var(--input-keycap-radius);');
    expect(commandPanelSource).not.toContain('--input-height');
    expect(resetSource).toContain('.ant-input.ant-input:not(.ant-input-borderless)');
  });

  it('uses input tokens in smart editors and chat composer shells', (): void => {
    const smartEditorSource = readSource('src/components/BSmart/Editor.vue');
    const smartInputSource = readSource('src/components/BSmart/Input.vue');
    const chatSource = readSource('src/components/BChat/index.vue');

    expect(smartEditorSource).toContain('font-family: var(--input-font-family);');
    expect(smartEditorSource).toContain('border: var(--input-border-width) solid var(--input-border);');
    expect(smartEditorSource).toContain('border-radius: var(--input-radius);');
    expect(smartEditorSource).toContain('box-shadow: var(--input-active-shadow);');
    expect(smartInputSource).toContain('border-radius: var(--input-radius);');
    expect(smartInputSource).toContain('font-family: var(--input-font-family);');
    expect(smartInputSource).toContain('color: var(--input-icon-color);');
    expect(chatSource).toContain('border: var(--input-border-width) solid var(--input-border);');
    expect(chatSource).toContain('border-radius: var(--input-radius);');
    expect(chatSource).toContain('box-shadow: var(--input-shadow);');
  });

  it('uses compact input tokens in settings search and webview address fields', (): void => {
    const sidebarSearchSource = readSource('src/views/settings/provider/components/SidebarSearch.vue');
    const modelListSource = readSource('src/views/settings/provider/components/ModelList.vue');
    const resetSource = readSource('src/assets/styles/reset.less');
    const webAddressSource = readSource('src/views/webview/web/components/AddressBar.vue');
    const nativeAddressSource = readSource('src/views/webview/native/components/AddressBar.vue');

    expect(sidebarSearchSource).toContain('<AInput');
    expect(sidebarSearchSource).toContain('class="sidebar-search"');
    expect(sidebarSearchSource).toContain('allow-clear');
    expect(sidebarSearchSource).toContain('<template #prefix>');
    expect(resetSource).toMatch(/body\s*\{[\s\S]*?\.ant-input\.ant-input/u);
    expect(resetSource).toMatch(/body\s*\{[\s\S]*?\.ant-input-affix-wrapper\.ant-input-affix-wrapper/u);
    expect(resetSource).toMatch(/body\s*\{[\s\S]*?\.ant-input-affix-wrapper\.ant-input-affix-wrapper \.ant-input\.ant-input/u);
    expect(resetSource).toMatch(/body\s*\{[\s\S]*?\.ant-input-affix-wrapper\.ant-input-affix-wrapper-focused \.ant-input\.ant-input/u);
    expect(resetSource).toContain('border: 0;');
    expect(modelListSource).toContain('class="search-input"');
    expect(modelListSource).toContain('border-radius: var(--input-radius);');
    expect(modelListSource).toContain('font-family: var(--input-font-family);');
    expect(webAddressSource).toContain('border: var(--input-border-width) solid var(--input-border);');
    expect(webAddressSource).toContain('border-radius: var(--input-radius);');
    expect(webAddressSource).toContain('color: var(--input-placeholder-color);');
    expect(nativeAddressSource).toContain('border: var(--input-border-width) solid var(--input-border);');
    expect(nativeAddressSource).toContain('border-radius: var(--input-radius);');
    expect(nativeAddressSource).toContain('color: var(--input-placeholder-color);');
  });

  it('applies input shadows to Ant Design input and select controls globally', (): void => {
    const globalIndexSource = readSource('src/assets/styles/index.less');
    const selectSource = readSource('src/components/BSelect/index.vue');
    const resetSource = readSource('src/assets/styles/reset.less');

    expect(globalIndexSource).toContain("@import './reset.less';");
    expect(globalIndexSource).not.toContain("@import './theme-inputs.less';");
    expect(existsSync('src/assets/styles/theme-inputs.less')).toBe(false);
    expect(selectSource).toContain('border: var(--input-border-width) solid var(--input-border);');
    expect(selectSource).toContain('box-shadow: var(--input-shadow);');
    expect(selectSource).toContain('&.ant-select.ant-select-focused:not(.ant-select-customize-input),');
    expect(selectSource).toContain('&.ant-select.ant-select-open:not(.ant-select-customize-input)');
    expect(selectSource).toContain('box-shadow: var(--input-active-shadow);');
    expect(selectSource).toContain('outline: none;');
    expect(resetSource).toContain('.ant-input.ant-input:not(.ant-input-borderless)');
    expect(resetSource).toContain('.ant-input-affix-wrapper.ant-input-affix-wrapper:not(.ant-input-affix-wrapper-borderless)');
    expect(resetSource).toContain('.ant-select.ant-select:not(.ant-select-customize-input, .ant-select-borderless) .ant-select-selector.ant-select-selector');
    expect(resetSource).toContain(
      '.ant-select.ant-select.ant-select-focused:not(.ant-select-customize-input, .ant-select-borderless) .ant-select-selector.ant-select-selector'
    );
    expect(resetSource).toContain(
      '.ant-select.ant-select.ant-select-open:not(.ant-select-customize-input, .ant-select-borderless) .ant-select-selector.ant-select-selector'
    );
    expect(resetSource).toContain('border-color: var(--input-focus-border);');
    expect(resetSource).toContain('box-shadow: var(--input-shadow);');
    expect(resetSource).toContain('box-shadow: var(--input-active-shadow);');
    expect(resetSource).toContain('outline: none;');
  });
});
