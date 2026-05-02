/**
 * @file referenceResolver.ts
 * @description 从聊天消息中解析文件引用对应的可读快照内容。
 */
import type { Message } from './types';
import type { AIToolContext } from 'types/ai';
import type { ChatMessageFileReferencePart, ChatReferenceSnapshot } from 'types/chat';
import type { ResolvedReferenceSnapshot } from '@/ai/tools/builtin/read-reference';

/**
 * 文件引用快照解析依赖。
 */
export interface ResolveReferenceSnapshotDependencies {
  /** 按快照 ID 批量读取快照 */
  getSnapshotsByIds: (snapshotIds: string[]) => Promise<ChatReferenceSnapshot[]>;
  /** 按文档 ID 读取最新快照 */
  getLatestSnapshotByDocumentId: (documentId: string) => Promise<ChatReferenceSnapshot | undefined>;
  /** 按文档 ID 获取活动编辑器上下文 */
  getEditorContext: (documentId: string) => AIToolContext | undefined;
}

/**
 * 在消息历史中查找文件引用片段。
 * @param messages - 当前消息列表
 * @param referenceId - 引用 ID
 * @returns 引用片段或 null
 */
function findReferencePart(messages: Message[], referenceId: string): ChatMessageFileReferencePart | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const referencePart = messages[messageIndex].parts.find(
      (part): part is ChatMessageFileReferencePart => part.type === 'file-reference' && part.referenceId === referenceId
    );

    if (referencePart) {
      return referencePart;
    }
  }

  return null;
}

/**
 * 将引用片段与快照内容组装为工具可读结果。
 * @param referencePart - 文件引用片段
 * @param snapshot - 快照内容
 * @returns 已解析的快照结果
 */
function buildResolvedSnapshot(referencePart: ChatMessageFileReferencePart, snapshot: ChatReferenceSnapshot): ResolvedReferenceSnapshot {
  return {
    referenceId: referencePart.referenceId,
    fileName: referencePart.fileName,
    path: referencePart.path,
    documentId: referencePart.documentId,
    snapshotId: snapshot.id,
    content: snapshot.content,
    startLine: referencePart.startLine,
    endLine: referencePart.endLine
  };
}

/**
 * 从当前编辑器上下文构造临时快照读取结果。
 * @param referencePart - 文件引用片段
 * @param context - 编辑器上下文
 * @returns 已解析的快照结果
 */
function buildResolvedSnapshotFromContext(referencePart: ChatMessageFileReferencePart, context: AIToolContext): ResolvedReferenceSnapshot {
  return {
    referenceId: referencePart.referenceId,
    fileName: referencePart.fileName,
    path: referencePart.path,
    documentId: referencePart.documentId,
    snapshotId: referencePart.snapshotId,
    content: context.document.getContent(),
    startLine: referencePart.startLine,
    endLine: referencePart.endLine
  };
}

/**
 * 从消息历史中解析文件引用对应的快照内容。
 * 优先级：
 * 1. referencePart.snapshotId 对应的持久化快照
 * 2. 当前活动编辑器的实时内容（仅在快照缺失时兜底）
 * 3. 同 documentId 的最新历史快照
 * @param messages - 当前消息列表
 * @param referenceId - 引用 ID
 * @param dependencies - 解析依赖
 * @returns 已解析快照或 null
 */
export async function resolveReferenceSnapshotFromMessages(messages: Message[], referenceId: string, dependencies: ResolveReferenceSnapshotDependencies) {
  const referencePart = findReferencePart(messages, referenceId);
  if (!referencePart) {
    return null;
  }

  if (referencePart.snapshotId) {
    const [snapshot] = await dependencies.getSnapshotsByIds([referencePart.snapshotId]);
    if (snapshot) {
      return buildResolvedSnapshot(referencePart, snapshot);
    }
  }

  const editorContext = dependencies.getEditorContext(referencePart.documentId);
  if (editorContext) {
    return buildResolvedSnapshotFromContext(referencePart, editorContext);
  }

  const latestSnapshot = await dependencies.getLatestSnapshotByDocumentId(referencePart.documentId);
  if (latestSnapshot) {
    return buildResolvedSnapshot(referencePart, latestSnapshot);
  }

  return null;
}
