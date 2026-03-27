import type { FileAPI } from './types';
import { isTauri } from '../is';
import { TauriFileAPI } from './tauri';
import { WebFileAPI } from './web';

export type { FileAPI };

export const fileAPI: FileAPI = isTauri() ? new TauriFileAPI() : new WebFileAPI();
