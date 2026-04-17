import type { File, Native } from './types';
import { hasElectronAPI } from '../electron-api';
import { ElectronNative } from './electron';
import { WebNative } from './web';

export { File };

export const native: Native = hasElectronAPI() ? new ElectronNative() : new WebNative();
