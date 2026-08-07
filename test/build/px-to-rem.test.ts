/**
 * @file px-to-rem.test.ts
 * @description 验证构建期 px 转 rem 插件的换算和排除规则。
 */
import { describe, expect, it } from 'vitest';

/**
 * PostCSS 声明节点测试接口。
 */
interface CssDeclaration {
  /** CSS 声明值 */
  value: string;
}

/**
 * 测试使用的 PostCSS 插件结构。
 */
interface CssPostcssPlugin {
  /**
   * 执行 CSS 根节点转换。
   * @param root - CSS 根节点
   * @param api - PostCSS 插件上下文
   */
  Once(root: { walkDecls(callback: (decl: CssDeclaration) => void): void }, api: { result: { opts: { from: string } } }): void;
}

/**
 * px 转 rem 插件模块结构。
 */
interface PxToRemModule {
  /**
   * 创建 px 转 rem 插件。
   * @returns PostCSS 插件
   */
  createRemPlugin(): CssPostcssPlugin;
}

/**
 * 判断动态加载结果是否为 px 转 rem 插件模块。
 * @param value - 动态 import 结果
 * @returns 是否为插件模块
 */
function isPxToRemModule(value: unknown): value is PxToRemModule {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as { createRemPlugin?: unknown };
  return typeof candidate.createRemPlugin === 'function';
}

/**
 * 动态加载构建插件，避免根 tsconfig 静态引用 node 子项目源文件。
 * @returns px 转 rem 插件模块
 */
async function loadPxToRemModule(): Promise<PxToRemModule> {
  const moduleUrl = new URL('../../build/pxToRem.ts', import.meta.url).href;
  const moduleValue = (await import(moduleUrl)) as unknown;

  if (!isPxToRemModule(moduleValue)) {
    throw new TypeError('Invalid px to rem plugin module');
  }

  return moduleValue;
}

/**
 * 使用测试根节点执行插件转换。
 * @param value - 待转换的 CSS 声明值
 * @param from - 源文件路径
 * @returns 转换后的 CSS 声明值
 */
async function transformValue(value: string, from: string): Promise<string> {
  const declaration: CssDeclaration = { value };
  const { createRemPlugin } = await loadPxToRemModule();
  const plugin = createRemPlugin();

  plugin.Once(
    {
      walkDecls(callback: (decl: CssDeclaration) => void): void {
        callback(declaration);
      }
    },
    { result: { opts: { from } } }
  );

  return declaration.value;
}

describe('px to rem plugin', (): void => {
  it('converts source px values from the 14px design baseline', async (): Promise<void> => {
    const value = await transformValue('14px 12px calc(100% - 28px)', '/repo/src/components/BButton/index.vue');

    expect(value).toBe('1rem 0.8571rem calc(100% - 2rem)');
  });

  it('keeps one-pixel precision values unchanged', async (): Promise<void> => {
    const value = await transformValue('0 1px 2px rgba(0, 0, 0, 0.2)', '/repo/src/layouts/default/index.vue');

    expect(value).toBe('0 1px 0.1429rem rgba(0, 0, 0, 0.2)');
  });

  it('skips excluded editor and widget sources', async (): Promise<void> => {
    const editorValue = await transformValue('14px 12px', '/repo/src/components/BEditor/Markdown.vue');
    const widgetValue = await transformValue('16px 24px', '/repo/src/views/widget/components/PageSetter.vue');

    expect(editorValue).toBe('14px 12px');
    expect(widgetValue).toBe('16px 24px');
  });

  it('does not rewrite quoted text or urls', async (): Promise<void> => {
    const value = await transformValue('"14px" url("/icons/12px/icon.png") 28px', '/repo/src/components/BModal/index.vue');

    expect(value).toBe('"14px" url("/icons/12px/icon.png") 2rem');
  });
});
