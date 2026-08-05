/**
 * @file namespace.test.ts
 * @description 验证 BCommandPanel 模板通过 createNamespace 生成 BEM 类名。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const commandPanelSource = readFileSync(new URL('../../../src/components/BCommandPanel/index.vue', import.meta.url), 'utf8');
const templateSource = commandPanelSource.slice(0, commandPanelSource.indexOf('<script setup'));

describe('BCommandPanel namespace usage', (): void => {
  it('uses createNamespace for template classes', (): void => {
    expect(commandPanelSource).toContain("import { createNamespace } from '@/utils/namespace';");
    expect(commandPanelSource).toContain("const [, bem] = createNamespace('command-panel');");
    expect(templateSource).toContain(':class="bem()"');
    expect(templateSource).toContain(':class="bem(\'toolbar\')"');
    expect(templateSource).toContain(":class=\"bem('item'");
    expect(templateSource).not.toContain('class="b-command-panel');
  });

  it('uses TSX function components instead of defineComponent helpers', (): void => {
    expect(commandPanelSource).toContain('<script setup lang="tsx">');
    expect(commandPanelSource).toContain('function RenderItemIcon');
    expect(commandPanelSource).not.toContain('defineComponent');
  });

  it('handles async failures with asyncTo instead of console logging', (): void => {
    expect(commandPanelSource).toContain("import { asyncTo } from '@/utils/asyncTo';");
    expect(commandPanelSource).not.toContain('console.');
  });
});
