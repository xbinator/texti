import { hasElectronAPI, getElectronAPI } from '../shared/platform/electron-api';

class Logger {
  debug(...args: unknown[]): void {
    if (hasElectronAPI()) {
      getElectronAPI().logger.debug(...args);
    } else {
      console.debug(...args);
    }
  }

  info(...args: unknown[]): void {
    if (hasElectronAPI()) {
      getElectronAPI().logger.info(...args);
    } else {
      console.info(...args);
    }
  }

  warn(...args: unknown[]): void {
    if (hasElectronAPI()) {
      getElectronAPI().logger.warn(...args);
    } else {
      console.warn(...args);
    }
  }

  error(...args: unknown[]): void {
    if (hasElectronAPI()) {
      getElectronAPI().logger.error(...args);
    } else {
      console.error(...args);
    }
  }
}

export const logger = new Logger();
export default logger;
