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

    expect(source).toContain("import ThinkingPart from './ThinkingPart.vue';");
    expect(source).toContain("import ToolCallPart from './ToolCallPart.vue';");
    expect(source).toContain("import ToolResultPart from './ToolResultPart.vue';");
    expect(source).toContain('<ThinkingPart');
    expect(source).toContain('<ToolCallPart');
    expect(source).toContain('<ToolResultPart');
  });

  test('renders text parts and attachments through dedicated child components', () => {
    const source = readSource('src/components/BChat/components/MessageBubble.vue');

    expect(source).toContain("import TextPart from './TextPart.vue';");
    expect(source).toContain("import MessageAttachmentsHeader from './MessageAttachmentsHeader.vue';");
    expect(source).toContain('<TextPart');
    expect(source).toContain('<MessageAttachmentsHeader');
  });
});
