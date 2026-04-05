import type { Assistant, CreateAssistantInput, UpdateAssistantInput } from './types';
import { nanoid } from 'nanoid';
import { getDatabase } from '@/utils/database';

function mapRowToAssistant(row: Record<string, unknown>): Assistant {
  return {
    id: row.id as string,
    name: row.name as string,
    modelId: row.model_id as string,
    systemPrompt: row.system_prompt as string | null,
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number
  };
}

export async function listAssistants(): Promise<Assistant[]> {
  const db = getDatabase();
  const rows = await db.select<Array<Record<string, unknown>>>('SELECT * FROM assistants ORDER BY is_default DESC, created_at DESC');
  return rows.map(mapRowToAssistant);
}

export async function getAssistant(id: string): Promise<Assistant | null> {
  const db = getDatabase();
  const rows = await db.select<Array<Record<string, unknown>>>('SELECT * FROM assistants WHERE id = ?', [id]);
  return rows.length > 0 ? mapRowToAssistant(rows[0]) : null;
}

export async function getDefaultAssistant(): Promise<Assistant | null> {
  const db = getDatabase();
  const rows = await db.select<Array<Record<string, unknown>>>('SELECT * FROM assistants WHERE is_default = 1 LIMIT 1');
  return rows.length > 0 ? mapRowToAssistant(rows[0]) : null;
}

export async function listAssistantsByModel(modelId: string): Promise<Assistant[]> {
  const db = getDatabase();
  const rows = await db.select<Array<Record<string, unknown>>>('SELECT * FROM assistants WHERE model_id = ? ORDER BY created_at DESC', [modelId]);
  return rows.map(mapRowToAssistant);
}

export async function createAssistant(input: CreateAssistantInput): Promise<Assistant> {
  const db = getDatabase();
  const id = nanoid();
  const now = Date.now();

  if (input.isDefault) {
    await db.execute('UPDATE assistants SET is_default = 0');
  }

  await db.execute(
    `INSERT INTO assistants 
     (id, name, model_id, system_prompt, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.modelId, input.systemPrompt || null, input.isDefault ? 1 : 0, now, now]
  );

  const assistant = await getAssistant(id);
  if (!assistant) {
    throw new Error('Failed to create assistant');
  }

  return assistant;
}

export async function updateAssistant(id: string, input: UpdateAssistantInput): Promise<Assistant> {
  const db = getDatabase();
  const now = Date.now();

  const existing = await getAssistant(id);
  if (!existing) {
    throw new Error('Assistant not found');
  }

  if (input.isDefault) {
    await db.execute('UPDATE assistants SET is_default = 0');
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
  if (input.systemPrompt !== undefined) {
    updates.push('system_prompt = ?');
    values.push(input.systemPrompt || null);
  }
  if (input.isDefault !== undefined) {
    updates.push('is_default = ?');
    values.push(input.isDefault ? 1 : 0);
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    values.push(now);
    values.push(id);

    await db.execute(`UPDATE assistants SET ${updates.join(', ')} WHERE id = ?`, values);
  }

  const assistant = await getAssistant(id);
  if (!assistant) {
    throw new Error('Failed to update assistant');
  }

  return assistant;
}

export async function deleteAssistant(id: string): Promise<void> {
  const db = getDatabase();
  await db.execute('DELETE FROM assistants WHERE id = ?', [id]);
}

export async function setDefaultAssistant(id: string): Promise<Assistant> {
  return updateAssistant(id, { isDefault: true });
}
