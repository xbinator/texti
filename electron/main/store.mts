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

const KEY_FILE_NAME = 'texti-key.bin';

function getEncryptionKeyPath(): string {
  return path.join(app.getPath('userData'), KEY_FILE_NAME);
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

  const newKey = `texti-encryption-key-${Date.now().toString(36)}`;

  if (safeStorage.isEncryptionAvailable()) {
    const encryptedKey = safeStorage.encryptString(newKey);
    fs.writeFileSync(keyPath, encryptedKey);
  }

  return newKey;
}

export async function initStore(): Promise<void> {
  const encryptionKey = loadOrCreateEncryptionKey();

  storeInstance = new ElectronStore<StoreSchema>({
    name: 'texti-secure-store',
    encryptionKey,
    defaults: { salt: '' }
  }) as StoreType;
}

export function getStore(): StoreType {
  if (!storeInstance) {
    throw new Error('Store not initialized. Call initStore() first.');
  }
  return storeInstance;
}
