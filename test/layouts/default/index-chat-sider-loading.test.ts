/**
 * @file index-chat-sider-loading.test.ts
 * @description 默认布局聊天侧栏挂载与加载策略测试。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const defaultLayoutSource = readFileSync(new URL('../../../src/layouts/default/index.vue', import.meta.url), 'utf8');

describe('Default layout chat sidebar mounting', (): void => {
  it('wraps the main router outlet with the layout file drop zone', (): void => {
    expect(defaultLayoutSource).toContain("import MainDropZone from './components/MainDropZone.vue';");
    expect(defaultLayoutSource).toContain('<MainDropZone class="b-layout__content__main">');
    expect(defaultLayoutSource).toContain('</MainDropZone>');
    expect(defaultLayoutSource).not.toContain('<div class="b-layout__content__main">');
  });

  it('imports ChatSider directly and lets it own animated visibility', (): void => {
    expect(defaultLayoutSource).toContain("import ChatSider from './components/ChatSider.vue';");
    expect(defaultLayoutSource).toContain('<ChatSider />');
    expect(defaultLayoutSource).not.toContain('<ChatSider v-show="settingStore.sidebarVisible" />');
    expect(defaultLayoutSource).not.toContain('<ChatSider v-if="settingStore.sidebarVisible" />');
    expect(defaultLayoutSource).not.toContain("defineAsyncComponent(() => import('./components/ChatSider.vue'))");
  });

  it('mounts the global command panel from the default layout', (): void => {
    expect(defaultLayoutSource).toContain('<BCommandPanel />');
    expect(defaultLayoutSource).toContain("import BCommandPanel from '@/components/BCommandPanel/index.vue';");
    expect(defaultLayoutSource).toContain("import { useCommandPanelStore } from '@/stores/ui/commandPanel';");
    expect(defaultLayoutSource).toContain('const commandPanelStore = useCommandPanelStore();');
    expect(defaultLayoutSource).toContain('commandPanelStore.openRecent()');
    expect(defaultLayoutSource).not.toContain('commandPanelRef');
    expect(defaultLayoutSource).not.toContain('visible.searchRecent');
    expect(defaultLayoutSource).not.toContain("defineAsyncComponent(() => import('@/components/BCommandPanel/index.vue'))");
  });

  it('keeps the optional help dialog as an async component', (): void => {
    expect(defaultLayoutSource).toContain("defineAsyncComponent(() => import('./components/ShortcutsHelp.vue'))");
    expect(defaultLayoutSource).toContain('<ShortcutsHelp v-model:visible="visible.shortcutsHelp" />');
    expect(defaultLayoutSource).not.toContain("defineAsyncComponent(() => import('@/components/BRecent/index.vue'))");
    expect(defaultLayoutSource).not.toContain("import ShortcutsHelp from './components/ShortcutsHelp.vue'");
  });
});
