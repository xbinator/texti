/**
 * @file agentArtifact.ts
 * @description Child Agent 用户 artifact 的闭集 opener 与稳定引用校验。
 */
import type { ChatAgentTaskArtifactSnapshot } from 'types/chat-agent';
import router from '@/router';

/** 不可打开 artifact 的稳定机器错误。 */
const ARTIFACT_NOT_OPENABLE = 'agent_artifact_not_openable';
/** 文档稳定身份最大字符数。 */
const DOCUMENT_ID_MAX_LENGTH = 160;
/** 产品稳定文档身份的正向字符闭集。 */
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** 注册 opener 的最小接口。 */
export interface AgentArtifactOpener {
  /** opener 对应的闭集 kind。 */
  readonly kind: string;
  /**
   * 打开一个已经校验的稳定引用。
   * @param reference - 稳定 artifact 引用
   */
  open(reference: string): Promise<void> | void;
}

/**
 * 判断引用是否为非路径文档身份。
 * @param reference - Main 投影中的稳定引用
 * @returns 是否满足文档身份约束
 */
function isDocumentId(reference: string): boolean {
  return reference.length > 0 && reference.length <= DOCUMENT_ID_MAX_LENGTH && reference.trim() === reference && DOCUMENT_ID_PATTERN.test(reference);
}

/** 当前产品已有安全导航能力的 artifact opener 闭集。 */
const ARTIFACT_OPENERS: Readonly<Record<string, AgentArtifactOpener>> = {
  document: {
    kind: 'document',
    open: async (reference: string): Promise<void> => {
      await router.push({
        name: 'editor',
        params: { id: reference }
      });
    }
  }
};

/**
 * 判断 artifact 是否可以通过已注册安全 opener 打开。
 * @param artifact - Renderer 公开 artifact
 * @returns kind 和 reference 是否都受支持
 */
export function canOpenArtifact(artifact: ChatAgentTaskArtifactSnapshot): boolean {
  return artifact.visibility === 'user' && artifact.kind === 'document' && Boolean(ARTIFACT_OPENERS.document) && isDocumentId(artifact.reference);
}

/**
 * 通过闭集 opener 打开用户 artifact。
 * 未知 kind 绝不降级解释为文件路径。
 * @param artifact - Renderer 公开 artifact
 */
export async function openAgentArtifact(artifact: ChatAgentTaskArtifactSnapshot): Promise<void> {
  if (!canOpenArtifact(artifact)) throw new Error(ARTIFACT_NOT_OPENABLE);
  await ARTIFACT_OPENERS.document?.open(artifact.reference);
}
