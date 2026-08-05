/**
 * @file widget-runtime.test.ts
 * @description BChat 小组件消息运行态脚本测试。
 */
import type { WidgetData, WidgetHttpClient } from 'types/widget';
import { reactive } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultWidgetData } from '@/components/BWidget/utils/widgetData';
import { createDefaultWidgetExecuteMethod } from '@/components/BWidget/utils/widgetExecuteMethod';
import {
  createWidgetRuntimeSession,
  createWidgetRuntimeInstance as createWidgetRuntimeInstanceBase,
  executeWidgetRuntime,
  initWidgetMountState as initWidgetMountStateBase,
  mountWidgetRuntime,
  type WidgetRuntimeState
} from '@/components/BWidget/utils/widgetRuntime';
import type { WidgetRuntimePatch } from '@/components/BWidget/utils/widgetRuntime/patch';
import { runSandboxCode } from '@/utils/sandbox';

/** 测试环境没有浏览器 Worker，显式允许走本地 fallback。 */
const TEST_WIDGET_RUN_OPTIONS = {
  useWorker: false
} satisfies NonNullable<Parameters<typeof initWidgetMountStateBase>[1]>;

/**
 * Worker run 消息。
 */
interface CloneCheckingRunMessage {
  /** 消息类型。 */
  type: 'run';
  /** 沙箱运行 ID。 */
  runId: string;
}

/**
 * 判断值是否是 Worker run 消息。
 * @param value - 待判断值
 * @returns 是否是 Worker run 消息
 */
function isCloneCheckingRunMessage(value: unknown): value is CloneCheckingRunMessage {
  if (typeof value !== 'object' || value === null) return false;

  const record = value as { type?: unknown; runId?: unknown };

  return record.type === 'run' && typeof record.runId === 'string';
}

/** 校验 postMessage 载荷可结构化克隆的 Worker 测试替身。 */
class CloneCheckingWorkerMock {
  /** Worker 消息处理器。 */
  public onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

  /** Worker 错误处理器。 */
  public onerror: ((event: ErrorEvent) => void) | null = null;

  /**
   * 校验主线程消息可结构化克隆，并返回一个空运行结果。
   * @param message - 主线程消息
   */
  public postMessage(message: unknown): void {
    const clonedMessage = structuredClone(message);

    if (!isCloneCheckingRunMessage(clonedMessage)) return;

    queueMicrotask((): void => {
      this.onmessage?.({
        data: {
          type: 'done',
          runId: clonedMessage.runId,
          result: {
            value: {
              data: {},
              dataChanged: false,
              lifecycleExecuted: true
            }
          }
        }
      } as MessageEvent<unknown>);
    });
  }

  /**
   * 终止 Worker。
   */
  public terminate(): void {
    // 该替身不持有真实 Worker 资源，无需额外释放。
  }
}

/**
 * 初始化测试小组件。
 * @param part - 小组件消息片段
 * @param options - 运行选项
 * @returns 初始化后的消息片段
 */
function initWidgetMountState(
  part: WidgetRuntimeState,
  options: NonNullable<Parameters<typeof initWidgetMountStateBase>[1]> = {}
): ReturnType<typeof initWidgetMountStateBase> {
  return initWidgetMountStateBase(part, { ...TEST_WIDGET_RUN_OPTIONS, ...options });
}

/**
 * 创建测试小组件运行态实例。
 * @param part - 小组件消息片段
 * @param options - 运行选项
 * @returns 小组件运行态实例
 */
function createWidgetRuntimeInstance(
  part: WidgetRuntimeState,
  options: NonNullable<Parameters<typeof createWidgetRuntimeInstanceBase>[1]> = {}
): ReturnType<typeof createWidgetRuntimeInstanceBase> {
  return createWidgetRuntimeInstanceBase(part, { ...TEST_WIDGET_RUN_OPTIONS, ...options });
}

/**
 * 创建测试用 Widget 数据。
 * @param code - JS 脚本代码
 * @returns Widget 数据
 */
function createWidgetData(code: string): WidgetData {
  return {
    ...createDefaultWidgetData(),
    execute: {
      code
    }
  };
}

/**
 * 创建测试用小组件消息片段。
 * @param code - JS 脚本代码
 * @returns 小组件消息片段
 */
function createWidgetPart(code: string): WidgetRuntimeState {
  return {
    value: createWidgetData(code),
    renderContext: {
      input: {
        city: '上海'
      },
      output: undefined,
      data: {}
    }
  };
}

/**
 * 创建使用新 execute 上下文的测试运行态状态。
 * @param code - JS 脚本代码
 * @param input - open_widget 输入
 * @returns 小组件运行态状态
 */
function createExecuteWidgetPart(code: string, input: Record<string, unknown> = { city: '上海' }): WidgetRuntimeState {
  return {
    value: createWidgetData(code),
    renderContext: {
      input,
      output: undefined,
      data: {}
    }
  };
}

describe('widgetRuntime', (): void => {
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('does not use local sandbox fallback unless explicitly requested', async (): Promise<void> => {
    await expect(runSandboxCode({ code: 'return 1' })).rejects.toThrow('当前环境不支持 Worker');
  });

  it('runs onExecute before onMounted and exposes readonly input and output context', async (): Promise<void> => {
    const part = createExecuteWidgetPart(
      [
        'export default class Weather extends Widget {',
        '  async onExecute() {',
        '    this.result = this.$input.city',
        '    return { city: this.$input.city, ok: true }',
        '  }',
        '  onMounted() {',
        '    this.message = this.$output.city',
        '  }',
        '}'
      ].join('\n'),
      { city: '杭州' }
    );

    const executeResult = await executeWidgetRuntime(part, TEST_WIDGET_RUN_OPTIONS);
    const mountedResult = await mountWidgetRuntime(executeResult.state, TEST_WIDGET_RUN_OPTIONS);

    expect(executeResult.execution).toEqual({ status: 'success', output: { city: '杭州', ok: true } });
    expect(executeResult.state.renderContext.output).toEqual({ city: '杭州', ok: true });
    expect(mountedResult.state.renderContext.data.message).toBe('杭州');
  });

  it('does not expose sendMessage calls made inside onExecute', async (): Promise<void> => {
    const part = createExecuteWidgetPart(
      [
        'export default class Weather extends Widget {',
        '  onExecute() {',
        "    this.$sendMessage('should stay inside execute phase')",
        '    return { ok: true }',
        '  }',
        '}'
      ].join('\n')
    );

    const result = await executeWidgetRuntime(part, TEST_WIDGET_RUN_OPTIONS);

    expect(result.execution).toEqual({ status: 'success', output: { ok: true } });
    expect('sendMessage' in result).toBe(false);
  });

  it('runs mounted from default exported Widget class and writes data fields', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class Weather extends Widget {',
        '  weather = {',
        "    city: '',",
        '    temperature: 0',
        '  }',
        '',
        '  async onMounted(): Promise<void> {',
        '    this.weather.city = this.$input.city',
        '    this.weather.temperature = 28',
        '  }',
        '}'
      ].join('\n')
    );

    const nextPart = await initWidgetMountState(part);

    expect(part.renderContext.data).toEqual({});
    expect(nextPart).toMatchObject({
      renderContext: {
        input: {
          city: '上海'
        },
        output: undefined,
        data: {
          weather: {
            city: '上海',
            temperature: 28
          }
        }
      }
    });
  });

  it('keeps existing runtime data instead of overwriting it with class field defaults', async (): Promise<void> => {
    const part = {
      ...createWidgetPart(
        [
          'export default class Weather extends Widget {',
          '  weather = {',
          "    city: '',",
          '    temperature: 0',
          '  }',
          '',
          '  async onMounted(): Promise<void> {',
          "    this.weather.city = '杭州'",
          '  }',
          '}'
        ].join('\n')
      ),
      renderContext: {
        input: {
          city: '上海'
        },
        output: undefined,
        data: {
          weather: {
            city: '北京',
            temperature: 32
          }
        }
      }
    };

    const nextPart = await initWidgetMountState(part);

    expect(nextPart.renderContext.data).toEqual({
      weather: {
        city: '杭州',
        temperature: 32
      }
    });
  });

  it('fails legacy Widget config scripts after switching to class entry', async (): Promise<void> => {
    const part = createWidgetPart('Widget({ onMounted() { this.weather = { temperature: 28 } } })');

    await expect(initWidgetMountState(part)).rejects.toThrow();
  });

  it('does not execute arbitrary mounted code while applying direct data writes', async (): Promise<void> => {
    const runtimeGlobal = globalThis as typeof globalThis & { __widgetRuntimeUnsafe?: boolean };
    delete runtimeGlobal.__widgetRuntimeUnsafe;
    const part = createWidgetPart(
      [
        'export default class Weather extends Widget {',
        '  weather = {',
        '    temperature: 0',
        '  }',
        '',
        '  onMounted() {',
        '    globalThis.__widgetRuntimeUnsafe = true',
        '    this.weather.temperature = 28',
        '  }',
        '}'
      ].join('\n')
    );

    const nextPart = await initWidgetMountState(part);

    expect(runtimeGlobal.__widgetRuntimeUnsafe).toBeUndefined();
    expect(nextPart.renderContext.data).toEqual({
      weather: {
        temperature: 28
      }
    });
  });

  it('fails legacy defineConfig entry scripts after switching to class entry', async (): Promise<void> => {
    const part = createWidgetPart('defineConfig({ onMounted() { this.weather = { temperature: 28 } } })');

    await expect(initWidgetMountState(part)).rejects.toThrow();
  });

  it('blocks disallowed syntax inside widget scripts before execution', async (): Promise<void> => {
    const part = createWidgetPart("export default class Weather extends Widget { onMounted() { eval('this.unsafe = true') } }");

    await expect(initWidgetMountState(part)).rejects.toThrow();
  });

  it('runs mounted once and writes data into the returned widget part', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class Weather extends Widget {',
        '  weather = {',
        "    city: '',",
        '    temperature: 0',
        '  }',
        '',
        '  async onMounted() {',
        '    this.weather.city = this.$input.city',
        '    this.weather.temperature = 28',
        '  }',
        '}'
      ].join('\n')
    );

    const nextPart = await initWidgetMountState(part);

    expect(part.renderContext.data).toEqual({});
    expect(nextPart).toMatchObject({
      renderContext: {
        input: {
          city: '上海'
        },
        output: undefined,
        data: {
          weather: {
            city: '上海',
            temperature: 28
          }
        }
      }
    });
  });

  it('does not expose adapter internals to widget lifecycle code', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class Weather extends Widget {',
        '  onMounted() {',
        '    try {',
        '      __widgetData.leaked = true',
        '    } catch (error) {',
        '      this.internalAccessBlocked = true',
        '    }',
        '    this.weather = { temperature: 28 }',
        '  }',
        '}'
      ].join('\n')
    );

    const nextPart = await initWidgetMountState(part);

    expect(nextPart.renderContext.data).toEqual({
      internalAccessBlocked: true,
      weather: {
        temperature: 28
      }
    });
  });

  it('runs mounted when the caller invokes the mount helper', async (): Promise<void> => {
    const part: WidgetRuntimeState = {
      ...createWidgetPart('export default class Weather extends Widget { onMounted() { this.weather = { temperature: 28 } } }'),
      renderContext: {
        input: {},
        output: undefined,
        data: {
          weather: {
            temperature: 18
          }
        }
      }
    };

    const nextPart = await initWidgetMountState(part);

    expect(part.renderContext.data).toEqual({
      weather: {
        temperature: 18
      }
    });
    expect(nextPart.renderContext.data).toEqual({
      weather: {
        temperature: 28
      }
    });
  });

  it('supports constants and object literals in direct data writes', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class Weather extends Widget {',
        '  onMounted() {',
        '    const city = this.$input.city',
        "    this.lastQuery = { city, unit: 'celsius', tags: ['weather'] }",
        '  }',
        '}'
      ].join('\n')
    );

    const nextPart = await initWidgetMountState(part);

    expect(nextPart.renderContext.data).toEqual({
      lastQuery: {
        city: '上海',
        unit: 'celsius',
        tags: ['weather']
      }
    });
  });

  it('initializes runtime data from Widget data declarations before mounted runs', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class Weather extends Widget {',
        '  weather = {',
        '    temperature: 18',
        '  }',
        '',
        '  onMounted() {',
        "    this.weather.label = this.$input.city + ' ' + this.weather.temperature + '°C'",
        '  }',
        '}'
      ].join('\n')
    );

    const nextPart = await initWidgetMountState(part);

    expect(nextPart.renderContext.data).toEqual({
      weather: {
        label: '上海 18°C',
        temperature: 18
      }
    });
  });

  it('does not expose removed data helper APIs on the Widget this context', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class Weather extends Widget {',
        "  message = ''",
        '',
        '  onMounted() {',
        "    this.message = typeof this.$data + ':' + typeof this.$setData",
        '  }',
        '}'
      ].join('\n')
    );

    const nextPart = await initWidgetMountState(part);

    expect(nextPart.renderContext.data).toEqual({
      message: 'undefined:undefined'
    });
  });

  it('deletes declared data fields through direct this properties', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class Weather extends Widget {',
        "  keep = '保留'",
        "  message = '等待用户操作'",
        '',
        '  onMounted() {',
        '    delete this.message',
        '  }',
        '}'
      ].join('\n')
    );

    const nextPart = await initWidgetMountState(part);

    expect(nextPart.renderContext.data).toEqual({
      keep: '保留'
    });
  });

  it('reports patches while mounted scripts write direct data fields', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class Weather extends Widget {',
        '  weather = {',
        '    temperature: 0',
        '  }',
        '',
        '  onMounted() {',
        "    this.message = '正在加载'",
        '    this.weather.temperature = 28',
        "    this.items = [{ name: '拿铁' }]",
        '    delete this.message',
        '  }',
        '}'
      ].join('\n')
    );
    const patchBatches: WidgetRuntimePatch[][] = [];

    const nextPart = await initWidgetMountState(part, {
      onPatch: (patches): void => {
        patchBatches.push(patches);
      }
    });

    expect(patchBatches.flat()).toEqual([
      { op: 'set', path: ['message'], value: '正在加载' },
      { op: 'set', path: ['weather', 'temperature'], value: 28 },
      { op: 'set', path: ['items'], value: [{ name: '拿铁' }] },
      { op: 'delete', path: ['message'] }
    ]);
    expect(nextPart.renderContext.data).toEqual({
      weather: {
        temperature: 28
      },
      items: [{ name: '拿铁' }]
    });
  });

  it('reports undefined object field writes as delete patches without failing scripts', async (): Promise<void> => {
    const part = createWidgetPart(
      ['export default class Weather extends Widget {', "  message = '等待用户操作'", '', '  onMounted() {', '    this.message = undefined', '  }', '}'].join(
        '\n'
      )
    );
    const patchBatches: WidgetRuntimePatch[][] = [];

    const nextPart = await initWidgetMountState(part, {
      onPatch: (patches): void => {
        patchBatches.push(patches);
      }
    });

    expect(patchBatches.flat()).toEqual([{ op: 'delete', path: ['message'] }]);
    expect(nextPart.renderContext.data).toEqual({});
  });

  it('runs normal JavaScript control flow inside mounted hooks', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class Weather extends Widget {',
        '  onMounted() {',
        "    const city = this.$input.city || '上海'",
        '    const temperatures = [26, 28, 30]',
        '    const temperature = temperatures.find((item) => item > 27)',
        '    if (temperature) {',
        "      this.weather = { city, label: city + ' ' + temperature + '°C', temperature }",
        '    }',
        '  }',
        '}'
      ].join('\n')
    );

    const nextPart = await initWidgetMountState(part);

    expect(nextPart.renderContext.data).toEqual({
      weather: {
        city: '上海',
        label: '上海 28°C',
        temperature: 28
      }
    });
  });

  it('does not run disabled execute scripts', async (): Promise<void> => {
    const code = 'export default class Weather extends Widget { onMounted() { this.weather = { temperature: 28 } } }';
    const part: WidgetRuntimeState = {
      ...createWidgetPart(code),
      value: {
        ...createWidgetData(code),
        execute: {
          enabled: false,
          code
        }
      }
    };

    const nextPart = await initWidgetMountState(part);

    expect(nextPart).toBe(part);
    expect(nextPart.renderContext.data).toEqual({});
  });

  it('runs interaction code and finishes when the code sends a message', async (): Promise<void> => {
    const part = createWidgetPart('export default class Weather extends Widget {}');

    const result = await createWidgetRuntimeInstance(part).runInteraction(['this.confirmed = true', "this.$sendMessage('确认下单')"].join('\n'));

    expect(result.state.renderContext.data).toEqual({ confirmed: true });
    expect(result.sendMessage).toEqual({ content: '确认下单', isError: false });
  });

  it('keeps compatibility runtime instance interaction calls one-shot', async (): Promise<void> => {
    const part = createWidgetPart('export default class Counter extends Widget {}');
    const instance = createWidgetRuntimeInstance(part);

    const firstResult = await instance.runInteraction('this.count = (this.count ?? 0) + 1');
    const secondResult = await instance.runInteraction('this.count = (this.count ?? 0) + 1');

    expect(firstResult.state.renderContext.data).toEqual({ count: 1 });
    expect(secondResult.state.renderContext.data).toEqual({ count: 1 });
  });

  it('keeps private instance state from mounted to method runs in one widget session', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class MovieList extends Widget {',
        '  private cache = new Map()',
        '',
        '  onMounted() {',
        "    this.cache.set('message', '已挂载')",
        '  }',
        '',
        '  buttonByClick() {',
        "    this.message = this.cache.get('message')",
        '    this.$sendMessage(this.message)',
        '  }',
        '}'
      ].join('\n')
    );
    const session = createWidgetRuntimeSession(part, TEST_WIDGET_RUN_OPTIONS);

    try {
      const mountedResult = await session.mounted();
      const clickedResult = await session.run('buttonByClick');

      expect(mountedResult.state.renderContext.data).toEqual({});
      expect(clickedResult.state.renderContext.data).toEqual({
        message: '已挂载'
      });
      expect(clickedResult.sendMessage).toEqual({ content: '已挂载', isError: false });
    } finally {
      session.dispose();
    }
  });

  it('synchronizes updated input output and data into an existing widget session', async (): Promise<void> => {
    const part: WidgetRuntimeState = {
      ...createWidgetPart(
        [
          'export default class SnapshotWidget extends Widget {',
          '  capture() {',
          '    this.snapshot = {',
          '      city: this.$input.city,',
          '      outputVersion: this.$output.version,',
          '      externalValue: this.externalValue',
          '    }',
          '  }',
          '}'
        ].join('\n')
      ),
      renderContext: {
        input: { city: '上海' },
        output: { version: 1 },
        data: { externalValue: 'first' }
      }
    };
    const session = createWidgetRuntimeSession(part, TEST_WIDGET_RUN_OPTIONS);

    try {
      await session.run('capture');
      session.updateState({
        value: part.value,
        renderContext: {
          input: { city: '杭州' },
          output: { version: 2 },
          data: { externalValue: 'second' }
        }
      });
      const result = await session.run('capture');

      expect(result.state.renderContext.data).toEqual({
        externalValue: 'second',
        snapshot: {
          city: '杭州',
          outputVersion: 2,
          externalValue: 'second'
        }
      });
    } finally {
      session.dispose();
    }
  });

  it('keeps cached nested data proxies connected while synchronizing session data', async (): Promise<void> => {
    const part: WidgetRuntimeState = {
      ...createWidgetPart(
        [
          'export default class CachedDataWidget extends Widget {',
          '  private cachedDetails: { name: string } | null = null',
          '',
          '  onMounted() {',
          '    this.cachedDetails = this.profile.details',
          '  }',
          '',
          '  updateCachedDetails() {',
          "    this.cachedDetails!.name = 'updated-through-cache'",
          '  }',
          '}'
        ].join('\n')
      ),
      renderContext: {
        input: {},
        output: undefined,
        data: {
          profile: {
            details: {
              name: 'first'
            }
          }
        }
      }
    };
    const session = createWidgetRuntimeSession(part, TEST_WIDGET_RUN_OPTIONS);

    try {
      await session.mounted();
      session.updateState({
        value: part.value,
        renderContext: {
          input: {},
          output: undefined,
          data: {
            profile: {
              details: {
                name: 'second'
              }
            }
          }
        }
      });
      const result = await session.run('updateCachedDetails');

      expect(result.state.renderContext.data).toEqual({
        profile: {
          details: {
            name: 'updated-through-cache'
          }
        }
      });
    } finally {
      session.dispose();
    }
  });

  it('does not expose Object prototype methods as widget session methods', async (): Promise<void> => {
    const part = createWidgetPart('export default class EmptyWidget extends Widget {}');
    const session = createWidgetRuntimeSession(part, TEST_WIDGET_RUN_OPTIONS);

    try {
      await session.mounted();
      await expect(session.run('toString')).rejects.toThrow('小组件方法不存在：toString');
    } finally {
      session.dispose();
    }
  });

  it('sends cloneable widget payloads to worker sessions from reactive render context', async (): Promise<void> => {
    vi.stubGlobal('Worker', CloneCheckingWorkerMock);

    const part: WidgetRuntimeState = {
      ...createWidgetPart('export default class MovieList extends Widget { onMounted() {} }'),
      renderContext: reactive({
        input: {
          city: '上海'
        },
        output: undefined,
        data: {
          movie: {
            title: '流浪地球'
          }
        }
      }) as WidgetRuntimeState['renderContext']
    };
    const session = createWidgetRuntimeSession(part, { useWorker: true });

    try {
      await expect(session.mounted()).resolves.toMatchObject({
        state: {
          renderContext: {
            data: {
              movie: {
                title: '流浪地球'
              }
            }
          }
        }
      });
    } finally {
      session.dispose();
    }
  });

  it('hydrates execute snapshot data before display session mounted and method runs', async (): Promise<void> => {
    const part = createExecuteWidgetPart(
      [
        'export default class MovieList extends Widget {',
        '  async onExecute() {',
        "    this.message = '来自执行阶段'",
        '  }',
        '',
        '  onMounted() {',
        '    this.mountedMessage = this.message',
        '  }',
        '',
        '  buttonByClick() {',
        '    this.clickedMessage = this.message',
        '  }',
        '}'
      ].join('\n')
    );
    const executeResult = await executeWidgetRuntime(part, TEST_WIDGET_RUN_OPTIONS);
    const session = createWidgetRuntimeSession(executeResult.state, TEST_WIDGET_RUN_OPTIONS);

    try {
      const mountedResult = await session.mounted();
      const clickedResult = await session.run('buttonByClick');

      expect(mountedResult.state.renderContext.data).toMatchObject({
        message: '来自执行阶段',
        mountedMessage: '来自执行阶段'
      });
      expect(clickedResult.state.renderContext.data).toMatchObject({
        clickedMessage: '来自执行阶段',
        message: '来自执行阶段',
        mountedMessage: '来自执行阶段'
      });
    } finally {
      session.dispose();
    }
  });

  it('runs existing interaction code against the same widget session instance', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class MovieList extends Widget {',
        '  private cache = new Map()',
        '',
        '  onMounted() {',
        "    this.cache.set('message', '兼容交互')",
        '  }',
        '',
        '  buttonByClick() {',
        "    this.message = this.cache.get('message')",
        '  }',
        '}'
      ].join('\n')
    );
    const session = createWidgetRuntimeSession(part, TEST_WIDGET_RUN_OPTIONS);

    try {
      await session.mounted();
      const result = await session.runInteraction('buttonByClick()');

      expect(result.state.renderContext.data).toEqual({
        message: '兼容交互'
      });
    } finally {
      session.dispose();
    }
  });

  it('waits for unawaited sendMessage calls before finishing mounted scripts', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class Weather extends Widget {',
        '  onMounted() {',
        "    this.$sendMessage('加载完成').then(() => {",
        "      this.message = '发送后更新'",
        '    })',
        '  }',
        '}'
      ].join('\n')
    );

    const nextPart = await initWidgetMountState(part);

    expect(nextPart.renderContext.data).toEqual({
      message: '发送后更新'
    });
  });

  it('does not run unrelated cleanup methods when an interaction sends a message', async (): Promise<void> => {
    const part: WidgetRuntimeState = {
      ...createWidgetPart(
        ['export default class Weather extends Widget {', '  cleanup() {', '    this.cleanedUp = true', "    this.$sendMessage('清理消息')", '  }', '}'].join(
          '\n'
        )
      )
    };

    const result = await createWidgetRuntimeInstance(part).runInteraction(['this.confirmed = true', "this.$sendMessage('确认下单')"].join('\n'));

    expect(result.state.renderContext.data).toEqual({
      confirmed: true
    });
    expect(result.sendMessage).toEqual({ content: '确认下单', isError: false });
  });

  it('runs user helper calls from interaction code without exposing them as runtime API', async (): Promise<void> => {
    const part: WidgetRuntimeState = {
      ...createWidgetPart(
        [
          'export default class Weather extends Widget {',
          '  submitOrder() {',
          '    this.confirmed = true',
          "    this.$sendMessage('确认下单')",
          '  }',
          '}'
        ].join('\n')
      )
    };

    const result = await createWidgetRuntimeInstance(part).runInteraction('submitOrder()');

    expect(result.state.renderContext.data).toEqual({ confirmed: true });
    expect(result.sendMessage).toEqual({ content: '确认下单', isError: false });
  });

  it('rejects a session run when an unawaited async widget helper fails', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class Weather extends Widget {',
        '  async fail() {',
        "    throw new Error('helper boom')",
        '  }',
        '',
        '  submit() {',
        '    this.fail()',
        '  }',
        '}'
      ].join('\n')
    );
    const session = createWidgetRuntimeSession(part, TEST_WIDGET_RUN_OPTIONS);

    try {
      await expect(session.run('submit')).rejects.toThrow('helper boom');
    } finally {
      session.dispose();
    }
  });

  it('rejects an async helper chain that observes only fulfillment', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class Weather extends Widget {',
        '  async fail() {',
        "    throw new Error('then helper boom')",
        '  }',
        '',
        '  submit() {',
        '    this.fail().then(() => {',
        '      this.unreachable = true',
        '    })',
        '  }',
        '}'
      ].join('\n')
    );
    const session = createWidgetRuntimeSession(part, TEST_WIDGET_RUN_OPTIONS);

    try {
      await expect(session.run('submit')).rejects.toThrow('then helper boom');
    } finally {
      session.dispose();
    }
  });

  it('rejects an async helper chain observed only through finally', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class Weather extends Widget {',
        '  async fail() {',
        "    throw new Error('finally helper boom')",
        '  }',
        '',
        '  submit() {',
        '    this.fail().finally(() => {',
        '      this.cleanupFinished = true',
        '    })',
        '  }',
        '}'
      ].join('\n')
    );
    const session = createWidgetRuntimeSession(part, TEST_WIDGET_RUN_OPTIONS);

    try {
      await expect(session.run('submit')).rejects.toThrow('finally helper boom');
    } finally {
      session.dispose();
    }
  });

  it('does not repeat an async widget helper error handled by user code', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class Weather extends Widget {',
        '  async fail() {',
        "    throw new Error('handled helper')",
        '  }',
        '',
        '  submit() {',
        '    this.fail().catch(() => {',
        '      this.helperErrorHandled = true',
        '    })',
        '  }',
        '}'
      ].join('\n')
    );
    const session = createWidgetRuntimeSession(part, TEST_WIDGET_RUN_OPTIONS);

    try {
      await expect(session.run('submit')).resolves.toMatchObject({
        state: {
          renderContext: {
            data: {
              helperErrorHandled: true
            }
          }
        }
      });
    } finally {
      session.dispose();
    }
  });

  it('does not repeat an async helper error handled through await and catch', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class Weather extends Widget {',
        '  async fail() {',
        "    throw new Error('await handled helper')",
        '  }',
        '',
        '  async submit() {',
        '    try {',
        '      await this.fail()',
        '    } catch {',
        '      this.awaitHelperErrorHandled = true',
        '    }',
        '  }',
        '}'
      ].join('\n')
    );
    const session = createWidgetRuntimeSession(part, TEST_WIDGET_RUN_OPTIONS);

    try {
      await expect(session.run('submit')).resolves.toMatchObject({
        state: {
          renderContext: {
            data: {
              awaitHelperErrorHandled: true
            }
          }
        }
      });
    } finally {
      session.dispose();
    }
  });

  it('does not repeat a helper error handled after Promise.resolve assimilation', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class Weather extends Widget {',
        '  async fail() {',
        "    throw new Error('resolved handled helper')",
        '  }',
        '',
        '  submit() {',
        '    Promise.resolve(this.fail()).catch(() => {',
        '      this.resolvedHelperErrorHandled = true',
        '    })',
        '  }',
        '}'
      ].join('\n')
    );
    const session = createWidgetRuntimeSession(part, TEST_WIDGET_RUN_OPTIONS);

    try {
      await expect(session.run('submit')).resolves.toMatchObject({
        state: {
          renderContext: {
            data: {
              resolvedHelperErrorHandled: true
            }
          }
        }
      });
    } finally {
      session.dispose();
    }
  });

  it('does not expose a default confirm method from generated scripts', async (): Promise<void> => {
    const { code } = createDefaultWidgetExecuteMethod('weather');
    const part: WidgetRuntimeState = {
      ...createWidgetPart(code),
      renderContext: {
        input: {},
        output: undefined,
        data: {
          message: '确认下单'
        }
      }
    };

    await expect(createWidgetRuntimeInstance(part).runInteraction('this.confirm()')).rejects.toThrow();
  });

  it('keeps TypeScript private and protected helpers out of direct interaction bindings', async (): Promise<void> => {
    const part: WidgetRuntimeState = {
      ...createWidgetPart(
        [
          'export default class Weather extends Widget {',
          '  private hydrate() {',
          '    this.hydrated = true',
          '  }',
          '',
          '  protected syncCache() {',
          '    this.synced = true',
          '  }',
          '',
          '  submitOrder() {',
          '    this.hydrate()',
          '    this.syncCache()',
          "    this.$sendMessage('确认下单')",
          '  }',
          '}'
        ].join('\n')
      )
    };

    const publicResult = await createWidgetRuntimeInstance(part).runInteraction('submitOrder()');

    expect(publicResult.state.renderContext.data).toEqual({
      hydrated: true,
      synced: true
    });
    await expect(createWidgetRuntimeInstance(part).runInteraction('hydrate()')).rejects.toThrow();
  });

  it('keeps TypeScript private and protected class fields as internal instance state', async (): Promise<void> => {
    const part: WidgetRuntimeState = {
      ...createWidgetPart(
        [
          'export default class Weather extends Widget {',
          "  private secret = '内部确认'",
          '  protected cache = { synced: false }',
          '',
          '  submitOrder() {',
          '    this.cache.synced = true',
          '    this.$sendMessage(this.secret + ":" + String(this.cache.synced))',
          '  }',
          '}'
        ].join('\n')
      )
    };

    const result = await createWidgetRuntimeInstance(part).runInteraction('submitOrder()');

    expect(result.state.renderContext.data).toEqual({});
    expect(result.sendMessage).toEqual({ content: '内部确认:true', isError: false });
  });

  it('finishes widget when a method throw is handled by interaction code', async (): Promise<void> => {
    const part: WidgetRuntimeState = {
      ...createWidgetPart(
        ['export default class Weather extends Widget {', '  explode() {', "    throw new Error('handled by interaction')", '  }', '}'].join('\n')
      )
    };

    const result = await createWidgetRuntimeInstance(part).runInteraction(
      ['try {', '  explode()', '} catch (error) {', '  this.methodErrorHandled = true', '}'].join('\n')
    );

    expect(result.state.renderContext.data).toEqual({
      methodErrorHandled: true
    });
  });

  it('finishes widget after passing evaluated interaction arguments into user helper parameters', async (): Promise<void> => {
    const part: WidgetRuntimeState = {
      ...createWidgetPart(
        ['export default class Weather extends Widget {', '  selectCoffee(id, city) {', '    this.selection = { id, city }', '  }', '}'].join('\n')
      )
    };

    const result = await createWidgetRuntimeInstance(part).runInteraction("selectCoffee('latte', this.$input.city)");

    expect(result.state.renderContext.data).toEqual({
      selection: {
        id: 'latte',
        city: '上海'
      }
    });
  });

  it('marks the widget as failed when interaction code throws', async (): Promise<void> => {
    const part = createWidgetPart('export default class Weather extends Widget {}');

    await expect(createWidgetRuntimeInstance(part).runInteraction('unknownAction()')).rejects.toThrow();
  });

  it('finishes the widget when interaction code updates data without sending a message', async (): Promise<void> => {
    const part = createWidgetPart('export default class Weather extends Widget {}');

    const result = await createWidgetRuntimeInstance(part).runInteraction("this.selectedCoffee = 'latte'");

    expect(result.state.renderContext.data).toEqual({
      selectedCoffee: 'latte'
    });
    expect(result.sendMessage).toBeUndefined();
  });

  it('supports managed http calls and stores response data', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class Weather extends Widget {',
        '  async onMounted() {',
        "    const weather = await this.$http.get('https://api.example.com/weather', { query: { city: this.$input.city } })",
        '    this.weather = { temperature: weather.data.temperature }',
        '  }',
        '}'
      ].join('\n')
    );
    const http: WidgetHttpClient = {
      get: async () => ({ status: 200, ok: true, url: 'https://api.example.com/weather', headers: {}, data: { temperature: 28 } }),
      post: async () => ({ status: 405, ok: false, url: '', headers: {}, data: '' }),
      put: async () => ({ status: 405, ok: false, url: '', headers: {}, data: '' }),
      patch: async () => ({ status: 405, ok: false, url: '', headers: {}, data: '' }),
      delete: async () => ({ status: 405, ok: false, url: '', headers: {}, data: '' })
    };

    const nextPart = await initWidgetMountState(part, { http });

    expect(nextPart.renderContext.data).toEqual({
      weather: {
        temperature: 28
      }
    });
  });

  it('flushes pending patches before hosted http requests', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class Weather extends Widget {',
        '  async onMounted() {',
        "    this.message = '正在加载'",
        "    await this.$http.get('https://api.example.com/weather')",
        "    this.message = '加载完成'",
        '  }',
        '}'
      ].join('\n')
    );
    const events: string[] = [];
    const http: WidgetHttpClient = {
      get: async () => {
        events.push('http');
        return { status: 200, ok: true, url: 'https://api.example.com/weather', headers: {}, data: {} };
      },
      post: async () => ({ status: 405, ok: false, url: '', headers: {}, data: '' }),
      put: async () => ({ status: 405, ok: false, url: '', headers: {}, data: '' }),
      patch: async () => ({ status: 405, ok: false, url: '', headers: {}, data: '' }),
      delete: async () => ({ status: 405, ok: false, url: '', headers: {}, data: '' })
    };

    const nextPart = await initWidgetMountState(part, {
      http,
      onPatch: (patches): void => {
        for (const patch of patches) {
          if (patch.op === 'set' && patch.path[0] === 'message') {
            events.push(`patch:${String(patch.value)}`);
          }
        }
      }
    });

    expect(events).toEqual(['patch:正在加载', 'http', 'patch:加载完成']);
    expect(nextPart.renderContext.data).toEqual({
      message: '加载完成'
    });
  });

  it('passes undefined body through to the hosted request layer for non-GET methods', async (): Promise<void> => {
    const part = createWidgetPart(
      [
        'export default class Weather extends Widget {',
        '  async onMounted() {',
        "    await this.$http.post('https://api.example.com/orders')",
        '    this.submitted = true',
        '  }',
        '}'
      ].join('\n')
    );
    const postRequests: Parameters<WidgetHttpClient['post']>[1][] = [];
    const http: WidgetHttpClient = {
      get: async () => ({ status: 405, ok: false, url: '', headers: {}, data: '' }),
      post: async (_url, request) => {
        postRequests.push(request);
        return { status: 200, ok: true, url: 'https://api.example.com/orders', headers: {}, data: '' };
      },
      put: async () => ({ status: 405, ok: false, url: '', headers: {}, data: '' }),
      patch: async () => ({ status: 405, ok: false, url: '', headers: {}, data: '' }),
      delete: async () => ({ status: 405, ok: false, url: '', headers: {}, data: '' })
    };

    await initWidgetMountState(part, { http });

    expect(postRequests).toHaveLength(1);
    expect(postRequests[0]).toHaveProperty('body', undefined);
  });

  it('waits for managed http calls without adding a script-level timeout', async (): Promise<void> => {
    const code = [
      'export default class Weather extends Widget {',
      '  async onMounted() {',
      "    await this.$http.get('https://api.example.com/slow')",
      '    this.weather = { temperature: 28 }',
      '  }',
      '}'
    ].join('\n');
    const part: WidgetRuntimeState = {
      ...createWidgetPart(code),
      value: {
        ...createWidgetData(code),
        execute: {
          code
        }
      }
    };
    const http: WidgetHttpClient = {
      get: async (): Promise<{ status: number; ok: true; url: string; headers: Record<string, string>; data: { temperature: number } }> =>
        new Promise((resolve): void => {
          setTimeout((): void => {
            resolve({ status: 200, ok: true, url: 'https://api.example.com/slow', headers: {}, data: { temperature: 28 } });
          }, 20);
        }),
      post: async () => ({ status: 405, ok: false, url: '', headers: {}, data: '' }),
      put: async () => ({ status: 405, ok: false, url: '', headers: {}, data: '' }),
      patch: async () => ({ status: 405, ok: false, url: '', headers: {}, data: '' }),
      delete: async () => ({ status: 405, ok: false, url: '', headers: {}, data: '' })
    };

    const nextPart = await initWidgetMountState(part, { http });

    expect(nextPart.renderContext.data).toEqual({
      weather: {
        temperature: 28
      }
    });
  });
});
