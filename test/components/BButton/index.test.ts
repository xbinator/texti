/**
 * @file index.test.ts
 * @description 验证 BButton 的 soft 类型声明与主题背景样式。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 读取 BButton 组件源码。
 * @returns BButton 单文件组件源码
 */
function readButtonComponentSource(): string {
  return readFileSync('src/components/BButton/index.vue', 'utf8');
}

/**
 * 读取 BButton 类型源码。
 * @returns BButton 类型定义源码
 */
function readButtonTypesSource(): string {
  return readFileSync('src/components/BButton/types.ts', 'utf8');
}

/**
 * 转义正则特殊字符。
 * @param value - 需要转义的文本
 * @returns 可安全拼接到正则中的文本
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 断言指定 CSS 规则块中包含声明。
 * @param source - 组件源码
 * @param selector - CSS 选择器
 * @param declarations - 期望存在的 CSS 声明
 */
function expectRuleToContainDeclarations(source: string, selector: string, declarations: string[]): void {
  const rulePattern = new RegExp(`${escapeRegExp(selector)}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
  const ruleContent = rulePattern.exec(source)?.[1] ?? '';

  expect(ruleContent).not.toBe('');
  declarations.forEach((declaration: string): void => {
    expect(ruleContent).toContain(declaration);
  });
}

describe('BButton', (): void => {
  it('声明 soft 公共类型', (): void => {
    const source = readButtonTypesSource();

    expect(source).toContain("'soft'");
  });

  it('定义 soft 类型的主题色文字和浅色背景样式', (): void => {
    const source = readButtonComponentSource();

    expectRuleToContainDeclarations(source, '.b-button--soft', ['color: var(--color-primary);', 'background: var(--color-primary-bg);']);
    expectRuleToContainDeclarations(source, '.b-button--danger.b-button--soft', ['color: var(--color-danger);', 'background: var(--color-danger-bg);']);
  });

  it('使用主题设计 Token 控制基础圆角与动效', (): void => {
    const source = readButtonComponentSource();

    expectRuleToContainDeclarations(source, '.b-button', [
      'border: var(--button-border-width) solid var(--button-border);',
      'border-radius: var(--control-radius);',
      'box-shadow: var(--button-shadow);'
    ]);
    expectRuleToContainDeclarations(source, '&:active:not(.b-button--disabled, .b-button--loading)', [
      'box-shadow: var(--button-pressed-shadow);',
      'transform: translate(var(--interaction-press-offset), var(--interaction-press-offset));'
    ]);
    expect(source).toContain('var(--motion-duration-base)');
    expect(source).toContain('var(--motion-duration-fast)');
    expect(source).toContain('var(--motion-easing-standard)');
    expect(source).toContain('var(--motion-easing-press)');
    expectRuleToContainDeclarations(source, '&--rounded', ['border-radius: var(--radius-full);']);
    expectRuleToContainDeclarations(source, '&--square', ['border-radius: var(--control-radius);']);
  });
});
