/**
 * @file logger.test.ts
 * @description 验证主进程日志模块会完整展开深层数组内容，并为控制台输出配置足够的序列化深度。
 */
import type { InspectOptions } from 'util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Electron IPC 监听注册函数桩。
 */
const ipcMainOnMock = vi.fn();

/**
 * electron-log 初始化函数桩。
 */
const initializeMock = vi.fn();

/**
 * electron-log 错误捕获启动函数桩。
 */
const startCatchingMock = vi.fn();

/**
 * electron-log 调试输出桩。
 */
const debugMock = vi.fn();

/**
 * electron-log 信息输出桩。
 */
const infoMock = vi.fn();

/**
 * electron-log 警告输出桩。
 */
const warnMock = vi.fn();

/**
 * electron-log 错误输出桩。
 */
const errorMock = vi.fn();

/**
 * 控制台 transport inspect 配置。
 */
const consoleInspectOptions: InspectOptions = {};

/**
 * 控制台 transport 配置桩。
 */
const consoleTransportMock = {
  level: 'silly',
  depth: 6,
  inspectOptions: consoleInspectOptions
};

/**
 * 文件 transport 配置桩。
 */
const fileTransportMock = {
  level: 'silly' as string | false
};

/**
 * 覆盖 console 的函数集合桩。
 */
const logFunctionMocks = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  log: vi.fn()
};

/**
 * electron-log hook 列表桩。
 */
const logHooksMock: Array<(message: { data: unknown[] }) => { data: unknown[] }> = [];

/**
 * electron-log 默认导出对象桩。
 */
const loggerMock = {
  initialize: initializeMock,
  debug: debugMock,
  info: infoMock,
  warn: warnMock,
  error: errorMock,
  functions: logFunctionMocks,
  hooks: logHooksMock,
  transports: {
    console: consoleTransportMock,
    file: fileTransportMock
  },
  errorHandler: {
    startCatching: startCatchingMock
  }
};

/**
 * 备份原始 console，避免测试污染全局。
 */
const originalConsole = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
  log: console.log
};

vi.mock('electron', () => ({
  ipcMain: {
    on: ipcMainOnMock
  }
}));

vi.mock('electron-log/main.js', () => ({
  default: loggerMock
}));

/**
 * 重置日志 mock 和全局 console。
 */
function resetLoggerState(): void {
  ipcMainOnMock.mockReset();
  initializeMock.mockReset();
  startCatchingMock.mockReset();
  debugMock.mockReset();
  infoMock.mockReset();
  warnMock.mockReset();
  errorMock.mockReset();
  Object.assign(logFunctionMocks, {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn()
  });
  loggerMock.hooks = [];
  consoleTransportMock.level = 'silly';
  consoleTransportMock.depth = 6;
  Object.keys(consoleInspectOptions).forEach((key) => {
    delete consoleInspectOptions[key as keyof InspectOptions];
  });
  fileTransportMock.level = 'silly';
  console.debug = originalConsole.debug;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.log = originalConsole.log;
}

describe('logger module', () => {
  beforeEach(() => {
    vi.resetModules();
    resetLoggerState();
  });

  afterEach(() => {
    resetLoggerState();
  });

  it('configures console transport to print nested arrays completely', async () => {
    const { initLogger } = await import('../../electron/main/modules/logger/service.mjs');

    initLogger();

    expect(initializeMock).toHaveBeenCalledTimes(1);
    expect(fileTransportMock.level).toBe(false);
    expect(consoleTransportMock.level).toBe('info');
    expect(consoleTransportMock.depth).toBe(Number.MAX_SAFE_INTEGER);
    expect(consoleTransportMock.inspectOptions).toMatchObject({
      depth: null,
      maxArrayLength: null,
      maxStringLength: null
    });
    expect(loggerMock.hooks).toHaveLength(1);
    expect(startCatchingMock).toHaveBeenCalledTimes(1);
  });

  it('registers a hook that stringifies nested objects for direct main-process logging', async () => {
    const { initLogger } = await import('../../electron/main/modules/logger/service.mjs');
    const payload = {
      prompt: '',
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'hello'
            }
          ]
        }
      ]
    };

    initLogger();

    const hook = loggerMock.hooks[0];
    const transformedMessage = hook({
      data: ['[AIService] streamText payload:', payload]
    });

    expect(transformedMessage.data[0]).toBe('[AIService] streamText payload:');
    expect(transformedMessage.data[1]).toEqual(expect.stringContaining("content: [ { type: 'text', text: 'hello' } ]"));
    expect(transformedMessage.data[1]).toEqual(expect.not.stringContaining('[Array]'));
  });

  it('stringifies nested logger payloads without collapsing arrays', async () => {
    const { registerLoggerHandlers } = await import('../../electron/main/modules/logger/ipc.mjs');
    const message = {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'hello'
        }
      ]
    };

    registerLoggerHandlers();

    const infoHandlerCall = ipcMainOnMock.mock.calls.find((call) => call[0] === 'logger:info');
    expect(infoHandlerCall).toBeDefined();

    const infoHandler = infoHandlerCall?.[1] as ((event: unknown, ...args: unknown[]) => void) | undefined;

    infoHandler?.({}, message);

    expect(infoMock).toHaveBeenCalledTimes(1);
    expect(infoMock).toHaveBeenCalledWith(expect.stringContaining("content: [ { type: 'text', text: 'hello' } ]"));
    expect(infoMock).not.toHaveBeenCalledWith(expect.stringContaining('[Array]'));
  });
});
