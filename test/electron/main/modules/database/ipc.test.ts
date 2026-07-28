/**
 * @file ipc.test.ts
 * @description 验证 Renderer 数据库 IPC 只允许 service_models 的精确 SQL 与参数形状。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerDatabaseHandlers } from '../../../../../electron/main/modules/database/ipc.mts';
/** IPC handler 的最小测试签名。 */
type DatabaseIpcHandler = (event: unknown, sql: unknown, params?: unknown) => Promise<unknown>;

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  dbExecute: vi.fn(),
  dbSelect: vi.fn()
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: mocks.handle
  }
}));

vi.mock('../../../../../electron/main/modules/database/service.mjs', () => ({
  dbExecute: mocks.dbExecute,
  dbSelect: mocks.dbSelect
}));

/**
 * 读取注册到指定 channel 的 IPC handler。
 * @param channel - IPC channel
 * @returns 已注册 handler
 */
function getHandler(channel: 'db:execute' | 'db:select'): DatabaseIpcHandler {
  const call = mocks.handle.mock.calls.find(([registeredChannel]) => registeredChannel === channel);
  if (!call) throw new Error(`Missing ${channel} handler`);
  return call[1] as DatabaseIpcHandler;
}

describe('database IPC SQL allowlist', (): void => {
  beforeEach((): void => {
    mocks.handle.mockReset();
    mocks.dbExecute.mockReset();
    mocks.dbSelect.mockReset();
    mocks.dbExecute.mockReturnValue({ changes: 1, lastInsertRowid: 1 });
    mocks.dbSelect.mockReturnValue([]);
    registerDatabaseHandlers();
  });

  it('allows only the current service_models select shapes with exact parameter counts', async (): Promise<void> => {
    const select = getHandler('db:select');

    await expect(select({}, 'SELECT service_type, provider_id, model_id, custom_prompt, updated_at FROM service_models')).resolves.toEqual([]);
    await expect(
      select({}, 'SELECT service_type, provider_id, model_id, custom_prompt, updated_at FROM service_models WHERE service_type = ? LIMIT 1', ['chat'])
    ).resolves.toEqual([]);
    expect(mocks.dbSelect).toHaveBeenCalledTimes(2);
  });

  it('allows only the current service_models upsert and delete shapes', async (): Promise<void> => {
    const execute = getHandler('db:execute');

    await expect(
      execute(
        {},
        `INSERT OR REPLACE INTO service_models
          (service_type, provider_id, model_id, custom_prompt, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        ['chat', 'openai', 'gpt-5', null, 1]
      )
    ).resolves.toMatchObject({ changes: 1, lastInsertRowid: 1 });
    await expect(execute({}, 'DELETE FROM service_models WHERE service_type = ?', ['chat'])).resolves.toMatchObject({
      changes: 1
    });
    expect(mocks.dbExecute).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['agent write', 'UPDATE chat_agent_tasks SET status = ?', ['completed']],
    ['sqlite metadata', "SELECT name FROM sqlite_master WHERE type = 'table'", []],
    ['pragma', 'PRAGMA table_info(chat_agent_tasks)', []],
    ['multiple statements', 'SELECT service_type, provider_id, model_id, custom_prompt, updated_at FROM service_models; DELETE FROM service_models', []],
    ['line comment', 'SELECT service_type, provider_id, model_id, custom_prompt, updated_at FROM service_models -- allowed?', []],
    ['block comment', '/* bypass */ SELECT service_type, provider_id, model_id, custom_prompt, updated_at FROM service_models', []],
    ['unknown service_models SQL', 'UPDATE service_models SET model_id = ?', ['gpt-5']]
  ])('rejects %s SQL before calling the database', async (_name: string, sql: string, params: unknown[]): Promise<void> => {
    const handler = /^\s*(?:SELECT|PRAGMA|\/\*)/i.test(sql) ? getHandler('db:select') : getHandler('db:execute');

    await expect(handler({}, sql, params)).rejects.toMatchObject({
      code: 'database_ipc_protocol_error',
      reason: 'sql_not_allowed'
    });
    expect(mocks.dbExecute).not.toHaveBeenCalled();
    expect(mocks.dbSelect).not.toHaveBeenCalled();
  });

  it.each([
    ['select all with params', 'db:select', 'SELECT service_type, provider_id, model_id, custom_prompt, updated_at FROM service_models', ['unexpected']],
    [
      'select one without params',
      'db:select',
      'SELECT service_type, provider_id, model_id, custom_prompt, updated_at FROM service_models WHERE service_type = ? LIMIT 1',
      []
    ],
    [
      'upsert with too few params',
      'db:execute',
      'INSERT OR REPLACE INTO service_models (service_type, provider_id, model_id, custom_prompt, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['chat']
    ],
    ['delete with too many params', 'db:execute', 'DELETE FROM service_models WHERE service_type = ?', ['chat', 'extra']]
  ] as const)('rejects %s', async (_name: string, channel: 'db:execute' | 'db:select', sql: string, params: readonly unknown[]): Promise<void> => {
    await expect(getHandler(channel)({}, sql, [...params])).rejects.toMatchObject({
      code: 'database_ipc_protocol_error',
      reason: 'params_invalid'
    });
    expect(mocks.dbExecute).not.toHaveBeenCalled();
    expect(mocks.dbSelect).not.toHaveBeenCalled();
  });
});
