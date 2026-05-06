/**
 * @file summarize-source.test.ts
 * @description 验证摘要模型服务类型与设置页入口已接入。
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

describe('summarize service integration source', () => {
  it('extends model service types with summarize', () => {
    const source = readSource('types/model.d.ts');

    expect(source).toContain("export type ModelServiceType = 'polish' | 'chat' | 'autoname' | 'summarize';");
  });

  it('renders a summarize service config card in settings', () => {
    const settingsSource = readSource('src/views/settings/service-model/index.vue');

    expect(settingsSource).toContain('service-type="summarize"');
    expect(settingsSource).toContain('title="会话历史压缩助理"');
    expect(settingsSource).toContain('description="指定用于压缩和摘要会话历史的模型"');
    expect(settingsSource).toContain(':show-prompt="false"');
  });
});
