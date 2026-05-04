/**
 * @file index.test.ts
 * @description 验证语音组件设置页已接入设置路由、菜单和核心动作。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 读取源码内容。
 * @param relativePath - 仓库相对路径
 * @returns 文件源码
 */
function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf-8');
}

describe('Speech settings wiring', () => {
  it('registers the speech settings menu item and route', () => {
    const constantsSource = readSource('src/views/settings/constants.ts');
    const routesSource = readSource('src/router/routes/modules/settings.ts');

    expect(constantsSource).toContain("export type SettingsMenuKey = 'provider' | 'service-model' | 'speech' | 'logger';");
    expect(constantsSource).toContain("{ key: 'speech', label: '语音组件', icon: 'lucide:mic', path: '/settings/speech' }");
    expect(routesSource).toContain("path: 'speech'");
    expect(routesSource).toContain("name: 'speech'");
    expect(routesSource).toContain("import('@/views/settings/speech/index.vue')");
  });

  it('renders speech settings actions and runtime controls in the page source', () => {
    const pageSource = readSource('src/views/settings/speech/index.vue');

    expect(pageSource).toContain('getSpeechRuntimeStatus');
    expect(pageSource).toContain('installSpeechRuntime');
    expect(pageSource).toContain('removeSpeechRuntime');
    expect(pageSource).toContain('Modal.delete');
    expect(pageSource).toContain("message.success('语音组件已安装');");
    expect(pageSource).toContain("message.success('语音组件已删除');");
  });
});
