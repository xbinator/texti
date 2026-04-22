/**
 * @file message-bubble-confirmation-source.test.ts
 * @description 确认卡片组件拆分回归测试。
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

describe('MessageBubble confirmation card extraction', () => {
  test('renders confirmations through a dedicated confirmation card component', () => {
    const source = readSource('src/components/BChat/components/MessageBubble.vue');

    expect(source).toContain("import ConfirmationCard from './ConfirmationCard.vue';");
    expect(source).toContain('<ConfirmationCard');
    expect(source).toContain('@confirmation-action="$emit(\'confirmation-action\', $event.confirmationId, $event.action)"');
  });

  test('keeps confirmation card class names on the shared namespace helper', () => {
    const source = readSource('src/components/BChat/components/ConfirmationCard.vue');

    expect(source).toContain("import { createNamespace } from '@/utils/namespace';");
    expect(source).toContain("createNamespace('confirmation-card')");
  });
});
