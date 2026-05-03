/**
 * @file referenceResolver.ts
 * @description 从聊天消息中解析文件引用对应的可读内容。
 */
import type { Message } from './types';
import type { AIToolContext } from 'types/ai';
import type { ChatMessageFileReferencePart } from 'types/chat';
import type { ResolvedReferenceSnapshot } from '@/ai/tools/builtin/read-reference';

/**
 * 文件引用解析依赖。
 */
export interface ResolveReferenceSnapshotDependencies {
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
 * 从当前编辑器上下文构造快照读取结果。
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
 * 从消息历史中解析文件引用对应的内容。
 * 优先级：
 * 1. 当前活动编辑器的实时内容
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

  const editorContext = dependencies.getEditorContext(referencePart.documentId);
  if (editorContext) {
    return buildResolvedSnapshotFromContext(referencePart, editorContext);
  }

  return null;
}
