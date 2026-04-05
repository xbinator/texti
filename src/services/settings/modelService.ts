import type { Model, CreateModelInput, UpdateModelInput, Provider } from './types';
import { nanoid } from 'nanoid';
import { getDatabase } from '@/utils/database';

function mapRowToModel(row: Record<string, unknown>): Model {
  return {
    id: row.id as string,
    name: row.name as string,
    provider: row.provider as Provider,
    modelId: row.model_id as string,
    apiKeyProfileId: row.api_key_profile_id as string,
    maxTokens: row.max_tokens as number,
    temperature: row.temperature as number,
    isEnabled: Boolean(row.is_enabled),
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number
  };
}

export async function listModels(): Promise<Model[]> {
  const db = getDatabase();
  const rows = await db.select<Array<Record<string, unknown>>>('SELECT * FROM models ORDER BY is_default DESC, created_at DESC');
  return rows.map(mapRowToModel);
}

export async function getModel(id: string): Promise<Model | null> {
  const db = getDatabase();
  const rows = await db.select<Array<Record<string, unknown>>>('SELECT * FROM models WHERE id = ?', [id]);
  return rows.length > 0 ? mapRowToModel(rows[0]) : null;
}

export async function getDefaultModel(): Promise<Model | null> {
  const db = getDatabase();
  const rows = await db.select<Array<Record<string, unknown>>>('SELECT * FROM models WHERE is_default = 1 AND is_enabled = 1 LIMIT 1');
  return rows.length > 0 ? mapRowToModel(rows[0]) : null;
}

export async function listModelsByApiKeyProfile(apiKeyProfileId: string): Promise<Model[]> {
  const db = getDatabase();
  const rows = await db.select<Array<Record<string, unknown>>>('SELECT * FROM models WHERE api_key_profile_id = ? ORDER BY created_at DESC', [apiKeyProfileId]);
  return rows.map(mapRowToModel);
}

export async function createModel(input: CreateModelInput): Promise<Model> {
  const db = getDatabase();
  const id = nanoid();
  const now = Date.now();

  if (input.isDefault) {
    await db.execute('UPDATE models SET is_default = 0');
  }

  await db.execute(
    `INSERT INTO models
     (id, name, provider, model_id, api_key_profile_id, max_tokens, temperature, is_enabled, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [id, input.name, input.provider, input.modelId, input.apiKeyProfileId, input.maxTokens ?? 4096, input.temperature ?? 0.7, input.isDefault ? 1 : 0, now, now]
  );

  const model = await getModel(id);
  if (!model) {
    throw new Error('Failed to create model');
  }

  return model;
}

export async function updateModel(id: string, input: UpdateModelInput): Promise<Model> {
  const db = getDatabase();
  const now = Date.now();

  const existing = await getModel(id);
  if (!existing) {
    throw new Error('Model not found');
  }

  if (input.isDefault) {
    await db.execute('UPDATE models SET is_default = 0');
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }
  if (input.modelId !== undefined) {
    updates.push('model_id = ?');
    values.push(input.modelId);
  }
  if (input.apiKeyProfileId !== undefined) {
    updates.push('api_key_profile_id = ?');
    values.push(input.apiKeyProfileId);
  }
  if (input.maxTokens !== undefined) {
    updates.push('max_tokens = ?');
    values.push(input.maxTokens);
  }
  if (input.temperature !== undefined) {
    updates.push('temperature = ?');
    values.push(input.temperature);
  }
  if (input.isEnabled !== undefined) {
    updates.push('is_enabled = ?');
    values.push(input.isEnabled ? 1 : 0);
  }
  if (input.isDefault !== undefined) {
    updates.push('is_default = ?');
    values.push(input.isDefault ? 1 : 0);
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    values.push(now);
    values.push(id);

    await db.execute(`UPDATE models SET ${updates.join(', ')} WHERE id = ?`, values);
  }

  const model = await getModel(id);
  if (!model) {
    throw new Error('Failed to update model');
  }

  return model;
}

export async function deleteModel(id: string): Promise<void> {
  const db = getDatabase();
  await db.execute('DELETE FROM models WHERE id = ?', [id]);
}

export async function setModelEnabled(id: string, enabled: boolean): Promise<Model> {
  return updateModel(id, { isEnabled: enabled });
}

export async function setDefaultModel(id: string): Promise<Model> {
  return updateModel(id, { isDefault: true });
}
