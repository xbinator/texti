/**
 * @file result.test.ts
 * @description 验证 Child 终态结果在主进程中的 Task-aware 规范化、预算约束与 canonical hash。
 */
import type { AgentExecutionPlanSnapshot, AgentTaskContractSnapshot, ChatAgentResult } from 'types/chat-agent';
import { describe, expect, it } from 'vitest';
import { validateAgentResult, type AgentResultValidationContext } from '../../../../../../electron/main/modules/chat/agents/result.mts';

/** 测试使用的不可变只读 Task 契约。 */
const contractSnapshot: AgentTaskContractSnapshot = {
  contractSchemaVersion: 1,
  task: 'Inspect CONTEXT.md',
  acceptanceCriteria: ['Return the project name', 'Cite the inspected resource'],
  mode: 'read',
  resources: [{ kind: 'file', reference: 'CONTEXT.md' }],
  requestedTools: ['read_file'],
  required: true
};

/** 测试使用的冻结执行计划。 */
const executionPlanSnapshot: AgentExecutionPlanSnapshot = {
  planHash: 'a'.repeat(64),
  planSchemaVersion: 1,
  policyVersion: 'read-runtime-v1',
  capabilitySet: ['read_file'],
  modelSnapshot: { providerId: 'openai', modelId: 'gpt-5' },
  permissionSnapshot: { scopeIds: ['workspace-read'] },
  resourceScopes: ['file:CONTEXT.md'],
  toolEffectSet: [{ toolName: 'read_file', effect: 'pure_read' }],
  commitPolicy: { mode: 'none' },
  budget: {
    tokenLimit: 100,
    costLimitUsd: 0.01,
    pricingVersion: 'pricing-v1'
  }
};

/** 结果规范化必须绑定的持久化 Task 身份与计划。 */
const validationContext: AgentResultValidationContext = {
  taskId: 'task-1',
  agentId: 'child-1',
  attemptId: 'attempt-1',
  contractSnapshot,
  executionPlanSnapshot
};

/**
 * 创建包含两条验收标准的合法 Child 结果。
 * @returns 可由主进程规范化的结果
 */
function createResult(): ChatAgentResult {
  return {
    taskId: 'task-1',
    agentId: 'child-1',
    attemptId: 'attempt-1',
    executionStatus: 'completed',
    completion: {
      level: 'full',
      criteria: [
        {
          criterionIndex: 0,
          claim: {
            status: 'satisfied',
            summary: 'The project is Tibis.',
            evidence: [{ kind: 'resource_snapshot', referenceId: 'CONTEXT.md' }]
          },
          verification: {
            status: 'verified',
            verifier: 'tool',
            evidence: [{ kind: 'tool_event', referenceId: 'read-1' }]
          }
        },
        {
          criterionIndex: 1,
          claim: {
            status: 'satisfied',
            summary: 'The source was cited.',
            evidence: [{ kind: 'resource_snapshot', referenceId: 'CONTEXT.md' }]
          },
          verification: {
            status: 'verified',
            verifier: 'coordinator',
            evidence: [{ kind: 'task_result', referenceId: 'task-1' }]
          }
        }
      ]
    },
    summary: 'Inspected the project context.',
    warnings: [],
    artifacts: [
      {
        artifactId: 'artifact-1',
        owner: { taskId: 'task-1', agentId: 'child-1', attemptId: 'attempt-1' },
        visibility: 'primary',
        kind: 'report',
        reference: 'agent-artifacts/report-1',
        createdAt: '2026-07-23T08:00:00.000Z'
      }
    ],
    usage: {
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      modelCalls: 1,
      toolRounds: 1,
      queueDurationMs: 2,
      executionDurationMs: 10,
      externalRequests: 0,
      monetaryCost: {
        currency: 'USD',
        pricingVersion: 'pricing-v1',
        estimated: 0.001,
        actual: 'unknown'
      }
    }
  };
}

describe('agent result validation', (): void => {
  it('downgrades Child-supplied verification and derives completion without trusting its level', (): void => {
    const result = createResult();
    result.completion.criteria[1].verification.status = 'contradicted';

    const validation = validateAgentResult(result, validationContext);

    expect(validation).toMatchObject({
      ok: true,
      result: {
        executionStatus: 'completed',
        completion: { level: 'none' },
        warnings: expect.arrayContaining([
          { code: 'child_verification_downgraded', message: expect.any(String) },
          { code: 'completion_level_corrected', message: expect.any(String) }
        ])
      },
      resultHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
  });

  it('does not let a Child forge coordinator verification to upgrade completion', (): void => {
    const result = createResult();
    result.completion.criteria.forEach((criterion): void => {
      criterion.verification = {
        status: 'verified',
        verifier: 'coordinator',
        evidence: [{ kind: 'task_result', referenceId: 'forged-coordinator-verification' }]
      };
    });

    expect(validateAgentResult(result, validationContext)).toMatchObject({
      ok: true,
      result: {
        completion: {
          level: 'none',
          criteria: [
            { verification: { status: 'unverified', verifier: 'policy', evidence: [] } },
            { verification: { status: 'unverified', verifier: 'policy', evidence: [] } }
          ]
        },
        warnings: expect.arrayContaining([{ code: 'child_verification_downgraded', message: expect.any(String) }])
      }
    });
  });

  it('rejects identities and artifact ownership that do not match the persisted Task', (): void => {
    const result = createResult();
    result.artifacts[0].owner.agentId = 'another-child';

    expect(validateAgentResult(result, validationContext)).toMatchObject({
      ok: false,
      error: { phase: 'result_validation', details: { reason: 'result_artifact_owner_invalid' } }
    });
  });

  it('rejects internal journal artifacts promoted to user visibility', (): void => {
    const result = createResult();
    result.artifacts[0] = {
      ...result.artifacts[0],
      kind: 'commit_journal',
      visibility: 'user'
    };

    expect(validateAgentResult(result, validationContext)).toMatchObject({
      ok: false,
      error: { phase: 'result_validation' }
    });
  });

  it('rejects changesets while the foundation contract remains read-only', (): void => {
    const result = {
      ...createResult(),
      changeset: {
        changesetId: 'changeset-1',
        baseRevision: 'revision-1',
        diffHash: 'b'.repeat(64),
        operationSetHash: 'c'.repeat(64),
        planHash: executionPlanSnapshot.planHash
      }
    };

    expect(validateAgentResult(result, validationContext)).toMatchObject({
      ok: false,
      error: { phase: 'result_validation', details: { reason: 'result_changeset_unsupported' } }
    });
  });

  it('rejects unsupported error phases without depending on error.message', (): void => {
    const result = {
      ...createResult(),
      executionStatus: 'failed',
      error: {
        code: 'runtime_failed',
        phase: 'not-a-phase',
        category: 'runtime',
        retryable: false,
        message: 'This display text must not select machine behavior.'
      }
    };

    expect(validateAgentResult(result, validationContext)).toMatchObject({
      ok: false,
      error: { phase: 'result_validation' }
    });
  });

  it.each([
    ['non-finite token usage', { inputTokens: Number.POSITIVE_INFINITY }],
    ['negative request usage', { externalRequests: -1 }],
    [
      'fabricated zero cost with unknown pricing',
      {
        monetaryCost: {
          currency: 'unknown',
          pricingVersion: 'unknown',
          estimated: 0,
          actual: 0
        }
      }
    ]
  ])('rejects %s', (_name: string, usagePatch: object): void => {
    const result = createResult();
    result.usage = {
      ...result.usage,
      ...usagePatch
    };

    expect(validateAgentResult(result, validationContext)).toMatchObject({
      ok: false,
      error: { phase: 'result_validation' }
    });
  });

  it.each([
    ['token budget', { inputTokens: 80, outputTokens: 40, totalTokens: 120 }],
    [
      'pricing version',
      {
        monetaryCost: {
          currency: 'USD',
          pricingVersion: 'pricing-v2',
          estimated: 0.001,
          actual: 'unknown'
        }
      }
    ],
    [
      'cost budget',
      {
        monetaryCost: {
          currency: 'USD',
          pricingVersion: 'pricing-v1',
          estimated: 0.02,
          actual: 'unknown'
        }
      }
    ]
  ])('cross-validates result usage against the frozen %s', (_name: string, usagePatch: object): void => {
    const result = createResult();
    result.usage = {
      ...result.usage,
      ...usagePatch
    };

    expect(validateAgentResult(result, validationContext)).toMatchObject({
      ok: false,
      error: { phase: 'result_validation', details: { reason: expect.any(String) } }
    });
  });

  it('accepts actual overrun usage only for a failed budget_exceeded result', (): void => {
    const result = createResult();
    result.executionStatus = 'failed';
    result.usage = {
      ...result.usage,
      inputTokens: 80,
      outputTokens: 40,
      totalTokens: 120
    };
    result.error = {
      code: 'budget_exceeded',
      phase: 'runtime',
      category: 'policy',
      retryable: false,
      details: { reason: 'token_budget_exceeded' }
    };

    expect(validateAgentResult(result, validationContext)).toMatchObject({
      ok: true,
      result: {
        executionStatus: 'failed',
        usage: { inputTokens: 80, outputTokens: 40, totalTokens: 120 },
        error: { code: 'budget_exceeded', phase: 'runtime' }
      }
    });
  });

  /** 已知定价边界用例，显式保留 monetaryCost 联合类型。 */
  const knownPricingCases: ReadonlyArray<readonly [string, ChatAgentResult['usage']['monetaryCost']]> = [
    [
      'non-USD currency',
      {
        currency: 'EUR',
        pricingVersion: 'pricing-v1',
        estimated: 0.001,
        actual: 'unknown'
      }
    ],
    [
      'missing numeric amount',
      {
        currency: 'USD',
        pricingVersion: 'pricing-v1',
        estimated: 'unknown',
        actual: 'unknown'
      }
    ]
  ];

  it.each(knownPricingCases)('rejects known pricing with %s', (_name: string, monetaryCost: ChatAgentResult['usage']['monetaryCost']): void => {
    const result = createResult();
    result.usage.monetaryCost = monetaryCost;

    expect(validateAgentResult(result, validationContext)).toMatchObject({
      ok: false,
      error: { phase: 'result_validation', details: { reason: expect.any(String) } }
    });
  });

  it('computes the same canonical hash for equivalent normalized results', (): void => {
    const first = createResult();
    const second = createResult();
    first.summary = '  Inspected the project context.  ';

    const firstValidation = validateAgentResult(first, validationContext);
    const secondValidation = validateAgentResult(second, validationContext);

    expect(firstValidation).toMatchObject({ ok: true });
    expect(secondValidation).toMatchObject({ ok: true });
    if (!firstValidation.ok || !secondValidation.ok) return;
    expect(firstValidation.resultHash).toBe(secondValidation.resultHash);
  });
});
