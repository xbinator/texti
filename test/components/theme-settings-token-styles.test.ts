/**
 * @file theme-settings-token-styles.test.ts
 * @description Verifies settings and provider chrome consume theme design tokens.
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

/**
 * 读取指定 CSS 选择器的规则体。
 * @param source - Vue 单文件组件源码
 * @param selector - CSS 选择器
 * @returns 规则体内容，未找到时返回空字符串
 */
function getRuleBody(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) {
    return '';
  }

  const bodyStart = source.indexOf('{', start) + 1;
  const bodyEnd = source.indexOf('\n}', bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

describe('settings theme token styles', (): void => {
  it('uses design tokens in settings and provider chrome', (): void => {
    const settingsPageSource = readSource('src/views/settings/_components/SettingsPage.vue');
    const settingsSectionSource = readSource('src/views/settings/_components/SettingsSection.vue');
    const providerLayoutSource = readSource('src/views/settings/provider/layout.vue');
    const providerCardSource = readSource('src/views/settings/provider/components/ProviderCard.vue');
    const providerInfoSource = readSource('src/views/settings/provider/components/ProviderInfo.vue');
    const modelListSource = readSource('src/views/settings/provider/components/ModelList.vue');
    const sidebarItemSource = readSource('src/views/settings/provider/components/SidebarItem.vue');
    const sidebarSearchSource = readSource('src/views/settings/provider/components/SidebarSearch.vue');
    const apiConfigSource = readSource('src/views/settings/provider/components/ApiConfig.vue');
    const sidebarSearchRule = getRuleBody(sidebarSearchSource, '.sidebar-search');

    expect(settingsPageSource).toContain('border-radius: var(--surface-radius);');
    expect(settingsSectionSource).toContain('border-radius: var(--surface-radius);');
    expect(providerLayoutSource).toContain('border-radius: var(--surface-radius);');
    expect(providerCardSource).toContain('border-radius: var(--surface-radius);');
    expect(providerInfoSource).toContain('border-radius: var(--surface-radius);');
    expect(modelListSource).toContain('border-radius: var(--surface-radius);');
    expect(sidebarItemSource).toContain('border-radius: var(--control-radius);');
    expect(sidebarSearchRule).toContain('flex: 1;');
    expect(sidebarSearchRule).toContain('min-width: 0;');
    expect(sidebarSearchRule).not.toContain('border:');
    expect(sidebarSearchRule).not.toContain('box-shadow:');
    expect(apiConfigSource).toContain('border-radius: var(--surface-radius);');
  });
});
