/**
 * @file index.page-width.test.ts
 * @description 验证 BEditor 正文区页宽设置映射。
 */
/* @vitest-environment jsdom */

import { defineComponent } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount, VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BEditor from '@/components/BEditor/index.vue';
import { useSettingStore } from '@/stores/setting';

const storage = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem(key: string): string | null {
    return storage.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    storage.set(key, value);
  },
  removeItem(key: string): void {
    storage.delete(key);
  },
  clear(): void {
    storage.clear();
  }
});

/**
 * 滚动容器占位组件。
 */
const ScrollbarStub = defineComponent({
  name: 'BScrollbar',
  template: '<div class="scrollbar-stub"><slot /></div>'
});

/**
 * 挂载编辑器组件。
 * @returns BEditor 挂载结果
 */
function mountEditor(): VueWrapper {
  return mount(BEditor, {
    props: {
      value: '# Title',
      title: 'Doc'
    },
    global: {
      stubs: {
        BScrollbar: ScrollbarStub,
        BEditorSidebar: true,
        FindBar: true,
        PaneRichEditor: true,
        PaneSourceEditor: true
      }
    }
  });
}

/**
 * 挂载编辑器并等待异步子组件完成收敛，避免测试环境销毁时仍有动态导入悬挂。
 * @returns 已稳定的编辑器挂载结果
 */
async function mountSettledEditor(): Promise<VueWrapper> {
  const wrapper = mountEditor();
  await flushPromises();
  return wrapper;
}

describe('BEditor page width', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('uses 900px max width in default mode', async () => {
    const wrapper = await mountSettledEditor();
    expect(wrapper.find('.b-editor-container').attributes('style')).toContain('--editor-page-max-width: 900px;');
    wrapper.unmount();
  });

  it('uses 1200px max width in wide mode', async () => {
    const settingStore = useSettingStore();
    settingStore.setEditorPageWidth('wide');

    const wrapper = await mountSettledEditor();
    expect(wrapper.find('.b-editor-container').attributes('style')).toContain('--editor-page-max-width: 1200px;');
    wrapper.unmount();
  });

  it('uses none max width in full mode', async () => {
    const settingStore = useSettingStore();
    settingStore.setEditorPageWidth('full');

    const wrapper = await mountSettledEditor();
    expect(wrapper.find('.b-editor-container').attributes('style')).toContain('--editor-page-max-width: none;');
    wrapper.unmount();
  });
});
