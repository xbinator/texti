/**
 * Tauri 数据迁移模块
 * 负责从旧版 Tauri 应用迁移数据到新版 Electron 应用
 * 包括：SQLite 数据库文件、IndexedDB 中的最近文件列表
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { app } from 'electron';
import { getStore } from './store.mjs';

// 数据库实例类型
type DatabaseInstance = InstanceType<typeof Database>;

// 存储的文件数据结构
interface StoredFile {
  id: string; // 文件唯一ID
  path: string | null; // 文件路径
  content: string; // 文件内容
  name: string; // 文件名
  ext: string; // 文件扩展名
}

// IndexedDB ObjectStore 行数据
interface ObjectStoreRow {
  objectStoreKey: number;
}

// IndexedDB Records 行数据
interface RecordRow {
  keyHex: string; // 十六进制编码的键
  valueHex: string; // 十六进制编码的值
}

// 表信息行数据
interface TableColumnRow {
  name: string;
}

// 存储键名常量
const RECENT_FILES_KEY = 'recent_files'; // 最近文件列表键
const CURRENT_FILE_ID_KEY = 'current_file_id'; // 当前文件ID键
const TAURI_RECENT_FILES_MIGRATION_KEY = 'migrations.tauri_recent_files_v1'; // 迁移标记键
const MAX_RECENT_FILES = 100; // 最大最近文件数

// 序列化字符串解码常量
const ASCII_LENGTH_MASK = 0x80000000; // ASCII 长度标记位
const STRING_TAG = 0x10; // 字符串类型标记

/**
 * 字段模式映射
 * 用于在序列化数据中识别各字段
 */
const FIELD_PATTERNS: Record<keyof StoredFile, Buffer> = {
  id: Buffer.from([0x02, 0x00, 0x00, 0x80, 0x69, 0x64]),
  path: Buffer.from([0x04, 0x00, 0x00, 0x80, 0x70, 0x61, 0x74, 0x68]),
  content: Buffer.from([0x07, 0x00, 0x00, 0x80, 0x63, 0x6f, 0x6e, 0x74, 0x65, 0x6e, 0x74]),
  name: Buffer.from([0x04, 0x00, 0x00, 0x80, 0x6e, 0x61, 0x6d, 0x65]),
  ext: Buffer.from([0x03, 0x00, 0x00, 0x80, 0x65, 0x78, 0x74])
};

/**
 * 解析 IndexedDB 表中的列名
 * 因为不同版本的 Tauri 可能使用不同的列名
 */
function resolveIndexedDbObjectStoreColumn(db: DatabaseInstance, tableName: string, candidates: string[]): string | null {
  try {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as TableColumnRow[];
    const columnNames = new Set(columns.map((column) => column.name));

    return candidates.find((candidate) => columnNames.has(candidate)) ?? null;
  } catch {
    return null;
  }
}

/**
 * 复制文件（如果目标文件不存在则复制）
 * @param sourcePath 源文件路径
 * @param targetPath 目标文件路径
 */
function copyFileIfMissing(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) return;

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

/**
 * 解码 IndexedDB 键
 * 从序列化的二进制数据中提取字符串键
 * IndexedDB 键格式：0x00 0x60 [长度:4字节LE] [字符串]
 */
function decodeIndexedDbKey(buffer: Buffer): string | null {
  if (buffer.length < 6 || buffer[0] !== 0x00 || buffer[1] !== 0x60) return null;

  const length = buffer.readUInt32LE(2);
  const start = 6;
  const end = start + length;
  if (end > buffer.length) return null;

  return buffer.subarray(start, end).toString('utf8');
}

/**
 * 解码序列化字符串
 * 处理 V8 序列化格式的字符串
 * 格式：[0x10] [长度标志:4字节] [字符串数据]
 * 长度标志的最高位表示编码方式：0=UTF-16, 1=ASCII
 */
function decodeSerializedString(buffer: Buffer, offset = 0): string | null {
  if (offset + 5 > buffer.length || buffer[offset] !== STRING_TAG) return null;

  const lengthFlag = buffer.readUInt32LE(offset + 1);
  const isAscii = (lengthFlag & ASCII_LENGTH_MASK) !== 0;
  const length = lengthFlag & ~ASCII_LENGTH_MASK;
  const start = offset + 5;
  const end = start + (isAscii ? length : length * 2);
  if (end > buffer.length) return null;

  return buffer.subarray(start, end).toString(isAscii ? 'utf8' : 'utf16le');
}

/**
 * 解码存储的文件列表
 * 从 V8 序列化的 IndexedDB 值中提取文件信息
 * 按顺序查找各字段的模式标记，解析对应的值
 */
function decodeStoredFiles(buffer: Buffer): StoredFile[] {
  const files: StoredFile[] = [];
  let current: Partial<StoredFile> = {};
  let searchFrom = 0;

  // 遍历缓冲区查找字段模式
  while (searchFrom < buffer.length) {
    let nextField: keyof StoredFile | null = null;
    let nextIndex = -1;

    // 查找下一个最近的字段
    for (const [field, pattern] of Object.entries(FIELD_PATTERNS) as Array<[keyof StoredFile, Buffer]>) {
      const index = buffer.indexOf(pattern, searchFrom);
      if (index === -1) continue;
      if (nextIndex === -1 || index < nextIndex) {
        nextField = field;
        nextIndex = index;
      }
    }

    if (!nextField || nextIndex === -1) break;

    const pattern = FIELD_PATTERNS[nextField];
    const value = decodeSerializedString(buffer, nextIndex + pattern.length);
    if (value !== null) {
      current[nextField] = value;

      // 当收集到 id 字段时，完成一个文件记录的解析
      if (nextField === 'id' && current.id !== undefined) {
        files.push({
          id: current.id,
          path: current.path ?? null,
          content: current.content ?? '',
          name: current.name ?? '',
          ext: current.ext ?? ''
        });
        current = {};
      }
    }

    searchFrom = nextIndex + pattern.length;
  }

  return files.slice(0, MAX_RECENT_FILES);
}

/**
 * 从 Tauri IndexedDB 读取最近文件列表
 * @param dbPath IndexedDB 数据库文件路径
 * @returns 最近文件列表和当前文件ID
 */
function readTauriRecentFiles(dbPath: string): { recentFiles: StoredFile[]; currentFileId: string | null } | null {
  let db: DatabaseInstance | null = null;

  try {
    db = new Database(dbPath, { readonly: true });

    // 解析列名（处理不同版本差异）
    const objectStoreIdColumn = resolveIndexedDbObjectStoreColumn(db, 'ObjectStoreInfo', ['objectStoreID', 'objectStoreId', 'id']);
    const recordsObjectStoreColumn = resolveIndexedDbObjectStoreColumn(db, 'Records', ['objectStoreID', 'objectStoreId']);

    if (!objectStoreIdColumn || !recordsObjectStoreColumn) {
      return null;
    }

    // 查询 files 对象存储
    const objectStore = db.prepare(`SELECT ${objectStoreIdColumn} as objectStoreKey FROM ObjectStoreInfo WHERE name = ? LIMIT 1`).get('files') as
      | ObjectStoreRow
      | undefined;

    if (!objectStore) return null;

    // 读取所有记录（键和值都以十六进制存储）
    const rows = db
      .prepare(`SELECT hex(CAST(key AS BLOB)) as keyHex, hex(CAST(value AS BLOB)) as valueHex FROM Records WHERE ${recordsObjectStoreColumn} = ?`)
      .all(objectStore.objectStoreKey) as RecordRow[];

    let recentFiles: StoredFile[] = [];
    let currentFileId: string | null = null;

    // 遍历每条记录，解码键和值
    for (const row of rows) {
      const key = decodeIndexedDbKey(Buffer.from(row.keyHex, 'hex'));
      if (!key) continue;

      const valueBuffer = Buffer.from(row.valueHex, 'hex');

      // 根据键名区分处理
      if (key === RECENT_FILES_KEY) {
        recentFiles = decodeStoredFiles(valueBuffer);
      } else if (key === CURRENT_FILE_ID_KEY) {
        currentFileId = decodeSerializedString(valueBuffer);
      }
    }

    return { recentFiles, currentFileId };
  } catch (error) {
    console.error('[migration] Failed to read Tauri recent files:', error);
    return null;
  } finally {
    db?.close();
  }
}

/**
 * 查找 Tauri IndexedDB 数据库文件
 * Tauri 使用 WebKit 存储 IndexedDB，路径在 ~/Library/WebKit/{app}/WebsiteData/Default/IndexedDB/
 */
function findTauriIndexedDbCandidates(): string[] {
  const webkitRoot = path.join(app.getPath('home'), 'Library', 'WebKit', 'Texti', 'WebsiteData', 'Default');
  if (!fs.existsSync(webkitRoot)) return [];

  const candidates: string[] = [];

  // 遍历 WebKit 存储目录结构
  for (const firstLevel of fs.readdirSync(webkitRoot)) {
    const firstPath = path.join(webkitRoot, firstLevel);
    if (!fs.statSync(firstPath).isDirectory()) continue;

    for (const secondLevel of fs.readdirSync(firstPath)) {
      const indexedDbRoot = path.join(firstPath, secondLevel, 'IndexedDB');
      if (!fs.existsSync(indexedDbRoot) || !fs.statSync(indexedDbRoot).isDirectory()) continue;

      // 查找 IndexedDB.sqlite3 文件
      for (const thirdLevel of fs.readdirSync(indexedDbRoot)) {
        const dbPath = path.join(indexedDbRoot, thirdLevel, 'IndexedDB.sqlite3');
        if (fs.existsSync(dbPath)) {
          candidates.push(dbPath);
        }
      }
    }
  }

  return candidates;
}

/**
 * 从 Tauri IndexedDB 迁移最近文件到 Electron Store
 * 检查是否已迁移，只有在未迁移且 Electron 存储为空时才迁移
 */
function migrateRecentFilesFromTauri(): void {
  const store = getStore();

  // 检查是否已完成迁移
  if (store.get(TAURI_RECENT_FILES_MIGRATION_KEY)) return;

  // 检查 Electron 端是否已有数据（优先保留 Electron 数据）
  const currentRecentFiles = store.get(RECENT_FILES_KEY);
  const currentFileId = store.get(CURRENT_FILE_ID_KEY);
  if ((Array.isArray(currentRecentFiles) && currentRecentFiles.length > 0) || typeof currentFileId === 'string') {
    store.set(TAURI_RECENT_FILES_MIGRATION_KEY, true);
    return;
  }

  // 遍历所有可能的 Tauri IndexedDB 数据库
  for (const dbPath of findTauriIndexedDbCandidates()) {
    const migrated = readTauriRecentFiles(dbPath);
    if (!migrated) continue;

    // 迁移最近文件
    if (migrated.recentFiles.length > 0) {
      store.set(RECENT_FILES_KEY, migrated.recentFiles);
    }

    // 迁移当前文件ID
    if (migrated.currentFileId) {
      store.set(CURRENT_FILE_ID_KEY, migrated.currentFileId);
    }

    // 迁移成功则记录日志并退出
    if (migrated.recentFiles.length > 0 || migrated.currentFileId) {
      console.log(`[migration] Migrated recent files from Tauri IndexedDB: ${dbPath}`);
      break;
    }
  }

  // 标记迁移完成
  store.set(TAURI_RECENT_FILES_MIGRATION_KEY, true);
}

/**
 * 从 Tauri 迁移数据到 Electron
 * 迁移项目：
 * 1. SQLite 数据库文件（texti.db 及 WAL/SHM 文件）
 * 2. IndexedDB 中的最近文件列表
 */
export function migrateFromTauri(): void {
  // Tauri 数据目录（com.Texti.desktop 是 Tauri 的默认标识）
  const tauriDataDir = path.join(app.getPath('appData'), 'com.Texti.desktop');
  // Electron 数据目录
  const electronDataDir = app.getPath('userData');

  // 复制 SQLite 数据库及其 WAL 日志文件
  copyFileIfMissing(path.join(tauriDataDir, 'texti.db'), path.join(electronDataDir, 'texti.db'));
  copyFileIfMissing(path.join(tauriDataDir, 'texti.db-wal'), path.join(electronDataDir, 'texti.db-wal'));
  copyFileIfMissing(path.join(tauriDataDir, 'texti.db-shm'), path.join(electronDataDir, 'texti.db-shm'));

  // 迁移最近文件
  migrateRecentFilesFromTauri();
}
