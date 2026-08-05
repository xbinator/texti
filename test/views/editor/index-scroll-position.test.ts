/**
 * @file index-scroll-position.test.ts
 * @description 编辑器页面加载、KeepAlive 滚动与空白文档聚焦生命周期测试。
 * @vitest-environment jsdom
 */
import { defineComponent, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EditorPage from '@/views/editor/index.vue';

const bEditorMethods = vi.hoisted(() => ({
  focusEditorAtStart: vi.fn(),
  rememberScrollPosition: vi.fn(),
  restoreScrollPosition: vi.fn(),
  mountContents: [] as string[]
}));

/** 编辑器页面会话测试运行时引用。 */
const sessionRuntime = vi.hoisted(() => ({
  isLoading: null as { value: boolean } | null
}));

/** useSession 返回的加载状态测试数据。 */
const sessionLoadingState = vi.hoisted(() => ({ value: false }));

/** useSession 返回的文件状态测试数据。 */
const sessionFileState = vi.hoisted(() => ({
  value: {
    id: 'scroll-file',
    name: 'scroll.md',
    path: '/workspace/scroll.md' as string | null,
    ext: 'md',
    content: '# Scroll'
  }
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({
    params: { id: 'scroll-file' }
  })
}));

vi.mock('@/components/BEditor/index.vue', async () => {
  const { defineComponent: defineVueComponent, h } = await import('vue');

  return {
    default: defineVueComponent({
      name: 'BEditor',
      props: {
        value: {
          type: Object,
          required: true
        },
        active: {
          type: Boolean,
          default: true
        }
      },
      emits: ['update:value', 'editor-blur', 'rename-file', 'save', 'save-as', 'copy-path', 'show-in-folder'],
      setup(props, { expose }) {
        const editorValue = props.value as { content?: unknown };
        bEditorMethods.mountContents.push(typeof editorValue.content === 'string' ? editorValue.content : '');

        expose({
          undo: vi.fn(),
          redo: vi.fn(),
          canUndo: (): boolean => false,
          canRedo: (): boolean => false,
          focusEditor: vi.fn(),
          focusEditorAtStart: bEditorMethods.focusEditorAtStart,
          setSearchTerm: vi.fn(),
          findNext: vi.fn(),
          findPrevious: vi.fn(),
          clearSearch: vi.fn(),
          getSelection: (): null => null,
          insertAtCursor: vi.fn(),
          replaceSelection: vi.fn(),
          replaceDocument: vi.fn(),
          selectLineRange: vi.fn(),
          getSearchState: () => ({ currentIndex: 0, matchCount: 0, term: '' }),
          scrollToAnchor: vi.fn(),
          getActiveAnchorId: (): string => '',
          rememberScrollPosition: bEditorMethods.rememberScrollPosition,
          restoreScrollPosition: bEditorMethods.restoreScrollPosition
        });

        return (): ReturnType<typeof h> => h('div', { class: 'b-editor-stub' });
      }
    })
  };
});

vi.mock('@/views/editor/hooks/useSession', async () => {
  const { ref: vueRef } = await import('vue');

  return {
    useSession: () => {
      const isLoading = vueRef(sessionLoadingState.value);
      sessionRuntime.isLoading = isLoading;

      return {
        fileState: vueRef({ ...sessionFileState.value }),
        isLoading,
        actions: {
          onEditorBlur: vi.fn(),
          onRename: vi.fn(),
          onSave: vi.fn(),
          onSaveAs: vi.fn(),
          onCopyPath: vi.fn(),
          onShowInFolder: vi.fn()
        }
      };
    }
  };
});

vi.mock('@/views/editor/hooks/useBindings', () => ({
  useBindings: vi.fn()
}));

vi.mock('@/views/editor/hooks/useFileSelection', () => ({
  useFileSelection: vi.fn()
}));

/**
 * 挂载 KeepAlive 包裹的编辑器页面。
 * @returns 测试宿主上下文
 */
function mountKeepAliveEditorPage(): { visible: { value: boolean } } {
  const visible = ref(true);

  mount(
    defineComponent({
      name: 'EditorPageKeepAliveHarness',
      components: { EditorPage },
      setup() {
        return { visible };
      },
      template: '<KeepAlive><EditorPage v-if="visible" /></KeepAlive>'
    })
  );

  return { visible };
}

describe('editor page scroll position lifecycle', () => {
  beforeEach((): void => {
    vi.clearAllMocks();
    bEditorMethods.mountContents.length = 0;
    sessionRuntime.isLoading = null;
    sessionLoadingState.value = false;
    sessionFileState.value = {
      id: 'scroll-file',
      name: 'scroll.md',
      path: '/workspace/scroll.md',
      ext: 'md',
      content: '# Scroll'
    };
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    });
  });

  it('waits for initial file loading before mounting BEditor', async (): Promise<void> => {
    sessionLoadingState.value = true;
    sessionFileState.value = {
      id: 'loaded-file',
      name: 'loaded.md',
      path: '/workspace/loaded.md',
      ext: 'md',
      content: '# Loaded'
    };

    const wrapper = mount(EditorPage);
    await nextTick();

    expect(wrapper.find('.b-editor-stub').exists()).toBe(false);
    expect(bEditorMethods.mountContents).toEqual([]);

    const loadingState = sessionRuntime.isLoading;
    if (!loadingState) {
      throw new Error('Editor session loading ref was not initialized');
    }

    loadingState.value = false;
    await nextTick();

    expect(wrapper.find('.b-editor-stub').exists()).toBe(true);
    expect(bEditorMethods.mountContents).toEqual(['# Loaded']);
  });

  it('asks BEditor to remember and restore scroll position around KeepAlive tab switches', async (): Promise<void> => {
    const { visible } = mountKeepAliveEditorPage();

    await nextTick();

    visible.value = false;
    await nextTick();

    expect(bEditorMethods.rememberScrollPosition).toHaveBeenCalledTimes(1);

    visible.value = true;
    await nextTick();
    await nextTick();

    expect(bEditorMethods.restoreScrollPosition).toHaveBeenCalledTimes(1);
  });

  it('focuses an empty unsaved document after the editor mounts', async (): Promise<void> => {
    sessionFileState.value = {
      id: 'new-file',
      name: 'Untitled',
      path: null,
      ext: 'md',
      content: ''
    };

    mountKeepAliveEditorPage();

    await nextTick();
    await nextTick();

    expect(bEditorMethods.focusEditorAtStart).toHaveBeenCalledTimes(1);
  });
});
