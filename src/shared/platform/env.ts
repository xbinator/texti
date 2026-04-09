import { hasElectronAPI } from './electron-api';

export function isDefined<T>(val: T): val is Exclude<T, undefined> {
  return val !== undefined;
}

export function isElectron(): boolean {
  return hasElectronAPI() || (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron'));
}

export function isWeb(): boolean {
  return !isElectron();
}

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}
