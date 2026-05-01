/**
 * @file referenceSnapshot.ts
 * @description 文件引用快照持久化工具
 */
import type { Message } from './types';
import type { ChatMessageFileReference, ChatMessageFileReferencePart, ChatReferenceSnapshot } from 'types/chat';
import { nanoid } from 'nanoid';
import pLimit from 'p-limit';
import { editorToolContextRegistry } from '@/ai/tools/editor-context';
import { native } from '@/shared/platform';
import { chatStorage } from '@/shared/storage';

// ─── 内部类型 ────────────────────────────────────────────────────────────────

type EditorContext = ReturnType<typeof editorToolContextRegistry.getContext>;

interface GroupEntry {
  refs: Array<ChatMessageFileReference | ChatMessageFileReferencePart>;
  /** editor 来源时携带 context，避免后续重复查询 registry */
  context?: EditorContext;
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/** 构造快照对象，消除多处重复的字面量 */
function makeSnapshot(documentId: string, title: string, content: string): ChatReferenceSnapshot {
  return { id: nanoid(), documentId, title, content, createdAt: new Date().toISOString() };
}

/**
 * 尝试从 SQLite 历史快照降级，成功则写入 snapshotId 并追加到 snapshots。
 * disk / sqlite 两处共用，避免逻辑重复。
 */
async function applySnapshotFromSqlite(refs: Array<ChatMessageFileReference | ChatMessageFileReferencePart>, snapshots: ChatReferenceSnapshot[]): Promise<void> {
  const cached = await chatStorage.getReferenceSnapshotByDocumentId(refs[0].documentId);
  if (cached) {
    refs.forEach((r) => (r.snapshotId = cached.id));
    snapshots.push(cached);
  }
}

/**
 * 收集消息中的文件引用元数据，优先使用结构化片段。
 * @param message - 聊天消息
 * @returns 引用列表
 */
function collectReferences(message: Message): Array<ChatMessageFileReference | ChatMessageFileReferencePart> {
  const partReferences = message.parts.filter((part): part is ChatMessageFileReferencePart => part.type === 'file-reference');

  if (partReferences.length > 0) {
    return partReferences;
  }

  return message.references ?? [];
}

// ─── 分组 ─────────────────────────────────────────────────────────────────────

/**
 * 将引用按来源分组，同时缓存 editorContext 避免后续重复查询。
 * 分组键格式：`"editor|documentId"` | `"disk|path"` | `"sqlite|documentId"`
 */
function buildGroups(references: Array<ChatMessageFileReference | ChatMessageFileReferencePart>): Map<string, GroupEntry> {
  const groups = new Map<string, GroupEntry>();

  for (const ref of references) {
    const context = editorToolContextRegistry.getContext(ref.documentId);
    let key: string;
    if (context) {
      key = `editor|${ref.documentId}`;
    } else if (ref.path) {
      key = `disk|${ref.path}`;
    } else {
      key = `sqlite|${ref.documentId}`;
    }

    if (!groups.has(key)) groups.set(key, { refs: [], context });
    groups.get(key)!.refs.push(ref);
  }

  return groups;
}

// ─── 快照生成（按来源） ───────────────────────────────────────────────────────

/** 编辑器来源：直接从内存读取，零 I/O */
function createEditorSnapshots(groups: Map<string, GroupEntry>): ChatReferenceSnapshot[] {
  const snapshots: ChatReferenceSnapshot[] = [];

  for (const [key, { refs, context }] of groups) {
    if (!key.startsWith('editor|') || !context) continue;

    const { id, title } = context.document;
    const snapshot = makeSnapshot(id, title, context.document.getContent());
    refs.forEach((r) => (r.snapshotId = snapshot.id));
    snapshots.push(snapshot);
  }

  return snapshots;
}

/** 磁盘来源：并发读取（最多 5 个），失败时降级到 SQLite */
async function createDiskSnapshots(groups: Map<string, GroupEntry>): Promise<ChatReferenceSnapshot[]> {
  const diskEntries = Array.from(groups.entries()).filter(([key]) => key.startsWith('disk|'));
  if (diskEntries.length === 0) return [];

  const limit = pLimit(5);
  const snapshots: ChatReferenceSnapshot[] = [];

  await Promise.all(
    diskEntries.map(([, { refs }]) =>
      limit(async () => {
        try {
          const result = await native.readFile(refs[0].path!);
          const snapshot = makeSnapshot(refs[0].documentId, result.name, result.content);
          refs.forEach((r) => (r.snapshotId = snapshot.id));
          snapshots.push(snapshot);
        } catch {
          await applySnapshotFromSqlite(refs, snapshots);
        }
      })
    )
  );

  return snapshots;
}

/** SQLite 来源：无路径且编辑器未激活时的兜底策略 */
async function createSqliteSnapshots(groups: Map<string, GroupEntry>): Promise<ChatReferenceSnapshot[]> {
  const sqliteEntries = Array.from(groups.entries()).filter(([key]) => key.startsWith('sqlite|'));
  if (sqliteEntries.length === 0) return [];

  const snapshots: ChatReferenceSnapshot[] = [];
  await Promise.all(sqliteEntries.map(([, { refs }]) => applySnapshotFromSqlite(refs, snapshots)));
  return snapshots;
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

/**
 * 为消息中的所有引用持久化文件内容快照。
 *
 * 获取策略（按优先级）：
 * 1. 编辑器已激活 → editorToolContextRegistry 内存读取（零 I/O）
 * 2. 编辑器未激活且有路径 → native.readFile 并发读取（上限 5）
 * 3. 磁盘读取失败 → SQLite 历史快照降级
 * 4. 无路径且编辑器未激活 → SQLite 历史快照降级
 */
export async function persistReferenceSnapshots(message: Message): Promise<void> {
  const references = collectReferences(message);
  if (!references.length) return;

  const groups = buildGroups(references);

  const [diskSnapshots, sqliteSnapshots] = await Promise.all([createDiskSnapshots(groups), createSqliteSnapshots(groups)]);

  const snapshots = [...createEditorSnapshots(groups), ...diskSnapshots, ...sqliteSnapshots];

  if (snapshots.length > 0) {
    await chatStorage.upsertReferenceSnapshots(snapshots);
  }
}
