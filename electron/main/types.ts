import type { BrowserWindow } from 'electron';

export interface StoredProviderConfig {
  type: string;
  apiKey: string;
  baseUrl?: string;
}

export type IpcHandler = () => void;

export interface WindowController {
  getWindow: () => BrowserWindow | null;
  createWindow: () => void;
  isDev: () => boolean;
}
