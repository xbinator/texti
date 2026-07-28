/**
 * @file ipc.mts
 * @description 注册只允许 service_models 精确 SQL 的 Renderer 数据库 IPC 边界。
 */
import type { DbExecuteResult } from 'types/electron-api';
import { ipcMain } from 'electron';
import { dbExecute, dbSelect } from './service.mjs';

/** Renderer 数据库请求拒绝原因。 */
export type DatabaseIpcProtocolReason = 'sql_not_allowed' | 'params_invalid';

/** Renderer 数据库 IPC 的稳定协议错误。 */
export class DatabaseIpcProtocolError extends Error {
  /** 机器可判断错误码。 */
  readonly code = 'database_ipc_protocol_error';

  /** 机器可判断拒绝原因。 */
  readonly reason: DatabaseIpcProtocolReason;

  /**
   * 创建数据库 IPC 协议错误。
   * @param reason - 稳定拒绝原因
   */
  constructor(reason: DatabaseIpcProtocolReason) {
    super(reason === 'sql_not_allowed' ? 'Database IPC SQL is not allowed' : 'Database IPC parameters are invalid');
    this.name = 'DatabaseIpcProtocolError';
    this.reason = reason;
  }
}

/** service_models 查询全部配置的规范 SQL。 */
const SELECT_ALL_SQL = 'SELECT service_type, provider_id, model_id, custom_prompt, updated_at FROM service_models';

/** service_models 查询单个配置的规范 SQL。 */
const SELECT_ONE_SQL = `${SELECT_ALL_SQL} WHERE service_type = ? LIMIT 1`;

/** service_models 写入配置的规范 SQL。 */
const UPSERT_SQL = 'INSERT OR REPLACE INTO service_models (service_type, provider_id, model_id, custom_prompt, updated_at) VALUES (?, ?, ?, ?, ?)';

/** service_models 删除配置的规范 SQL。 */
const DELETE_SQL = 'DELETE FROM service_models WHERE service_type = ?';

/** 每个 db:select SQL 允许的参数数量。 */
const SELECT_PARAM_COUNTS = new Map<string, number>([
  [SELECT_ALL_SQL, 0],
  [SELECT_ONE_SQL, 1]
]);

/** 每个 db:execute SQL 允许的参数数量。 */
const EXECUTE_PARAM_COUNTS = new Map<string, number>([
  [UPSERT_SQL, 5],
  [DELETE_SQL, 1]
]);

/** 已验证的 Renderer 数据库请求。 */
interface ValidatedDatabaseRequest {
  /** 规范 SQL。 */
  sql: string;
  /** 精确数量的 SQLite 参数。 */
  params: unknown[];
}

/**
 * 仅折叠空白并显式拒绝注释、多语句与控制字符。
 * @param input - Renderer 提供的 SQL
 * @returns 规范 SQL，非法时返回 null
 */
function normalizeSql(input: unknown): string | null {
  if (typeof input !== 'string' || input.includes(';') || input.includes('--') || input.includes('/*') || input.includes('*/') || input.includes('\0')) {
    return null;
  }
  const normalized = input.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
}

/**
 * 校验 channel、SQL 形状与参数数量。
 * @param channel - 数据库 IPC channel
 * @param sqlInput - Renderer SQL
 * @param paramsInput - Renderer 参数
 * @returns 可安全交给 SQLite 的规范请求
 */
function validateRequest(channel: 'db:execute' | 'db:select', sqlInput: unknown, paramsInput: unknown): ValidatedDatabaseRequest {
  const sql = normalizeSql(sqlInput);
  const paramCounts = channel === 'db:select' ? SELECT_PARAM_COUNTS : EXECUTE_PARAM_COUNTS;
  if (!sql || !paramCounts.has(sql)) throw new DatabaseIpcProtocolError('sql_not_allowed');
  const params = paramsInput === undefined ? [] : paramsInput;
  if (!Array.isArray(params) || params.length !== paramCounts.get(sql)) {
    throw new DatabaseIpcProtocolError('params_invalid');
  }
  return { sql, params };
}

/**
 * 注册 Renderer 数据库 IPC handler。
 */
export function registerDatabaseHandlers(): void {
  ipcMain.handle('db:execute', async (_event, sql: unknown, params?: unknown): Promise<DbExecuteResult> => {
    const request = validateRequest('db:execute', sql, params);
    const result = dbExecute(request.sql, request.params);

    return {
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid)
    };
  });

  ipcMain.handle('db:select', async (_event, sql: unknown, params?: unknown): Promise<unknown[]> => {
    const request = validateRequest('db:select', sql, params);
    return dbSelect(request.sql, request.params);
  });
}
