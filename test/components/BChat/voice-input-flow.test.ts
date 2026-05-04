/**
 * @file voice-input-flow.test.ts
 * @description 语音输入在聊天侧边栏中的当前接线回归测试。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * 读取源码内容。
 * @param relativePath - 仓库相对路径
 * @returns 文件源码
 */
function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf-8');
}

describe('BChat voice input flow', () => {
  test('mounts VoiceInput inside the toolbar and forwards voice lifecycle events', () => {
    const toolbarSource = readSource('src/components/BChatSidebar/components/InputToolbar.vue');

    expect(toolbarSource).toContain("import VoiceInput from './InputToolbar/VoiceInput.vue';");
    expect(toolbarSource).toContain('@start="emit(\'voice-start\')"');
    expect(toolbarSource).toContain('@complete="handleVoiceComplete"');
    expect(toolbarSource).toContain("(e: 'voice-start'): void;");
    expect(toolbarSource).toContain("(e: 'voice-complete', payload: { text: string }): void;");
  });

  test('wires the voice completion event from the toolbar into the sidebar handler', () => {
    const sidebarSource = readSource('src/components/BChatSidebar/index.vue');

    expect(sidebarSource).toContain('function handleVoiceComplete(payload: { text: string }): void {');
    expect(sidebarSource).toContain("message.error('语音转写结果为空，请重试');");
    expect(sidebarSource).toContain('insertTextAtCursor(payload.text);');
    expect(sidebarSource).toContain('@voice-complete="handleVoiceComplete"');
  });
});
