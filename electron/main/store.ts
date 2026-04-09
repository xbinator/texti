import { safeStorage } from 'electron';
import ElectronStore from 'electron-store';

interface StoreSchema extends Record<string, unknown> {
  salt: string;
}

type StoreType = ElectronStore<StoreSchema> & {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  delete: (key: string) => void;
};

let storeInstance: StoreType | null = null;

function getEncryptionKey(): string | Buffer {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString('texti-encryption-key-v1');
  }
  return 'texti-encryption-key';
}

export async function initStore(): Promise<void> {
  storeInstance = new ElectronStore<StoreSchema>({
    name: 'texti-secure-store',
    encryptionKey: getEncryptionKey(),
    defaults: { salt: '' }
  }) as StoreType;
}

export function getStore(): StoreType {
  if (!storeInstance) {
    throw new Error('Store not initialized. Call initStore() first.');
  }
  return storeInstance;
}
