/**
 * @file scheduling.test.ts
 * @description BMessage 解析调度接入测试。
 * @vitest-environment jsdom
 */
import type { VueWrapper } from '@vue/test-utils';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BMessage from '@/components/BMessage/index.vue';
import type { ParseMessageNodesOptions, ParseMessageNodesResult } from '@/components/BMessage/types';
import type { MessageRenderTask } from '@/components/BMessage/utils/messageScheduler';

/**
 * BMessage 组件公开属性类型。
 */
type BMessagePublicProps = InstanceType<typeof BMessage>['$props'];

/**
 * 调度器 mock。
 */
interface SchedulerMock {
  /** 当前每个实例的最新任务。 */
  tasks: Map<symbol, MessageRenderTask>;
  /** 任务入队 mock。 */
  enqueue: ReturnType<typeof vi.fn>;
  /** 任务取消 mock。 */
  cancel: ReturnType<typeof vi.fn>;
}

const schedulerMock = vi.hoisted((): SchedulerMock => {
  const tasks = new Map<symbol, MessageRenderTask>();
  return {
    tasks,
    enqueue: vi.fn((task: MessageRenderTask): void => {
      tasks.set(task.token, task);
    }),
    cancel: vi.fn((token: symbol): void => {
      tasks.delete(token);
    })
  };
});

const parseMessageNodesMock = vi.hoisted(() =>
  vi.fn<(options: ParseMessageNodesOptions) => ParseMessageNodesResult>(
    (options: ParseMessageNodesOptions): ParseMessageNodesResult => ({
      blocks: options.content
        ? [
            {
              type: 'paragraph',
              id: options.content,
              raw: options.content,
              children: [{ type: 'text', text: options.content }]
            }
          ]
        : [],
      images: []
    })
  )
);

/** 可手动完成的 Worker 解析请求。 */
interface WorkerParseFixture {
  /** 请求 ID。 */
  requestId: number;
  /** 解析快照。 */
  options: ParseMessageNodesOptions;
  /** 请求结果。 */
  result: Promise<ParseMessageNodesResult>;
  /** 完成请求。 */
  resolve: (result: ParseMessageNodesResult) => void;
  /** 拒绝请求。 */
  reject: (error: Error) => void;
}

/** Worker manager mock。 */
interface WorkerManagerMock {
  /** 已创建请求。 */
  requests: WorkerParseFixture[];
  /** 创建请求。 */
  parse: ReturnType<typeof vi.fn>;
  /** 取消请求。 */
  cancel: ReturnType<typeof vi.fn>;
  /** 重置 mock。 */
  reset: () => void;
}

const workerManagerMock = vi.hoisted((): WorkerManagerMock => {
  let requestSequence = 0;
  const requests: WorkerParseFixture[] = [];
  const parse = vi.fn((options: ParseMessageNodesOptions): { requestId: number; result: Promise<ParseMessageNodesResult> } => {
    requestSequence += 1;
    let resolveRequest: (result: ParseMessageNodesResult) => void = (): void => undefined;
    let rejectRequest: (error: Error) => void = (): void => undefined;
    const result = new Promise<ParseMessageNodesResult>((resolve, reject): void => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    requests.push({ requestId: requestSequence, options, result, resolve: resolveRequest, reject: rejectRequest });
    return { requestId: requestSequence, result };
  });
  const cancel = vi.fn();
  return {
    requests,
    parse,
    cancel,
    reset: (): void => {
      requestSequence = 0;
      requests.splice(0);
      parse.mockClear();
      cancel.mockClear();
    }
  };
});

vi.mock('@/components/BMessage/utils/messageScheduler', () => ({
  messageRenderScheduler: schedulerMock
}));

vi.mock('@/components/BMessage/utils/messageParser', () => ({
  parseMessageNodes: parseMessageNodesMock
}));

vi.mock('@/components/BMessage/utils/messageWorker', () => ({
  parseMessageInWorker: workerManagerMock.parse,
  cancelMessageParse: workerManagerMock.cancel
}));

vi.mock('@/hooks/useNavigate', () => ({
  useNavigate: (): { onLink: ReturnType<typeof vi.fn> } => ({
    onLink: vi.fn()
  })
}));

vi.mock('@/hooks/useImagePreview', () => ({
  useImagePreview: (): { previewImage: ReturnType<typeof vi.fn> } => ({
    previewImage: vi.fn()
  })
}));

let intersectionCallback: IntersectionObserverCallback | null = null;
let intersectionRoot: Element | Document | null = null;
const observeMock = vi.fn();
const unobserveMock = vi.fn();
const disconnectMock = vi.fn();

/**
 * 可手动触发的 IntersectionObserver 测试替身。
 */
class TestIntersectionObserver {
  /** 观察根节点。 */
  readonly root: Element | Document | null;

  /** 根节点扩展范围。 */
  readonly rootMargin: string;

  /** 观察阈值。 */
  readonly thresholds: readonly number[];

  /**
   * 创建观察器替身。
   * @param callback - 相交回调
   * @param options - 观察配置
   */
  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    intersectionCallback = callback;
    intersectionRoot = options.root ?? null;
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? '0px';
    this.thresholds = Array.isArray(options.threshold) ? options.threshold : [options.threshold ?? 0];
  }

  /** 停止全部观察。 */
  disconnect(): void {
    disconnectMock();
  }

  /** 开始观察元素。 */
  observe(target: Element): void {
    observeMock(target);
  }

  /** 读取待处理记录。 */
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /**
   * 停止观察元素。
   * @param target - 目标元素
   */
  unobserve(target: Element): void {
    unobserveMock(target);
  }
}

/**
 * 获取当前唯一待执行任务。
 * @returns 待执行任务
 */
function getOnlyTask(): MessageRenderTask {
  const task = [...schedulerMock.tasks.values()][0];
  expect(task).toBeDefined();
  return task as MessageRenderTask;
}

/**
 * 创建 Worker 返回的最小节点结果。
 * @param text - 可观察文本
 * @returns 解析结果
 */
function createWorkerResult(text: string): ParseMessageNodesResult {
  return {
    blocks: [{ type: 'paragraph', id: text, raw: text, children: [{ type: 'text', text }] }],
    images: []
  };
}

describe('BMessage scheduling', (): void => {
  beforeEach((): void => {
    schedulerMock.tasks.clear();
    schedulerMock.enqueue.mockClear();
    schedulerMock.cancel.mockClear();
    parseMessageNodesMock.mockClear();
    workerManagerMock.reset();
    intersectionCallback = null;
    intersectionRoot = null;
    observeMock.mockClear();
    unobserveMock.mockClear();
    disconnectMock.mockClear();
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('queues parsing instead of parsing synchronously and commits only the latest snapshot', async (): Promise<void> => {
    const wrapper = mount(BMessage, { props: { content: 'first', type: 'markdown' } });
    const staleTask = getOnlyTask();
    await wrapper.setProps({ content: 'latest' } as Partial<BMessagePublicProps>);

    expect(parseMessageNodesMock).not.toHaveBeenCalled();
    expect(schedulerMock.tasks.size).toBe(1);

    staleTask.run();
    expect(parseMessageNodesMock).not.toHaveBeenCalled();

    getOnlyTask().run();
    await wrapper.vm.$nextTick();

    expect(parseMessageNodesMock).toHaveBeenCalledOnce();
    expect(parseMessageNodesMock).toHaveBeenCalledWith({ content: 'latest', mode: 'markdown', loading: false });
    expect(wrapper.text()).toContain('latest');
  });

  it('queues bulk mounts without synchronously parsing every instance', (): void => {
    const wrappers: VueWrapper[] = Array.from(
      { length: 20 },
      (_, index: number): VueWrapper => mount(BMessage, { props: { content: `message-${index}`, type: 'markdown' } })
    );

    expect(parseMessageNodesMock).not.toHaveBeenCalled();
    expect(schedulerMock.tasks.size).toBe(20);

    wrappers.forEach((wrapper: VueWrapper): void => wrapper.unmount());
  });

  it('promotes queued work when it enters the nearest scroll container preload area', (): void => {
    const scrollRoot = document.createElement('div');
    scrollRoot.style.overflowY = 'auto';
    document.body.appendChild(scrollRoot);
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement): DOMRect {
      return this === scrollRoot ? new DOMRect(0, 0, 200, 100) : new DOMRect(0, 500, 200, 0);
    });
    const wrapper = mount(BMessage, {
      attachTo: scrollRoot,
      props: { content: 'queued', type: 'markdown' }
    });

    expect(intersectionRoot).toBe(scrollRoot);
    expect(getOnlyTask().priority).toBe('normal');

    const callback = intersectionCallback;
    expect(callback).not.toBeNull();
    callback?.([{ isIntersecting: true, target: wrapper.element } as IntersectionObserverEntry], {} as IntersectionObserver);

    expect(getOnlyTask().priority).toBe('high');

    wrapper.unmount();
    rectSpy.mockRestore();
  });

  it('cancels queued parsing when the component unmounts', (): void => {
    const wrapper = mount(BMessage, { props: { content: 'queued', type: 'markdown' } });
    const token = [...schedulerMock.tasks.keys()][0];
    const queuedTask = getOnlyTask();

    wrapper.unmount();
    queuedTask.run();

    expect(schedulerMock.cancel).toHaveBeenCalledWith(token);
    expect(schedulerMock.tasks.size).toBe(0);
    expect(parseMessageNodesMock).not.toHaveBeenCalled();
  });

  it('falls back to text nodes when initial markdown parsing fails', async (): Promise<void> => {
    parseMessageNodesMock.mockImplementationOnce((): never => {
      throw new Error('markdown parse failed');
    });
    const wrapper = mount(BMessage, { props: { content: '**raw**', type: 'markdown' } });

    getOnlyTask().run();
    await wrapper.vm.$nextTick();

    expect(parseMessageNodesMock).toHaveBeenNthCalledWith(1, { content: '**raw**', mode: 'markdown', loading: false });
    expect(parseMessageNodesMock).toHaveBeenNthCalledWith(2, { content: '**raw**', mode: 'text', loading: false });
    expect(wrapper.text()).toContain('**raw**');
  });

  it('replaces an older render with current text when a later main-thread parse fails', async (): Promise<void> => {
    const wrapper = mount(BMessage, { props: { content: 'old content', type: 'markdown' } });
    getOnlyTask().run();
    await wrapper.vm.$nextTick();
    parseMessageNodesMock.mockImplementationOnce((): never => {
      throw new RangeError('nested markdown');
    });

    await wrapper.setProps({ content: '**current raw**' } as Partial<BMessagePublicProps>);
    getOnlyTask().run();
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('**current raw**');
    expect(wrapper.text()).not.toContain('old content');
  });

  it('uses the Worker for large Markdown and ignores a stale late result', async (): Promise<void> => {
    const firstContent = 'first '.repeat(6_000);
    const latestContent = 'latest '.repeat(6_000);
    const wrapper = mount(BMessage, { props: { content: firstContent, type: 'markdown', loading: true } });
    getOnlyTask().run();
    const firstRequest = workerManagerMock.requests[0];

    await wrapper.setProps({ content: latestContent } as Partial<BMessagePublicProps>);
    getOnlyTask().run();
    const latestRequest = workerManagerMock.requests[1];
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain(latestContent.slice(0, 100));
    firstRequest.resolve(createWorkerResult('stale worker result'));
    await flushPromises();

    expect(wrapper.text()).not.toContain('stale worker result');
    latestRequest.resolve(createWorkerResult('latest worker result'));
    await flushPromises();

    expect(workerManagerMock.cancel).toHaveBeenCalledWith(firstRequest.requestId);
    expect(wrapper.text()).toContain('latest worker result');
  });

  it('shows current raw text when Worker parsing fails', async (): Promise<void> => {
    const content = '**worker raw** '.repeat(3_000);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation((): void => undefined);
    const wrapper = mount(BMessage, { props: { content, type: 'markdown' } });
    getOnlyTask().run();

    workerManagerMock.requests[0].reject(new RangeError('worker stack'));
    await flushPromises();

    expect(parseMessageNodesMock).toHaveBeenCalledWith({ content, mode: 'text', loading: false });
    expect(wrapper.text()).toContain('**worker raw**');
    expect(consoleSpy).toHaveBeenCalledWith(
      '[BMessage] message parse failed',
      expect.objectContaining({ errorType: 'RangeError', length: content.length, path: 'worker' })
    );
  });

  it('cancels an active Worker subscription when unmounted', (): void => {
    const wrapper = mount(BMessage, { props: { content: 'large '.repeat(6_000), type: 'markdown' } });
    getOnlyTask().run();
    const [{ requestId }] = workerManagerMock.requests;

    wrapper.unmount();

    expect(workerManagerMock.cancel).toHaveBeenCalledWith(requestId);
  });
});
