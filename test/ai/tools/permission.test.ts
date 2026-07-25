/**
 * @file permission.test.ts
 * @description AI 工具授权拒绝结果语义测试。
 * @vitest-environment jsdom
 */
import type { AIToolDefinition } from 'types/ai';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIToolConfirmationAdapter, AIToolConfirmationRequest } from '@/ai/tools/confirmation';
import { executeWithPermission } from '@/ai/tools/permission';
import { confirmOrCancel } from '@/ai/tools/shared/fileTool';

/** 测试用写入工具定义。 */
const WRITE_TOOL_DEFINITION: AIToolDefinition = {
  name: 'write_demo',
  description: 'Write demo content',
  source: 'builtin',
  riskLevel: 'write',
  parameters: {
    type: 'object',
    properties: {}
  }
};

/** 测试用确认请求。 */
const CONFIRMATION_REQUEST: AIToolConfirmationRequest = {
  toolName: 'write_demo',
  title: 'AI 想要写入内容',
  description: 'AI 请求执行写入操作。',
  riskLevel: 'write',
  afterText: 'next'
};

describe('tool permission confirmation', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('returns a continuable failure when permission confirmation is denied', async (): Promise<void> => {
    const operation = vi.fn(async (): Promise<string> => 'done');
    const adapter: AIToolConfirmationAdapter = {
      confirm: vi.fn(async (): Promise<{ approved: false }> => ({ approved: false }))
    };

    const result = await executeWithPermission({
      definition: WRITE_TOOL_DEFINITION,
      adapter,
      request: CONFIRMATION_REQUEST,
      operation
    });

    expect(result).toMatchObject({ status: 'failure', error: { code: 'USER_CANCELLED' } });
    expect(operation).not.toHaveBeenCalled();
  });

  it('returns a continuable failure when shared file confirmation is denied', async (): Promise<void> => {
    const adapter: AIToolConfirmationAdapter = {
      confirm: vi.fn(async (): Promise<boolean> => false)
    };

    const result = await confirmOrCancel(adapter, CONFIRMATION_REQUEST, 'write_file');

    expect(result).toMatchObject({ toolName: 'write_file', status: 'failure', error: { code: 'USER_CANCELLED' } });
  });
});
