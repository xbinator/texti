/**
 * @file panel-border-style.test.ts
 * @description 验证主要内容容器使用统一的主题内描边。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PANEL_BORDER_RULE = 'border: 1px solid var(--border-primary);';

/**
 * 需要统一内描边的容器目标。
 */
interface PanelBorderTarget {
  /** Vue 单文件组件路径 */
  filePath: string;
  /** 容器 CSS 选择器 */
  selector: string;
}

const PANEL_BORDER_TARGETS: PanelBorderTarget[] = [
  { filePath: 'src/views/settings/_components/SettingsPage.vue', selector: '.settings-page' },
  { filePath: 'src/layouts/default/components/ChatSider.vue', selector: '.chat-sider__content' },
  { filePath: 'src/views/settings/provider/layout.vue', selector: '.provider-layout' },
  { filePath: 'src/components/BEditor/Markdown.vue', selector: '.b-markdown-main' },
  { filePath: 'src/components/BEditor/components/Sidebar.vue', selector: '.b-markdown-sidebar' }
];

/** Widget 画布容器由外层页面承载边界，不直接绘制主容器边框。 */
const WIDGET_CANVAS_BORDER_TARGET: PanelBorderTarget = {
  filePath: 'src/components/BWidget/renderers/WidgetCanvas.vue',
  selector: '.b-widget-canvas'
};

/**
 * 读取源码文件。
 * @param filePath - 仓库相对路径
 * @returns 文件文本
 */
function readSource(filePath: string): string {
  return readFileSync(resolve(process.cwd(), filePath), 'utf8');
}

/**
 * 转义 CSS 选择器文本，供正则精确定位样式规则。
 * @param selector - CSS 选择器文本
 * @returns 已转义的正则片段
 */
function escapeSelector(selector: string): string {
  return selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * 读取指定选择器的首个规则体。
 * @param source - 样式源码
 * @param selector - CSS 选择器
 * @returns 规则体文本
 */
function readRuleBody(source: string, selector: string): string {
  const selectorMatcher = new RegExp(`(^|[\\s,])${escapeSelector(selector)}\\s*\\{`, 'u');
  const selectorMatch = selectorMatcher.exec(source);
  if (!selectorMatch) {
    throw new Error(`未找到选择器：${selector}`);
  }

  const openBraceIndex = selectorMatch.index + selectorMatch[0].lastIndexOf('{');
  if (openBraceIndex < 0) {
    throw new Error(`选择器缺少规则体：${selector}`);
  }

  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index++) {
    const char = source[index];
    if (char === '{') {
      depth++;
    }
    if (char === '}') {
      depth--;
    }
    if (depth === 0) {
      return source.slice(openBraceIndex + 1, index);
    }
  }

  throw new Error(`选择器规则体未闭合：${selector}`);
}

describe('panel border styles', (): void => {
  it('uses a direct theme-aware border on primary content containers', (): void => {
    for (const target of PANEL_BORDER_TARGETS) {
      const source = readSource(target.filePath);
      const ruleBody = readRuleBody(source, target.selector);

      expect(ruleBody, `${target.filePath} ${target.selector}`).toContain(PANEL_BORDER_RULE);
      expect(source, `${target.filePath} ${target.selector}`).not.toContain(`${target.selector}::after`);
    }
  });

  it('does not draw a direct border on the widget canvas container', (): void => {
    const source = readSource(WIDGET_CANVAS_BORDER_TARGET.filePath);
    const ruleBody = readRuleBody(source, WIDGET_CANVAS_BORDER_TARGET.selector);

    expect(ruleBody, `${WIDGET_CANVAS_BORDER_TARGET.filePath} ${WIDGET_CANVAS_BORDER_TARGET.selector}`).not.toContain(PANEL_BORDER_RULE);
  });
});
