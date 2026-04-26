/**
 * @file message-bubble-part-source.test.ts
 * @description MessageBubble 片段子组件拆分回归测试。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * 读取源码文件。
 * @param relativePath - 仓库相对路径
 * @returns 源码内容
 */
function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf-8');
}

describe('MessageBubble part extraction', () => {
  test('renders thinking and tool parts through dedicated child components', () => {
    const source = readSource('src/components/BChat/components/MessageBubble.vue');

    expect(source).toContain("import BubblePartThinking from './MessageBubble/BubblePartThinking.vue';");
    expect(source).toContain("import BubblePartToolCall from './MessageBubble/BubblePartToolCall.vue';");
    expect(source).toContain("import BubblePartToolResult from './MessageBubble/BubblePartToolResult.vue';");
    expect(source).toContain('<BubblePartThinking');
    expect(source).toContain('<BubblePartToolCall');
    expect(source).toContain('<BubblePartToolResult');
  });

  test('renders text parts through a dedicated child component while keeping attachments in MessageBubble', () => {
    const source = readSource('src/components/BChat/components/MessageBubble.vue');

    expect(source).toContain("import BubblePartText from './MessageBubble/BubblePartText.vue';");
    expect(source).toContain('<BubblePartText');
    expect(source).not.toContain("import MessageBubbleHeaderAttachments from './MessageBubbleHeaderAttachments.vue';");
  });
});
