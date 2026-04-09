export interface ElectronFileResult {
  canceled: boolean;
  filePath: string | null;
  content: string;
  fileName?: string;
  ext?: string;
}

export interface ElectronAPI {
  openFile: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<ElectronFileResult>;
  saveFile: (
    content: string,
    path?: string,
    options?: { filters?: Array<{ name: string; extensions: string[] }>; defaultPath?: string }
  ) => Promise<string | null>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  setWindowTitle: (title: string) => Promise<void>;
  dbExecute: (sql: string, params?: unknown[]) => Promise<{ changes: number; lastInsertRowid: number }>;
  dbSelect: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
  storeGet: (key: string) => Promise<unknown>;
  storeSet: (key: string, value: unknown) => Promise<void>;
  storeDelete: (key: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
}

function readElectronAPI(): ElectronAPI | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return (window as Window & { electronAPI?: ElectronAPI }).electronAPI;
}

export function hasElectronAPI(): boolean {
  return readElectronAPI() !== undefined;
}

export function getElectronAPI(): ElectronAPI {
  const electronAPI = readElectronAPI();

  if (!electronAPI) {
    throw new Error('Electron API is not available');
  }

  return electronAPI;
}
