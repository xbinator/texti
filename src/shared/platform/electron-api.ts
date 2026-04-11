import type { ElectronAPI } from 'types/electron-api';

export type {
  AIGenerateResult,
  DbExecuteResult,
  ElectronAIRequestPayload,
  ElectronAPI,
  ElectronDialogFilter,
  ElectronFileResult,
  ElectronOpenFileOptions,
  ElectronSaveFileOptions
} from 'types/electron-api';

function readElectronAPI(): ElectronAPI | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined;
}

export const hasElectronAPI = (): boolean => readElectronAPI() !== undefined;

export function getElectronAPI(): ElectronAPI {
  const api = readElectronAPI();

  if (!api) throw new Error('Electron API is not available');

  return api;
}
