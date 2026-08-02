/**
 * @file use-chat-composer-file-mentions.test.ts
 * @description 验证 BChat 输入组合层根据手动工作区切换 @ 文件候选来源。
 * @vitest-environment jsdom
 */
import { defineComponent, ref, type Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { InteractionAPI } from '@/components/BChat/components/InteractionContainer/types';
import { useChatComposer } from '@/components/BChat/hooks/useChatComposer';
import type { FileMentionOption } from '@/components/BSmart/types';

/** 最近文件候选测试夹具。 */
interface RecentMentionFixture {
  /** 文件唯一 ID。 */
  id: string;
  /** 记录类型。 */
  type?: 'file';
  /** 文件名。 */
  name: string;
  /** 文件路径。 */
  path: string | null;
  /** 文件扩展名。 */
  ext: string;
  /** 最近打开时间。 */
  openedAt?: number;
}

/** 测试替身状态。 */
interface ComposerMentionMocks {
  /** 最近文件列表。 */
  recentFiles: RecentMentionFixture[];
  /** 工作区文件候选。 */
  workspaceMentions: FileMentionOption[];
  /** 最近文件初始化。 */
  ensureLoaded: Mock<() => Promise<void>>;
  /** 模型初始化。 */
  loadSelectedModel: Mock<() => Promise<void>>;
}

/** BChat Composer 相关依赖测试替身。 */
const mocks = vi.hoisted(
  (): ComposerMentionMocks => ({
    recentFiles: [],
    workspaceMentions: [],
    ensureLoaded: vi.fn<() => Promise<void>>(),
    loadSelectedModel: vi.fn<() => Promise<void>>()
  })
);

vi.mock('@/stores/workspace/recent', () => ({
  useRecentStore: () => ({
    recentFiles: mocks.recentFiles,
    ensureLoaded: mocks.ensureLoaded
  })
}));

vi.mock('@/hooks/useFileDrop', () => ({
  useFileDrop: () => ({
    isDragging: ref(false)
  })
}));

vi.mock('@/components/BChat/hooks/useModelSelection', () => ({
  useModelSelection: () => ({
    selectedModel: ref(undefined),
    supportsVision: ref(false),
    contextWindow: ref(200000),
    loadSelectedModel: mocks.loadSelectedModel,
    resolveSelectedModel: vi.fn(),
    onModelChange: vi.fn()
  })
}));

vi.mock('@/components/BChat/hooks/useFileReference', () => ({
  useFileReference: () => ({
    onPasteFiles: vi.fn(() => ''),
    insertReference: vi.fn()
  })
}));

vi.mock('@/components/BChat/hooks/useImageUpload', () => ({
  useImageUpload: () => ({
    canAcceptImages: vi.fn(() => false),
    validateIncomingImages: vi.fn(),
    appendImages: vi.fn(),
    onPasteImages: vi.fn()
  })
}));

vi.mock('@/components/BChat/hooks/useWorkspaceMentions', () => ({
  useWorkspaceMentions: () => ({
    fileMentions: {
      get value(): FileMentionOption[] {
        return mocks.workspaceMentions;
      }
    },
    loading: ref(false),
    error: ref(null),
    refresh: vi.fn()
  })
}));

/** 已挂载的测试组件。 */
const mountedWrappers: VueWrapper[] = [];

/**
 * 创建最近文件夹具。
 * @param overrides - 覆盖字段
 * @returns 最近文件夹具
 */
function createRecentFile(overrides: Partial<RecentMentionFixture>): RecentMentionFixture {
  return {
    id: 'recent-md',
    type: 'file',
    name: 'notes',
    path: '/workspace/notes.md',
    ext: 'md',
    openedAt: 1,
    ...overrides
  };
}

/**
 * 创建工作区文件候选。
 * @param overrides - 覆盖字段
 * @returns 文件提及候选
 */
function createWorkspaceMention(overrides: Partial<FileMentionOption>): FileMentionOption {
  return {
    id: 'src/main.ts',
    name: 'main.ts',
    path: 'src/main.ts',
    ext: 'ts',
    ...overrides
  };
}

/**
 * 挂载使用 useChatComposer 的测试组件。
 * @param workspaceRoot - 当前工作区根目录
 * @param workspaceOverride - 手动工作区覆盖
 * @returns useChatComposer 返回值
 */
function mountComposer(workspaceRoot: Ref<string | null>, workspaceOverride: Ref<string | undefined>): ReturnType<typeof useChatComposer> {
  let composer: ReturnType<typeof useChatComposer> | undefined;
  const TestHarness = defineComponent({
    name: 'UseChatComposerHarness',
    setup() {
      composer = useChatComposer({
        activeSessionId: ref(null),
        containerRef: ref(null),
        promptEditorRef: ref(undefined),
        interactionAPI: {
          showToast: vi.fn()
        } satisfies InteractionAPI,
        openFile: vi.fn((): Promise<void> => Promise.resolve()),
        openSkill: vi.fn(),
        workspaceRoot,
        workspaceOverride
      });
      return (): null => null;
    }
  });

  const wrapper = mount(TestHarness);
  mountedWrappers.push(wrapper);
  if (!composer) throw new Error('useChatComposer did not initialize');
  return composer;
}

describe('useChatComposer file mention sources', (): void => {
  beforeEach((): void => {
    mocks.recentFiles = [];
    mocks.workspaceMentions = [];
    mocks.ensureLoaded.mockReset();
    mocks.loadSelectedModel.mockReset();
    mocks.ensureLoaded.mockResolvedValue(undefined);
    mocks.loadSelectedModel.mockResolvedValue(undefined);
  });

  afterEach((): void => {
    mountedWrappers.splice(0).forEach((wrapper: VueWrapper): void => {
      wrapper.unmount();
    });
  });

  it('uses recent Markdown files when no manual workspace is selected', (): void => {
    mocks.recentFiles = [
      createRecentFile({ id: 'recent-md', name: 'notes', path: '/workspace/notes.md', ext: 'md' }),
      createRecentFile({ id: 'recent-ts', name: 'main', path: '/workspace/main.ts', ext: 'ts' })
    ];
    mocks.workspaceMentions = [createWorkspaceMention({ id: 'src/main.ts' })];

    const composer = mountComposer(ref('/default-workspace'), ref<string | undefined>(undefined));

    expect(composer.fileMentionOptions.value).toEqual([
      {
        id: 'recent-md',
        name: 'notes',
        path: '/workspace/notes.md',
        ext: 'md'
      }
    ]);
  });

  it('uses workspace file mentions when a manual workspace is selected', (): void => {
    const workspaceMention = createWorkspaceMention({ id: 'src/main.ts', name: 'main.ts', path: 'src/main.ts', ext: 'ts' });
    mocks.recentFiles = [createRecentFile({ id: 'recent-md', name: 'notes', path: '/workspace/notes.md', ext: 'md' })];
    mocks.workspaceMentions = [workspaceMention];

    const composer = mountComposer(ref('/manual-workspace'), ref('/manual-workspace'));

    expect(composer.fileMentionOptions.value).toEqual([workspaceMention]);
  });

  it('does not mix recent files when a manual workspace is selected but unavailable', (): void => {
    mocks.recentFiles = [createRecentFile({ id: 'recent-md', name: 'notes', path: '/workspace/notes.md', ext: 'md' })];
    mocks.workspaceMentions = [];

    const composer = mountComposer(ref(null), ref('/manual-workspace'));

    expect(composer.fileMentionOptions.value).toEqual([]);
  });

  it('prioritizes recently opened files inside the selected manual workspace', (): void => {
    const olderMention = createWorkspaceMention({ id: 'src/older.ts', name: 'older.ts', path: 'src/older.ts', ext: 'ts' });
    const recentMention = createWorkspaceMention({ id: 'src/recent.ts', name: 'recent.ts', path: 'src/recent.ts', ext: 'ts' });
    mocks.workspaceMentions = [olderMention, recentMention];
    mocks.recentFiles = [
      createRecentFile({
        id: 'recent-ts',
        name: 'recent.ts',
        path: '/manual-workspace/src/recent.ts',
        ext: 'ts',
        openedAt: 100
      })
    ];

    const composer = mountComposer(ref('/manual-workspace'), ref('/manual-workspace'));

    expect(composer.fileMentionOptions.value).toEqual([recentMention, olderMention]);
  });

  it('preserves workspace scan order when no recent file rank applies', (): void => {
    const shallowMention = createWorkspaceMention({ id: 'README.md', name: 'README.md', path: 'README.md', ext: 'md' });
    const nestedMention = createWorkspaceMention({ id: 'a/nested.ts', name: 'nested.ts', path: 'a/nested.ts', ext: 'ts' });
    mocks.workspaceMentions = [shallowMention, nestedMention];
    mocks.recentFiles = [];

    const composer = mountComposer(ref('/manual-workspace'), ref('/manual-workspace'));

    expect(composer.fileMentionOptions.value).toEqual([shallowMention, nestedMention]);
  });
});
