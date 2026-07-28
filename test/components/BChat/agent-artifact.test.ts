/**
 * @file agent-artifact.test.ts
 * @description Child Agent artifact 闭集 opener 与稳定文档身份校验测试。
 * @vitest-environment jsdom
 */
import type { ChatAgentTaskArtifactSnapshot } from 'types/chat-agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canOpenArtifact, openAgentArtifact } from '@/components/BChat/utils/agentArtifact';

/** Router 导航测试边界。 */
const routerAPI = vi.hoisted(() => ({
  push: vi.fn()
}));

vi.mock('@/router', () => ({
  default: routerAPI
}));

/**
 * 创建公开 artifact 投影。
 * @param patch - 可覆盖字段
 * @returns 完整 artifact
 */
function createArtifact(patch: Partial<ChatAgentTaskArtifactSnapshot> = {}): ChatAgentTaskArtifactSnapshot {
  return {
    artifactId: 'artifact-1',
    kind: 'document',
    reference: 'document-1',
    owner: {
      taskId: 'task-1',
      agentId: 'agent-1',
      attemptId: 'attempt-1'
    },
    visibility: 'user',
    createdAt: '2026-07-28T00:00:00.000Z',
    ...patch
  };
}

describe('agent artifact registry', (): void => {
  beforeEach((): void => {
    routerAPI.push.mockReset();
    routerAPI.push.mockResolvedValue(undefined);
  });

  it('opens only a registered document kind through the named editor route', async (): Promise<void> => {
    const artifact = createArtifact();

    expect(canOpenArtifact(artifact)).toBe(true);
    await openAgentArtifact(artifact);

    expect(routerAPI.push).toHaveBeenCalledWith({
      name: 'editor',
      params: { id: 'document-1' }
    });
  });

  it.each([
    createArtifact({ kind: 'file' }),
    createArtifact({ kind: 'report' }),
    createArtifact({ reference: '' }),
    createArtifact({ reference: ' document-1' }),
    createArtifact({ reference: 'document/1' }),
    createArtifact({ reference: 'document\\1' }),
    createArtifact({ reference: 'document\n1' }),
    createArtifact({ reference: '.' }),
    createArtifact({ reference: '..' }),
    createArtifact({ reference: 'document?query' }),
    createArtifact({ reference: 'document#fragment' }),
    createArtifact({ reference: 'document%2Fchild' }),
    createArtifact({ reference: 'x'.repeat(161) })
  ])('rejects unknown kinds and path-like or malformed references', async (artifact): Promise<void> => {
    expect(canOpenArtifact(artifact)).toBe(false);
    await expect(openAgentArtifact(artifact)).rejects.toThrow('agent_artifact_not_openable');
    expect(routerAPI.push).not.toHaveBeenCalled();
  });
});
