/**
 * @file autoname-source.test.ts
 * @description 验证自动命名服务的类型、配置常量与设置页入口已接入
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 读取仓库内源码文件。
 * @param relativePath - 相对项目根目录的文件路径。
 * @returns UTF-8 源码文本。
 */
function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('autoname service integration source', () => {
  it('extends model service types with autoname', () => {
    const source = readSource('types/model.d.ts');

    expect(source).toContain("export type ModelServiceType = 'polish' | 'chat' | 'autoname';");
  });

  it('defines autoname prompt constants and renders a service config card', () => {
    const constantsSource = readSource('src/views/settings/service-model/constants.ts');
    const settingsSource = readSource('src/views/settings/service-model/index.vue');

    expect(constantsSource).toContain('AUTONAME_SERVICE_CONFIG_OPTIONS');
    expect(constantsSource).toContain('AUTONAME_DEFAULT_PROMPT');
    expect(settingsSource).toContain('service-type="autoname"');
    expect(settingsSource).toContain('AUTONAME_SERVICE_CONFIG_OPTIONS');
    expect(settingsSource).toContain('AUTONAME_DEFAULT_PROMPT');
  });
});
