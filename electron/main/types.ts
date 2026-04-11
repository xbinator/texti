import type { BrowserWindow } from 'electron';

export interface AIRequest {
  providerId: string;
  modelId: string;
  prompt: string;
  system?: string;
  temperature?: number;
}

export interface ProviderConfig {
  type: 'openai' | 'anthropic' | 'google';
  apiKey: string;
  baseUrl?: string;
}

export interface StoredProviderConfig {
  type: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface FileOpenResult {
  canceled: boolean;
  filePath: string | null;
  content: string;
  fileName: string;
  ext: string;
}

export interface DbExecuteResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export type IpcHandler = () => void;

export interface WindowController {
  getWindow: () => BrowserWindow | null;
  createWindow: () => void;
  isDev: () => boolean;
}
