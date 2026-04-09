import type { File } from './types';
import { hasElectronAPI } from '../electron-api';
import { ElectronNative } from './electron';
import { WebNative } from './web';

export { File };

export const native = hasElectronAPI() ? new ElectronNative() : new WebNative();
