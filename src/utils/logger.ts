import { hasElectronAPI, getElectronAPI } from '../shared/platform/electron-api.js';

class Logger {
  /**
   * 输出调试日志
   * @param args - 日志参数
   */
  debug(...args: unknown[]): void {
    if (hasElectronAPI()) {
      getElectronAPI().logger.info(args.map(String).join(' '));
    } else {
      console.debug(...args);
    }
  }

  /**
   * 输出信息日志
   * @param args - 日志参数
   */
  info(...args: unknown[]): void {
    if (hasElectronAPI()) {
      getElectronAPI().logger.info(args.map(String).join(' '));
    } else {
      console.info(...args);
    }
  }

  /**
   * 输出警告日志
   * @param args - 日志参数
   */
  warn(...args: unknown[]): void {
    if (hasElectronAPI()) {
      getElectronAPI().logger.warn(args.map(String).join(' '));
    } else {
      console.warn(...args);
    }
  }

  /**
   * 输出错误日志
   * @param args - 日志参数
   */
  error(...args: unknown[]): void {
    if (hasElectronAPI()) {
      getElectronAPI().logger.error(args.map(String).join(' '));
    } else {
      console.error(...args);
    }
  }
}

export const logger = new Logger();

export default logger;
