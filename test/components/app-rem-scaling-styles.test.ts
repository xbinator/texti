/**
 * @file app-rem-scaling-styles.test.ts
 * @description 验证应用 UI 源码保留 px，由构建期插件统一转换 rem。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
 * 递归读取目录下的 Vue/Less/CSS 源码文件。
 * @param rootPath - 仓库相对根路径
 * @returns 源码文件路径列表
 */
function collectStyleSources(rootPath: string): string[] {
  const stats = statSync(rootPath);
  if (stats.isFile()) {
    return /\.(?:vue|less|css)$/u.test(rootPath) ? [rootPath] : [];
  }

  return readdirSync(rootPath).flatMap((entry: string): string[] => collectStyleSources(`${rootPath}/${entry}`));
}

/**
 * 已纳入应用 UI rem 字号迁移的目录。
 */
const APP_CHROME_STYLE_ROOTS = [
  'src/views/settings',
  'src/views/skill',
  'src/views/welcome',
  'src/views/error',
  'src/views/webview',
  'src/layouts/default',
  'src/components/BChat',
  'src/components/BMessage',
  'src/components/BBubble',
  'src/components/BSection',
  'src/components/BDropdown',
  'src/components/BToolbar',
  'src/components/BSegmented',
  'src/components/BModal',
  'src/components/BDrawer',
  'src/components/BCommandPanel',
  'src/components/BSkill',
  'src/components/BImageViewer',
  'src/components/BJsonViewer',
  'src/components/BColorPicker'
];

describe('app rem scaling styles', (): void => {
  it('does not keep app sizing tokens in global styles', (): void => {
    const globalStyleSource = readSource('src/assets/styles/index.less');

    expect(existsSync('src/assets/styles/app-size.less')).toBe(false);
    expect(globalStyleSource).not.toContain("@import './app-size.less';");
  });

  it('keeps design px values in source for build-time conversion', (): void => {
    const avatarSource = readSource('src/components/BBubble/components/Avatar.vue');
    const normalizeSource = readSource('src/assets/styles/normalize.less');
    const buttonSource = readSource('src/components/BButton/index.vue');

    expect(avatarSource).toContain('font-size: 12px;');
    expect(normalizeSource).toContain('font-size: 14px;');
    expect(buttonSource).toContain('height: 32px;');
  });

  it('connects the build-time px to rem plugin in Vite', (): void => {
    const viteSource = readSource('vite.config.ts');
    const pluginSource = readSource('build/pxToRem.ts');

    expect(viteSource).toContain("import { createRemPlugin } from './build/pxToRem.ts';");
    expect(viteSource).toContain('plugins: [createRemPlugin()]');
    expect(pluginSource).toContain('const DEFAULT_ROOT_VALUE = 14;');
  });

  it('adds a root font size setting entry in basic settings', (): void => {
    const settingsSource = readSource('src/views/settings/basic/index.vue');

    expect(settingsSource).toContain('大小');
    expect(settingsSource).toContain('<BInputNumber');
    expect(settingsSource).toContain(':control-width="280"');
    expect(settingsSource).toContain('@update:value="handleRootFontSizeChange"');
    expect(settingsSource).toContain('handleRootFontSizeChange');
    expect(settingsSource).toContain('settingStore.setRootFontSize');
    expect(settingsSource).not.toContain('rootFontSizeOptions');
    expect(settingsSource).not.toContain(':options="rootFontSizeOptions"');
  });

  it('adds a default font style select entry in basic settings', (): void => {
    const settingsSource = readSource('src/views/settings/basic/index.vue');
    const fontOptionsSource = readSource('src/views/settings/basic/fontOptions.ts');

    expect(settingsSource).toContain('默认字体样式');
    expect(settingsSource).toContain(':value="settingStore.defaultFontStyle"');
    expect(settingsSource).toContain(':options="defaultFontStyleOptions"');
    expect(settingsSource).toContain('@change="handleDefaultFontStyleChange"');
    expect(settingsSource).toContain('settingStore.setDefaultFontStyle');
    expect(settingsSource).toContain('getDefaultFontStyleOptions(getCurrentFontPlatform(), settingStore.defaultFontStyle)');
    expect(fontOptionsSource).toContain("label: '黑体'");
    expect(fontOptionsSource).toContain("label: '宋体'");
    expect(fontOptionsSource).toContain("label: '楷体'");
    expect(fontOptionsSource).toContain("label: '仿宋'");
    expect(fontOptionsSource).not.toContain("label: '系统默认'");
    expect(fontOptionsSource).not.toContain("label: '衬线字体'");
  });

  it('keeps basic settings chrome authored in px units', (): void => {
    const settingsItemSource = readSource('src/views/settings/basic/components/SettingsItem.vue');
    const permissionSource = readSource('src/views/settings/basic/components/ToolPermissionGrants.vue');

    expect(settingsItemSource).toContain('min-height: 56px;');
    expect(settingsItemSource).toContain('font-size: 12px;');
    expect(settingsItemSource).toContain('padding: 0 16px;');
    expect(settingsItemSource).not.toContain('var(--app-font-size-');
    expect(permissionSource).toContain('padding: 12px 16px 16px;');
    expect(permissionSource).not.toContain('var(--app-font-size-');
  });

  it('keeps core app chrome font sizes authored in px units', (): void => {
    const sources = [
      readSource('src/components/BButton/index.vue'),
      readSource('src/components/BSelect/index.vue'),
      readSource('src/views/settings/_components/SettingsPage.vue'),
      readSource('src/views/settings/_components/SettingsSection.vue'),
      readSource('src/layouts/default/components/HeaderTab.vue'),
      readSource('src/layouts/default/components/ChatSider.vue'),
      readSource('src/components/BChat/components/InputToolbar.vue'),
      readSource('src/components/BChat/components/MessageBubble.vue')
    ];

    for (const source of sources) {
      expect(source).toMatch(/font-size:\s*\d+(?:\.\d+)?px;/u);
      expect(source).not.toContain('var(--app-font-size-');
    }
  });

  it('keeps selected core app chrome spacing authored in px units', (): void => {
    const buttonSource = readSource('src/components/BButton/index.vue');
    const selectSource = readSource('src/components/BSelect/index.vue');
    const layoutSource = readSource('src/layouts/default/index.vue');

    expect(buttonSource).toContain('height: 32px;');
    expect(selectSource).toContain('padding: 8px 12px;');
    expect(layoutSource).toContain('height: 36px;');
  });

  it('does not leave app sizing tokens or rem units in migrated app chrome groups', (): void => {
    const offenders = APP_CHROME_STYLE_ROOTS.flatMap((rootPath: string): string[] =>
      collectStyleSources(rootPath).filter((filePath: string): boolean =>
        /--app-(?:font-size|space|control-height|icon-size)-|\b\d*\.?\d+rem\b/u.test(readSource(filePath))
      )
    );

    expect(offenders).toEqual([]);
  });
});
