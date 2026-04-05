import { isTauri } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { Stronghold, Client } from '@tauri-apps/plugin-stronghold';

const VAULT_NAME = 'texti.stronghold';
const VAULT_PASSWORD = 'texti-app-vault-password';
const CLIENT_NAME = 'texti-settings';

function generateKeyRef(profileId: string): string {
  return `apikey:${profileId}`;
}

function parseKeyRef(keyRef: string): string | null {
  const match = keyRef.match(/^apikey:(.+)$/);
  return match ? match[1] : null;
}

let stronghold: Stronghold | null = null;
let client: Client | null = null;

async function getVaultPath(): Promise<string> {
  const appDir = await appDataDir();
  return join(appDir, VAULT_NAME);
}

export async function initStronghold(): Promise<void> {
  if (stronghold && client) {
    return;
  }

  if (!isTauri()) {
    throw new Error('Stronghold initialization requires Tauri environment');
  }

  const vaultPath = await getVaultPath();

  stronghold = await Stronghold.load(vaultPath, VAULT_PASSWORD);

  try {
    client = await stronghold.loadClient(CLIENT_NAME);
  } catch {
    client = await stronghold.createClient(CLIENT_NAME);
  }
}

function getStore() {
  if (!client) {
    throw new Error('Stronghold not initialized. Call initStronghold() first.');
  }
  return client.getStore();
}

export async function storeApiKey(profileId: string, apiKey: string): Promise<void> {
  const store = getStore();
  const keyRef = generateKeyRef(profileId);
  const data = Array.from(new TextEncoder().encode(apiKey));

  await store.insert(keyRef, data);

  if (stronghold) {
    await stronghold.save();
  }
}

export async function getApiKey(profileId: string): Promise<string | null> {
  try {
    const store = getStore();
    const keyRef = generateKeyRef(profileId);
    const data = await store.get(keyRef);

    if (!data) {
      return null;
    }

    return new TextDecoder().decode(new Uint8Array(data));
  } catch {
    return null;
  }
}

export async function deleteApiKey(profileId: string): Promise<void> {
  const store = getStore();
  const keyRef = generateKeyRef(profileId);

  await store.remove(keyRef);

  if (stronghold) {
    await stronghold.save();
  }
}

export async function updateApiKey(profileId: string, apiKey: string): Promise<void> {
  await deleteApiKey(profileId);
  await storeApiKey(profileId, apiKey);
}

export { generateKeyRef, parseKeyRef };
