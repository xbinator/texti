/**
 * @file skill-creator.test.ts
 * @description Skill 创建弹窗安装资源文件测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { defineComponent } from 'vue';
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SkillCreator from '@/views/settings/tools/skill/components/SkillCreator.vue';

/** Electron API mock。 */
const electronAPIMock = vi.hoisted(() => ({
  acquireDirectoryInstallLock: vi.fn<(path: string) => Promise<string>>(),
  ensureDir: vi.fn<(path: string) => Promise<void>>(),
  getHomeDir: vi.fn<() => Promise<string>>(),
  getPathStatus: vi.fn<(path: string) => Promise<{ exists: boolean }>>(),
  renameFile: vi.fn<(oldPath: string, newPath: string) => Promise<void>>(),
  releaseDirectoryInstallLock: vi.fn<(token: string) => Promise<void>>(),
  saveBinaryFile: vi.fn<(content: ArrayBuffer, path?: string) => Promise<string | null>>(),
  trashFile: vi.fn<(path: string) => Promise<void>>(),
  writeFile: vi.fn<(path: string, content: string) => Promise<void>>()
}));

/** Skill store rescan mock。 */
const rescanMock = vi.hoisted(() => vi.fn<() => Promise<void>>());

/** Ant Design message mock。 */
const messageMock = vi.hoisted(() => ({
  error: vi.fn<(content: string) => void>(),
  success: vi.fn<(content: string) => void>(),
  warning: vi.fn<(content: string) => void>()
}));

/** 持久化日志 mock。 */
const loggerMock = vi.hoisted(() => ({
  error: vi.fn<(content: string) => Promise<void>>(),
  info: vi.fn<(content: string) => Promise<void>>(),
  warn: vi.fn<(content: string) => Promise<void>>()
}));

vi.mock('@/shared/platform/electron-api', () => ({
  getElectronAPI: () => electronAPIMock,
  // 单测环境无真实 Electron，logger 走 console 分支，避免 mock 缺失导出导致 asyncTo 抛错。
  hasElectronAPI: () => false
}));

vi.mock('@/stores/ai/skill', () => ({
  useSkillStore: () => ({
    skills: [],
    rescan: rescanMock
  })
}));

vi.mock('ant-design-vue', () => ({
  message: messageMock
}));

vi.mock('@/shared/logger', () => ({
  logger: loggerMock
}));

vi.mock('@iconify/vue', () => ({
  Icon: {
    name: 'Icon',
    props: {
      icon: { type: String, required: true }
    },
    template: '<i class="icon-stub" :data-icon="icon"></i>'
  }
}));

/** Worker 成功响应资源。 */
interface WorkerResourceFixture {
  /** 资源路径。 */
  relativePath: string;
  /** 二进制内容。 */
  content: ArrayBuffer;
  /** 预览内容。 */
  previewContent: string;
}

/** Worker 成功响应。 */
interface WorkerSuccessFixture {
  /** 响应类型。 */
  type: 'success';
  /** Skill 解析结果。 */
  skill: {
    /** Skill 名称。 */
    name: string;
    /** Skill 描述。 */
    description: string;
  };
  /** 原始 SKILL.md 内容。 */
  rawSkillMd: string;
  /** 资源文件。 */
  resources: WorkerResourceFixture[];
  /** 警告列表。 */
  warnings: string[];
}

/** Worker 解析失败响应。 */
interface WorkerErrorFixture {
  /** 响应类型。 */
  type: 'error';
  /** 用户可见错误。 */
  error: string;
}

/** Worker 测试响应联合。 */
type WorkerResponseFixture = WorkerSuccessFixture | WorkerErrorFixture;

/** Worker 测试响应。 */
const workerSuccessResponse: WorkerSuccessFixture = {
  type: 'success',
  skill: {
    name: 'demo-skill',
    description: 'Demo skill'
  },
  rawSkillMd: '---\nname: demo-skill\ndescription: Demo skill\n---\n',
  resources: [
    {
      relativePath: 'assets/icon.bin',
      content: new Uint8Array([5, 6, 7]).buffer,
      previewContent: '二进制资源，无法预览（3 bytes）'
    }
  ],
  warnings: []
};

/**
 * 可由测试控制完成时机的 Promise。
 */
interface Deferred<T> {
  /** 延迟 Promise。 */
  promise: Promise<T>;
  /** 完成 Promise。 */
  resolve: (value: T) => void;
}

/**
 * 创建可控 Promise。
 * @returns 可控 Promise
 */
function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = (): void => undefined;
  const promise = new Promise<T>((resolve: (value: T) => void): void => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

/**
 * Worker 测试替身。
 */
class WorkerStub {
  /** 当前测试创建的 Worker 实例。 */
  // eslint-disable-next-line no-use-before-define -- 类级注册表需保留 WorkerStub 的完整实例类型。
  static instances: WorkerStub[] = [];

  /** postMessage 时触发的终态分支。 */
  static mode: 'success' | 'parse-error' | 'pending' = 'success';

  /** 成功消息回调。 */
  onmessage: ((event: MessageEvent<WorkerResponseFixture>) => void) | null = null;

  /** 错误消息回调。 */
  onerror: ((event: ErrorEvent) => void) | null = null;

  /** 终止调用 mock。 */
  terminate = vi.fn<() => void>();

  /** 登记新 Worker 实例。 */
  constructor() {
    WorkerStub.instances.push(this);
  }

  /**
   * 发送解析请求。
   */
  postMessage(): void {
    if (WorkerStub.mode === 'pending') return;
    const data: WorkerResponseFixture = WorkerStub.mode === 'parse-error' ? { type: 'error', error: 'Invalid skill package' } : workerSuccessResponse;
    this.onmessage?.({ data } as MessageEvent<WorkerResponseFixture>);
  }
}

/**
 * 弹窗测试替身。
 */
const BModalStub = defineComponent({
  name: 'BModal',
  props: {
    open: { type: Boolean, required: true },
    title: { type: String, default: '' }
  },
  emits: ['update:open', 'close'],
  template: '<section v-if="open"><h3>{{ title }}</h3><slot /><footer><slot name="footer" /></footer></section>'
});

/**
 * 上传组件测试替身。
 */
const BUploadStub = defineComponent({
  name: 'BUpload',
  emits: ['change', 'update:dragOver'],
  setup(_props, { emit }) {
    /**
     * 转发原生文件选择事件。
     * @param event - 原生变更事件
     */
    function handleChange(event: Event): void {
      if (event.target instanceof HTMLInputElement && event.target.files) {
        emit('change', event.target.files);
      }
    }

    return { handleChange };
  },
  template: '<div><slot></slot><input type="file" @change="handleChange" /></div>'
});

/**
 * 按钮测试替身。
 */
const BButtonStub = defineComponent({
  name: 'BButton',
  props: {
    loading: { type: Boolean, default: false },
    type: { type: String, default: 'primary' }
  },
  emits: ['click'],
  template: '<button type="button" :disabled="loading" @click="$emit(\'click\', $event)"><slot /></button>'
});

/**
 * Skill 预览测试替身。
 */
const SkillPreviewStub = defineComponent({
  name: 'SkillPreview',
  props: {
    virtualFiles: { type: Array, default: () => [] },
    initialFilePath: { type: String, default: '' }
  },
  template: '<div class="skill-preview-stub"></div>'
});

/**
 * 挂载 Skill 创建弹窗。
 * @returns 组件包装器
 */
function mountSkillCreator(): VueWrapper {
  return mount(SkillCreator, {
    props: {
      open: true
    },
    global: {
      components: {
        BUpload: BUploadStub
      },
      stubs: {
        ASpin: true,
        BButton: BButtonStub,
        BModal: BModalStub,
        SkillPreview: SkillPreviewStub
      }
    }
  });
}

/**
 * 查找指定文本按钮。
 * @param wrapper - 组件包装器
 * @param text - 按钮文本
 * @returns 按钮包装器
 */
function findButtonByText(wrapper: VueWrapper, text: string): DOMWrapper<HTMLButtonElement> {
  const button = wrapper.findAll<HTMLButtonElement>('button').find((item: DOMWrapper<HTMLButtonElement>): boolean => item.text().trim() === text);

  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }

  return button;
}

/**
 * 上传测试文件。
 * @param wrapper - 组件包装器
 * @param file - 可选自定义文件
 */
async function uploadSkillPackage(
  wrapper: VueWrapper,
  file: File = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'demo.skill', { type: 'application/zip' })
): Promise<void> {
  const input = wrapper.find<HTMLInputElement>('input[type="file"]');

  Object.defineProperty(input.element, 'files', {
    value: [file],
    configurable: true
  });
  await input.trigger('change');
  await flushPromises();
}

describe('SkillCreator', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
  });

  beforeEach((): void => {
    WorkerStub.instances = [];
    WorkerStub.mode = 'success';
    vi.stubGlobal('Worker', WorkerStub);
    electronAPIMock.acquireDirectoryInstallLock.mockReset();
    electronAPIMock.ensureDir.mockReset();
    electronAPIMock.getHomeDir.mockReset();
    electronAPIMock.getPathStatus.mockReset();
    electronAPIMock.renameFile.mockReset();
    electronAPIMock.releaseDirectoryInstallLock.mockReset();
    electronAPIMock.saveBinaryFile.mockReset();
    electronAPIMock.trashFile.mockReset();
    electronAPIMock.writeFile.mockReset();
    rescanMock.mockReset();
    messageMock.error.mockReset();
    messageMock.success.mockReset();
    messageMock.warning.mockReset();
    loggerMock.error.mockReset();
    loggerMock.info.mockReset();
    loggerMock.warn.mockReset();
    electronAPIMock.acquireDirectoryInstallLock.mockResolvedValue('skill-install-lock');
    electronAPIMock.ensureDir.mockResolvedValue(undefined);
    electronAPIMock.getHomeDir.mockResolvedValue('/Users/test');
    electronAPIMock.getPathStatus.mockResolvedValue({ exists: false });
    electronAPIMock.renameFile.mockResolvedValue(undefined);
    electronAPIMock.releaseDirectoryInstallLock.mockResolvedValue(undefined);
    electronAPIMock.saveBinaryFile.mockResolvedValue(null);
    electronAPIMock.trashFile.mockResolvedValue(undefined);
    electronAPIMock.writeFile.mockResolvedValue(undefined);
    rescanMock.mockResolvedValue(undefined);
    loggerMock.error.mockResolvedValue(undefined);
    loggerMock.info.mockResolvedValue(undefined);
    loggerMock.warn.mockResolvedValue(undefined);
  });

  it('writes imported resources as binary files during install', async (): Promise<void> => {
    const wrapper = mountSkillCreator();

    await uploadSkillPackage(wrapper);
    await findButtonByText(wrapper, '确定').trigger('click');
    await flushPromises();

    const saveBinaryFileCall = electronAPIMock.saveBinaryFile.mock.calls[0];
    const savedContent = saveBinaryFileCall?.[0] ?? new ArrayBuffer(0);

    expect(electronAPIMock.writeFile).toHaveBeenCalledWith(expect.stringContaining('/SKILL.md'), workerSuccessResponse.rawSkillMd);
    expect(saveBinaryFileCall?.[1]).toMatch(/\/assets\/icon\.bin$/u);
    expect(Array.from(new Uint8Array(savedContent))).toEqual([5, 6, 7]);
  });

  it('terminates the parser Worker after a successful response', async (): Promise<void> => {
    const wrapper = mountSkillCreator();

    await uploadSkillPackage(wrapper);

    expect(WorkerStub.instances[0]?.terminate).toHaveBeenCalledOnce();
  });

  it('terminates the parser Worker after a parse-error response', async (): Promise<void> => {
    WorkerStub.mode = 'parse-error';
    const wrapper = mountSkillCreator();

    await uploadSkillPackage(wrapper);

    expect(messageMock.error).toHaveBeenCalledWith('Invalid skill package');
    expect(WorkerStub.instances[0]?.terminate).toHaveBeenCalledOnce();
  });

  it('terminates an active parser Worker when the component unmounts', async (): Promise<void> => {
    WorkerStub.mode = 'pending';
    const wrapper = mountSkillCreator();

    await uploadSkillPackage(wrapper);
    wrapper.unmount();

    expect(WorkerStub.instances[0]?.terminate).toHaveBeenCalledOnce();
  });

  it('terminates the parser Worker when reading the selected file fails', async (): Promise<void> => {
    WorkerStub.mode = 'pending';
    const wrapper = mountSkillCreator();
    const file = new File([new Uint8Array([0x50, 0x4b])], 'broken.skill', { type: 'application/zip' });
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async (): Promise<ArrayBuffer> => Promise.reject(new Error('read failed')))
    });

    await uploadSkillPackage(wrapper, file);

    expect(messageMock.error).toHaveBeenCalledWith('读取 Skill 包失败');
    expect(WorkerStub.instances[0]?.terminate).toHaveBeenCalledOnce();
  });

  it('ignores repeated install clicks while an install is already running', async (): Promise<void> => {
    const deferredHomeDir = createDeferred<string>();
    electronAPIMock.getHomeDir.mockReturnValue(deferredHomeDir.promise);
    const wrapper = mountSkillCreator();

    await uploadSkillPackage(wrapper);
    const confirmButton = findButtonByText(wrapper, '确定');
    await confirmButton.trigger('click');
    confirmButton.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(electronAPIMock.getHomeDir).toHaveBeenCalledTimes(1);

    deferredHomeDir.resolve('/Users/test');
    await flushPromises();
  });

  it('keeps a completed install successful when list refresh fails', async (): Promise<void> => {
    rescanMock.mockRejectedValueOnce(new Error('scan failed'));
    const wrapper = mountSkillCreator();

    await uploadSkillPackage(wrapper);
    await findButtonByText(wrapper, '确定').trigger('click');
    await flushPromises();

    expect(electronAPIMock.renameFile).toHaveBeenCalledWith(expect.stringContaining('/.tmp-'), expect.stringContaining('/demo-skill'));
    expect(messageMock.error).not.toHaveBeenCalledWith(expect.stringContaining('安装失败'));
    expect(messageMock.warning).toHaveBeenCalledWith('技能 "demo-skill" 安装成功，但刷新列表失败，请稍后重试');
  });

  it('normalizes Windows home paths and records install stages', async (): Promise<void> => {
    electronAPIMock.getHomeDir.mockResolvedValue('C:\\Users\\test');
    const wrapper = mountSkillCreator();

    await uploadSkillPackage(wrapper);
    await findButtonByText(wrapper, '确定').trigger('click');
    await flushPromises();

    expect(electronAPIMock.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/^C:\/Users\/test\/\.agents\/skills\/\.tmp-.+\/SKILL\.md$/u),
      workerSuccessResponse.rawSkillMd
    );
    expect(loggerMock.info).toHaveBeenCalledWith('[skill-install] success resource=demo-skill');
  });

  it('shows and logs the original rename error after retries are exhausted', async (): Promise<void> => {
    const wrapper = mountSkillCreator();

    await uploadSkillPackage(wrapper);
    vi.useFakeTimers();
    electronAPIMock.renameFile.mockRejectedValue(new Error('EPERM: operation not permitted'));
    await findButtonByText(wrapper, '确定').trigger('click');
    await vi.runAllTimersAsync();
    await flushPromises();

    expect(messageMock.error).toHaveBeenCalledWith(expect.stringContaining('EPERM'));
    expect(loggerMock.error).toHaveBeenCalledWith(expect.stringContaining('[skill-install] failed resource=demo-skill stage=activate error=EPERM'));
    expect(electronAPIMock.renameFile).toHaveBeenCalledTimes(3);
  });
});
