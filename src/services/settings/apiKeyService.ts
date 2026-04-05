import type { ApiKeyProfile, CreateApiKeyProfileInput, UpdateApiKeyProfileInput, ConnectionTestResult, ConnectionStatus } from './types';
import { invoke } from '@tauri-apps/api/core';
import { nanoid } from 'nanoid';
import { getDatabase } from '@/utils/database';
import { storeApiKey, getApiKey, deleteApiKey, generateKeyRef } from '@/utils/stronghold';

function mapRowToProfile(row: Record<string, unknown>): ApiKeyProfile {
  return {
    id: row.id as string,
    name: row.name as string,
    provider: row.provider as ApiKeyProfile['provider'],
    keyRef: row.key_ref as string,
    baseUrl: row.base_url as string | null,
    connectionStatus: row.connection_status as ConnectionStatus,
    lastTestedAt: row.last_tested_at as number | null,
    latencyMs: row.latency_ms as number | null,
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number
  };
}

export async function listApiKeyProfiles(): Promise<ApiKeyProfile[]> {
  const db = getDatabase();
  const rows = await db.select<Array<Record<string, unknown>>>('SELECT * FROM api_key_profiles ORDER BY is_default DESC, created_at DESC');
  return rows.map(mapRowToProfile);
}

export async function getApiKeyProfile(id: string): Promise<ApiKeyProfile | null> {
  const db = getDatabase();
  const rows = await db.select<Array<Record<string, unknown>>>('SELECT * FROM api_key_profiles WHERE id = ?', [id]);
  return rows.length > 0 ? mapRowToProfile(rows[0]) : null;
}

export async function getDefaultApiKeyProfile(): Promise<ApiKeyProfile | null> {
  const db = getDatabase();
  const rows = await db.select<Array<Record<string, unknown>>>('SELECT * FROM api_key_profiles WHERE is_default = 1 LIMIT 1');
  return rows.length > 0 ? mapRowToProfile(rows[0]) : null;
}

export async function createApiKeyProfile(input: CreateApiKeyProfileInput): Promise<ApiKeyProfile> {
  const db = getDatabase();
  const id = nanoid();
  const now = Date.now();
  const keyRef = generateKeyRef(id);

  await storeApiKey(id, input.apiKey);

  if (input.isDefault) {
    await db.execute('UPDATE api_key_profiles SET is_default = 0');
  }

  await db.execute(
    `INSERT INTO api_key_profiles 
     (id, name, provider, key_ref, base_url, connection_status, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'untested', ?, ?, ?)`,
    [id, input.name, input.provider, keyRef, input.baseUrl || null, input.isDefault ? 1 : 0, now, now]
  );

  const profile = await getApiKeyProfile(id);
  if (!profile) {
    throw new Error('Failed to create API key profile');
  }

  return profile;
}

export async function updateApiKeyProfile(id: string, input: UpdateApiKeyProfileInput): Promise<ApiKeyProfile> {
  const db = getDatabase();
  const now = Date.now();
  const existing = await getApiKeyProfile(id);

  if (!existing) {
    throw new Error('API key profile not found');
  }

  if (input.apiKey) {
    await storeApiKey(id, input.apiKey);
  }

  if (input.isDefault) {
    await db.execute('UPDATE api_key_profiles SET is_default = 0');
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }
  if (input.baseUrl !== undefined) {
    updates.push('base_url = ?');
    values.push(input.baseUrl || null);
  }
  if (input.isDefault !== undefined) {
    updates.push('is_default = ?');
    values.push(input.isDefault ? 1 : 0);
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    values.push(now);
    values.push(id);

    await db.execute(`UPDATE api_key_profiles SET ${updates.join(', ')} WHERE id = ?`, values);
  }

  const profile = await getApiKeyProfile(id);
  if (!profile) {
    throw new Error('Failed to update API key profile');
  }

  return profile;
}

export async function deleteApiKeyProfile(id: string): Promise<void> {
  const db = getDatabase();

  await db.execute('DELETE FROM api_key_profiles WHERE id = ?', [id]);

  await deleteApiKey(id);
}

export async function testConnection(id: string): Promise<ConnectionTestResult> {
  const db = getDatabase();
  const profile = await getApiKeyProfile(id);

  if (!profile) {
    throw new Error('API key profile not found');
  }

  const apiKey = await getApiKey(id);
  if (!apiKey) {
    throw new Error('API key not found in secure storage');
  }

  const result = await invoke<ConnectionTestResult>('test_api_connection', {
    provider: profile.provider,
    apiKey,
    baseUrl: profile.baseUrl
  });

  const now = Date.now();
  const status: ConnectionStatus = result.success ? 'connected' : 'failed';

  await db.execute(
    `UPDATE api_key_profiles 
     SET connection_status = ?, last_tested_at = ?, latency_ms = ?, updated_at = ?
     WHERE id = ?`,
    [status, now, result.latencyMs, now, id]
  );

  return result;
}

export async function getDecryptedApiKey(id: string): Promise<string | null> {
  return getApiKey(id);
}
