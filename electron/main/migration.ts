import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { app } from 'electron';
import { getStore } from './store';

type DatabaseInstance = InstanceType<typeof Database>;

interface StoredFile {
  id: string;
  path: string | null;
  content: string;
  name: string;
  ext: string;
}

interface ObjectStoreRow {
  objectStoreKey: number;
}

interface RecordRow {
  keyHex: string;
  valueHex: string;
}

interface TableColumnRow {
  name: string;
}

function resolveIndexedDbObjectStoreColumn(db: DatabaseInstance, tableName: string, candidates: string[]): string | null {
  try {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as TableColumnRow[];
    const columnNames = new Set(columns.map((column) => column.name));

    return candidates.find((candidate) => columnNames.has(candidate)) ?? null;
  } catch {
    return null;
  }
}

const RECENT_FILES_KEY = 'recent_files';
const CURRENT_FILE_ID_KEY = 'current_file_id';
const TAURI_RECENT_FILES_MIGRATION_KEY = 'migrations.tauri_recent_files_v1';
const MAX_RECENT_FILES = 100;

const ASCII_LENGTH_MASK = 0x80000000;
const STRING_TAG = 0x10;

const FIELD_PATTERNS: Record<keyof StoredFile, Buffer> = {
  id: Buffer.from([0x02, 0x00, 0x00, 0x80, 0x69, 0x64]),
  path: Buffer.from([0x04, 0x00, 0x00, 0x80, 0x70, 0x61, 0x74, 0x68]),
  content: Buffer.from([0x07, 0x00, 0x00, 0x80, 0x63, 0x6f, 0x6e, 0x74, 0x65, 0x6e, 0x74]),
  name: Buffer.from([0x04, 0x00, 0x00, 0x80, 0x6e, 0x61, 0x6d, 0x65]),
  ext: Buffer.from([0x03, 0x00, 0x00, 0x80, 0x65, 0x78, 0x74])
};

function copyFileIfMissing(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) return;

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function decodeIndexedDbKey(buffer: Buffer): string | null {
  if (buffer.length < 6 || buffer[0] !== 0x00 || buffer[1] !== 0x60) return null;

  const length = buffer.readUInt32LE(2);
  const start = 6;
  const end = start + length;
  if (end > buffer.length) return null;

  return buffer.subarray(start, end).toString('utf8');
}

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

function decodeStoredFiles(buffer: Buffer): StoredFile[] {
  const files: StoredFile[] = [];
  let current: Partial<StoredFile> = {};
  let searchFrom = 0;

  while (searchFrom < buffer.length) {
    let nextField: keyof StoredFile | null = null;
    let nextIndex = -1;

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

function readTauriRecentFiles(dbPath: string): { recentFiles: StoredFile[]; currentFileId: string | null } | null {
  let db: DatabaseInstance | null = null;

  try {
    db = new Database(dbPath, { readonly: true });
    const objectStoreIdColumn = resolveIndexedDbObjectStoreColumn(db, 'ObjectStoreInfo', ['objectStoreID', 'objectStoreId', 'id']);
    const recordsObjectStoreColumn = resolveIndexedDbObjectStoreColumn(db, 'Records', ['objectStoreID', 'objectStoreId']);

    if (!objectStoreIdColumn || !recordsObjectStoreColumn) {
      return null;
    }

    const objectStore = db.prepare(`SELECT ${objectStoreIdColumn} as objectStoreKey FROM ObjectStoreInfo WHERE name = ? LIMIT 1`).get('files') as
      | ObjectStoreRow
      | undefined;

    if (!objectStore) return null;

    const rows = db
      .prepare(`SELECT hex(CAST(key AS BLOB)) as keyHex, hex(CAST(value AS BLOB)) as valueHex FROM Records WHERE ${recordsObjectStoreColumn} = ?`)
      .all(objectStore.objectStoreKey) as RecordRow[];

    let recentFiles: StoredFile[] = [];
    let currentFileId: string | null = null;

    for (const row of rows) {
      const key = decodeIndexedDbKey(Buffer.from(row.keyHex, 'hex'));
      if (!key) continue;

      const valueBuffer = Buffer.from(row.valueHex, 'hex');
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

function findTauriIndexedDbCandidates(): string[] {
  const webkitRoot = path.join(app.getPath('home'), 'Library', 'WebKit', 'Texti', 'WebsiteData', 'Default');
  if (!fs.existsSync(webkitRoot)) return [];

  const candidates: string[] = [];
  for (const firstLevel of fs.readdirSync(webkitRoot)) {
    const firstPath = path.join(webkitRoot, firstLevel);
    if (!fs.statSync(firstPath).isDirectory()) continue;

    for (const secondLevel of fs.readdirSync(firstPath)) {
      const indexedDbRoot = path.join(firstPath, secondLevel, 'IndexedDB');
      if (!fs.existsSync(indexedDbRoot) || !fs.statSync(indexedDbRoot).isDirectory()) continue;

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

function migrateRecentFilesFromTauri(): void {
  const store = getStore();
  if (store.get(TAURI_RECENT_FILES_MIGRATION_KEY)) return;

  const currentRecentFiles = store.get(RECENT_FILES_KEY);
  const currentFileId = store.get(CURRENT_FILE_ID_KEY);
  if ((Array.isArray(currentRecentFiles) && currentRecentFiles.length > 0) || typeof currentFileId === 'string') {
    store.set(TAURI_RECENT_FILES_MIGRATION_KEY, true);
    return;
  }

  for (const dbPath of findTauriIndexedDbCandidates()) {
    const migrated = readTauriRecentFiles(dbPath);
    if (!migrated) continue;

    if (migrated.recentFiles.length > 0) {
      store.set(RECENT_FILES_KEY, migrated.recentFiles);
    }

    if (migrated.currentFileId) {
      store.set(CURRENT_FILE_ID_KEY, migrated.currentFileId);
    }

    if (migrated.recentFiles.length > 0 || migrated.currentFileId) {
      console.log(`[migration] Migrated recent files from Tauri IndexedDB: ${dbPath}`);
      break;
    }
  }

  store.set(TAURI_RECENT_FILES_MIGRATION_KEY, true);
}

export function migrateFromTauri(): void {
  const tauriDataDir = path.join(app.getPath('appData'), 'com.Texti.desktop');
  const electronDataDir = app.getPath('userData');

  copyFileIfMissing(path.join(tauriDataDir, 'texti.db'), path.join(electronDataDir, 'texti.db'));
  copyFileIfMissing(path.join(tauriDataDir, 'texti.db-wal'), path.join(electronDataDir, 'texti.db-wal'));
  copyFileIfMissing(path.join(tauriDataDir, 'texti.db-shm'), path.join(electronDataDir, 'texti.db-shm'));

  migrateRecentFilesFromTauri();
}
