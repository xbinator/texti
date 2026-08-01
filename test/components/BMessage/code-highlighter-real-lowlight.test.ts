/**
 * @file code-highlighter-real-lowlight.test.ts
 * @description 使用真实 lowlight 验证共享代码高亮器的语言归一化边界。
 */
import { describe, expect, it } from 'vitest';
import { highlightMessageCode, type CodeHighlightRenderNode } from '@/components/BMessage/utils/codeHighlight';

/**
 * 文本节点及其继承的高亮类名。
 */
interface TextClassSnapshot {
  /** 文本内容。 */
  text: string;
  /** 作用到文本上的 hljs 类名。 */
  className: string;
}

/**
 * 收集渲染节点中每段文本实际继承的高亮类名。
 * @param nodes - 高亮渲染节点列表
 * @param inheritedClassName - 父级继承的高亮类名
 * @returns 文本与类名快照
 */
function collectTextClasses(nodes: CodeHighlightRenderNode[], inheritedClassName = ''): TextClassSnapshot[] {
  return nodes.flatMap((node: CodeHighlightRenderNode): TextClassSnapshot[] => {
    if (node.type === 'text') return [{ text: node.value, className: inheritedClassName }];
    return collectTextClasses(node.children, node.className || inheritedClassName);
  });
}

/**
 * 查找包含指定文本片段的高亮快照。
 * @param snapshots - 文本与类名快照
 * @param text - 需要匹配的文本片段
 * @returns 匹配到的快照
 */
function findTextSnapshot(snapshots: TextClassSnapshot[], text: string): TextClassSnapshot | undefined {
  return snapshots.find((snapshot: TextClassSnapshot): boolean => snapshot.text.includes(text));
}

describe('highlightMessageCode with real lowlight', (): void => {
  it('keeps YAML frontmatter separate from Markdown section highlighting', (): void => {
    const markdown = ['---', 'name: fund-assistant', 'description: |', '  基金投资助手。', '  触发词: 基金、净值、估值', '---', '', '# 基金投资助手', ''].join(
      '\n'
    );

    const snapshots = collectTextClasses(highlightMessageCode('markdown', markdown, true));

    expect(findTextSnapshot(snapshots, '触发词')?.className).not.toContain('hljs-section');
    expect(findTextSnapshot(snapshots, '# 基金投资助手')?.className).toContain('hljs-section');
  });

  it('normalizes sh fences to Bash script highlighting', (): void => {
    const script = ['#!/usr/bin/env bash', 'set -euo pipefail', 'echo hi', 'if [ -f a ]; then exit 0; fi', ''].join('\n');

    const snapshots = collectTextClasses(highlightMessageCode('sh', script, true));

    expect(findTextSnapshot(snapshots, 'echo')?.className).toContain('hljs-built_in');
    expect(findTextSnapshot(snapshots, 'if')?.className).toContain('hljs-keyword');
  });
});
