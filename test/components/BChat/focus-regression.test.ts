/**
 * @file focus-regression.test.ts
 * @description BChat 输入框聚焦链路回归测试，确保新建会话后会重新聚焦输入框
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * 读取组件源码，便于做轻量级回归断言。
 * @param relativePath - 相对仓库根目录的源码路径
 * @returns 源码字符串
 */
function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf-8');
}

describe('BChat focus exposure', () => {
  test('keeps a focus helper that forwards focus to BPromptEditor', () => {
    const source = readSource('src/components/BChatSidebar/index.vue');

    expect(source).toContain('const promptEditorRef = ref<InstanceType<typeof BPromptEditor>>();');
    expect(source).toContain('function focusInput(): void');
    expect(source).toContain('promptEditorRef.value?.focus();');
  });
});

describe('BChat stream busy state', () => {
  test('disables sidebar session changes while streaming', () => {
    const sidebarSource = readSource('src/components/BChatSidebar/index.vue');
    const sessionHistorySource = readSource('src/components/BChatSidebar/components/SessionHistory.vue');
    const sessionHookSource = readSource('src/components/BChatSidebar/hooks/useSession.ts');

    expect(sidebarSource).not.toContain(':disabled="chatBusy"');
    expect(sidebarSource).toContain(':disabled="chatStream.loading.value"');
    expect(sessionHookSource).toContain('if (options.isStreamLoading()) return;');
    expect(sessionHistorySource).toContain('disabled?: boolean;');
  });
});

describe('BChat user choice continuation', () => {
  test('resolves service config again when a restored pending choice is answered', () => {
    const source = readSource('src/components/BChatSidebar/hooks/useChatStream.ts');

    expect(source).toContain('const config = lastServiceConfig ?? (await resolveServiceConfig());');
    expect(source).not.toContain('if (loading.value || !lastServiceConfig)');
  });
});

describe('BChat history pagination', () => {
  test('emits history loading from the chat container and anchors prepended messages', () => {
    const chatSource = readSource('src/components/BChatSidebar/index.vue');
    const conversationSource = readSource('src/components/BChatSidebar/components/ConversationView.vue');
    const scrollSource = readSource('src/components/BChatSidebar/hooks/useChatScroll.ts');

    expect(chatSource).toContain(':on-load-history="handleLoadHistory"');
    expect(chatSource).toContain('async function handleLoadHistory(): Promise<void>');
    expect(conversationSource).toContain('onLoadHistory?: () => Promise<void> | void;');
    expect(scrollSource).toContain('async function withScrollAnchor(callback: () => Promise<void> | void): Promise<void>');
    expect(scrollSource).toContain('onLoadHistory?.();');
  });
});

describe('BChatSidebar new session focus', () => {
  test('focuses the chat input after resetting the current session', () => {
    const sidebarSource = readSource('src/components/BChatSidebar/index.vue');
    const sessionHookSource = readSource('src/components/BChatSidebar/hooks/useSession.ts');

    expect(sidebarSource).toContain('const promptEditorRef = ref<InstanceType<typeof BPromptEditor>>();');
    expect(sessionHookSource).toContain('await nextTick();');
    expect(sessionHookSource).toContain('settingStore.setChatSidebarActiveSessionId(null);');
    expect(sessionHookSource).toContain('options.focusInput();');
  });
});
