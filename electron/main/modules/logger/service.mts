/**
 * @file service.mts
 * @description 初始化主进程日志服务，并放宽对象序列化深度以便完整打印复杂日志内容。
 */
import { inspect, type InspectOptions } from 'util';
import log from 'electron-log/main.js';

/**
 * 控制台日志序列化选项，确保深层数组和长字符串不会被折叠。
 */
const consoleInspectOptions: InspectOptions = {
  depth: null,
  maxArrayLength: null,
  maxStringLength: null
};

/**
 * 带有深度与 inspect 配置的控制台日志 transport。
 */
type ConsoleTransportWithInspect = typeof log.transports.console & {
  /** 对象序列化深度。 */
  depth: number;
  /** util.inspect 序列化选项。 */
  inspectOptions: InspectOptions;
};

/**
 * 将复杂日志参数格式化为完整字符串，避免控制台输出时被折叠为 [Array]。
 * @param args - 原始日志参数
 * @returns 格式化后的日志参数
 */
export function formatLogArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (typeof arg === 'object' && arg !== null) {
      return inspect(arg, consoleInspectOptions);
    }

    return arg;
  });
}

/**
 * 初始化 Electron 主进程日志服务。
 * @returns 无返回值
 */
export function initLogger(): void {
  const consoleTransport = log.transports.console as ConsoleTransportWithInspect;

  // 初始化 electron-log，后续所有主进程日志都通过统一 transport 输出。
  log.initialize();

  // 禁用文件日志，仅保留控制台输出，避免写入额外日志文件。
  log.transports.file.level = false;

  // 放宽控制台日志深度限制，避免深层消息被 electron-log 折叠为 [Array]。
  consoleTransport.level = 'info';
  consoleTransport.depth = Number.MAX_SAFE_INTEGER;
  consoleTransport.inspectOptions = {
    ...consoleTransport.inspectOptions,
    ...consoleInspectOptions
  };

  // 统一格式化对象日志参数，确保 direct log.info(...) 也不会把深层数组折叠为 [Array]。
  log.hooks = [
    ...log.hooks,
    (message) => ({
      ...message,
      data: formatLogArgs(message.data)
    })
  ];

  // 捕获未处理异常，确保异常信息也经过统一日志链路输出。
  log.errorHandler.startCatching();

  // 覆盖原生 console 方法，让业务代码直接使用 console.* 时也走统一格式。
  Object.assign(console, log.functions);
}

export { log };
