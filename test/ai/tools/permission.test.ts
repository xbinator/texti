/**
 * @file permission.test.ts
 * @description AI 工具授权拒绝结果语义测试。
 * @vitest-environment jsdom
 */
import type { AIToolDefinition } from 'types/ai';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIToolConfirmationAdapter, AIToolConfirmationRequest } from '@/ai/tools/confirmation';
import * as permissionModule from '@/ai/tools/permission';
import { confirmOrCancel } from '@/ai/tools/shared/fileTool';

/** 保留标准工具结果的权限执行函数。 */
type ExecuteResultPermission = (options: {
  /** 工具定义。 */
  definition: AIToolDefinition;
  /** 确认适配器。 */
  adapter: AIToolConfirmationAdapter;
  /** 确认请求。 */
  request: AIToolConfirmationRequest;
  /** 返回标准工具结果的真实操作。 */
  operation: () => Promise<{ toolName: string; status: 'success'; data: { value: string } }>;
}) => Promise<unknown>;

/**
 * 读取待实现的标准结果权限执行函数。
 * @returns 权限执行函数，尚未实现时为 undefined
 */
function getResultExecutor(): ExecuteResultPermission | undefined {
  const exports = permissionModule as unknown as { executeResultWithPermission?: ExecuteResultPermission };
  return exports.executeResultWithPermission;
}

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

    const result = await permissionModule.executeWithPermission({
      definition: WRITE_TOOL_DEFINITION,
      adapter,
      request: CONFIRMATION_REQUEST,
      operation
    });

    expect(result).toMatchObject({ status: 'failure', error: { code: 'USER_CANCELLED' } });
    expect(operation).not.toHaveBeenCalled();
  });

  it('preserves a standard page tool result after permission succeeds', async (): Promise<void> => {
    const executeResult = getResultExecutor();
    expect(executeResult).toBeTypeOf('function');
    if (!executeResult) return;
    const pageResult = { toolName: 'write_demo', status: 'success' as const, data: { value: 'done' } };
    const operation = vi.fn(async () => pageResult);
    const adapter: AIToolConfirmationAdapter = {
      confirm: vi.fn(async (): Promise<{ approved: true }> => ({ approved: true }))
    };

    const result = await executeResult({
      definition: WRITE_TOOL_DEFINITION,
      adapter,
      request: CONFIRMATION_REQUEST,
      operation
    });

    expect(result).toBe(pageResult);
    expect(operation).toHaveBeenCalledOnce();
  });

  it('does not execute a standard page tool when permission is denied', async (): Promise<void> => {
    const executeResult = getResultExecutor();
    expect(executeResult).toBeTypeOf('function');
    if (!executeResult) return;
    const operation = vi.fn(async () => ({ toolName: 'write_demo', status: 'success' as const, data: { value: 'unsafe' } }));
    const adapter: AIToolConfirmationAdapter = {
      confirm: vi.fn(async (): Promise<{ approved: false }> => ({ approved: false }))
    };

    const result = await executeResult({
      definition: WRITE_TOOL_DEFINITION,
      adapter,
      request: CONFIRMATION_REQUEST,
      operation
    });

    expect(result).toMatchObject({ status: 'failure', error: { code: 'USER_CANCELLED' } });
    expect(operation).not.toHaveBeenCalled();
  });

  it('preserves a stable error code thrown by a page tool operation', async (): Promise<void> => {
    const executeResult = getResultExecutor();
    expect(executeResult).toBeTypeOf('function');
    if (!executeResult) return;
    const operation = vi.fn(async (): Promise<never> => {
      throw Object.assign(new Error('网页快照已过期'), { code: 'STALE_SNAPSHOT' as const });
    });
    const adapter: AIToolConfirmationAdapter = {
      confirm: vi.fn(async (): Promise<{ approved: true }> => ({ approved: true }))
    };

    const result = await executeResult({
      definition: WRITE_TOOL_DEFINITION,
      adapter,
      request: CONFIRMATION_REQUEST,
      operation
    });

    expect(result).toMatchObject({ status: 'failure', error: { code: 'STALE_SNAPSHOT', message: '网页快照已过期' } });
  });

  it('remembers an approved page write without making it auto-safe by default', async (): Promise<void> => {
    const executeResult = getResultExecutor();
    expect(executeResult).toBeTypeOf('function');
    if (!executeResult) return;
    const definition: AIToolDefinition = {
      ...WRITE_TOOL_DEFINITION,
      safeAutoApprove: false,
      allowPermissionRemember: true
    };
    const operation = vi.fn(async () => ({ toolName: 'write_demo', status: 'success' as const, data: { value: 'done' } }));
    const adapter: AIToolConfirmationAdapter = {
      confirm: vi.fn(async (request: AIToolConfirmationRequest): Promise<{ approved: true; grantScope: 'session' }> => {
        expect(request.allowRemember).toBe(true);
        return { approved: true, grantScope: 'session' };
      })
    };
    const request = { ...CONFIRMATION_REQUEST, allowRemember: true };

    await executeResult({ definition, adapter, request, operation });
    await executeResult({ definition, adapter, request, operation });

    expect(adapter.confirm).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('returns a continuable failure when shared file confirmation is denied', async (): Promise<void> => {
    const adapter: AIToolConfirmationAdapter = {
      confirm: vi.fn(async (): Promise<boolean> => false)
    };

    const result = await confirmOrCancel(adapter, CONFIRMATION_REQUEST, 'write_file');

    expect(result).toMatchObject({ toolName: 'write_file', status: 'failure', error: { code: 'USER_CANCELLED' } });
  });
});
