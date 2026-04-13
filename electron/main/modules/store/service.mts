import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, safeStorage } from 'electron';
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

const KEY_FILE_NAME = 'tibis-key.bin';
const STORE_NAME = 'tibis-secure-store';

function getEncryptionKeyPath(): string {
  return path.join(app.getPath('userData'), KEY_FILE_NAME);
}

function getStorePath(): string {
  return path.join(app.getPath('userData'), `${STORE_NAME}.json`);
}

function loadOrCreateEncryptionKey(): string {
  const keyPath = getEncryptionKeyPath();

  if (fs.existsSync(keyPath)) {
    const encryptedKey = fs.readFileSync(keyPath);
    if (safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(encryptedKey);
      } catch {
        fs.unlinkSync(keyPath);
      }
    }
  }

  const newKey = `tibis-encryption-key-${Date.now().toString(36)}`;

  if (safeStorage.isEncryptionAvailable()) {
    const encryptedKey = safeStorage.encryptString(newKey);
    fs.writeFileSync(keyPath, encryptedKey);
  }

  return newKey;
}

function clearCorruptedStore(): void {
  const storePath = getStorePath();
  if (fs.existsSync(storePath)) {
    try {
      fs.unlinkSync(storePath);
      console.log('[store] Cleared corrupted store file');
    } catch (error) {
      console.error('[store] Failed to clear corrupted store:', error);
    }
  }
}

export async function initStore(): Promise<void> {
  const encryptionKey = loadOrCreateEncryptionKey();

  try {
    storeInstance = new ElectronStore<StoreSchema>({
      name: STORE_NAME,
      encryptionKey,
      defaults: { salt: '' }
    }) as StoreType;
  } catch (error) {
    console.error('[store] Failed to initialize store, attempting to clear corrupted data:', error);
    clearCorruptedStore();

    storeInstance = new ElectronStore<StoreSchema>({
      name: STORE_NAME,
      encryptionKey,
      defaults: { salt: '' }
    }) as StoreType;

    console.log('[store] Store reinitialized successfully');
  }
}

export function getStore(): StoreType {
  if (!storeInstance) {
    throw new Error('Store not initialized. Call initStore() first.');
  }
  return storeInstance;
}
