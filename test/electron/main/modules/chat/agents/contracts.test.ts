/**
 * @file contracts.test.ts
 * @description 验证基础委派契约的收缩式校验、规范化与不可变哈希。
 */
import type { AgentDelegationContinuationSnapshot, AgentExecutionPlanSnapshot, ChatAgentEvent, ChatAgentResult, DelegateTaskInput } from 'types/chat-agent';
import { describe, expect, it } from 'vitest';
import * as agentContracts from '../../../../../../electron/main/modules/chat/agents/contracts.mts';
import {
  AGENT_CANONICAL_PAYLOAD_MAX_BYTES,
  AGENT_MAX_ACCEPTANCE_CRITERIA,
  AGENT_MAX_REQUESTED_TOOLS,
  AGENT_MAX_RESOURCES,
  hashAgentPayload,
  hashContinuationSnapshot,
  hashExecutionPlanSnapshot,
  normalizeAgentIdentity,
  validateAgentTaskError,
  validateChatAgentEvent,
  validateChatAgentResult,
  validateContinuationSnapshot,
  validateExecutionPlanSnapshot,
  validateFoundationContract,
  validateFoundationOutbox
} from '../../../../../../electron/main/modules/chat/agents/contracts.mts';

/** Task 2 期望新增的 write snapshot 契约模块视图。 */
type WriteSnapshotContracts = typeof agentContracts & {
  /** 校验并冻结 changeset snapshot。 */
  validateChangesetSnapshot?: (input: unknown, expectedHash: string) => { ok: boolean; changeset?: unknown };
  /** 校验并冻结 confirmation request snapshot。 */
  validateConfirmationRequestSnapshot?: (input: unknown, expectedHash: string) => { ok: boolean; request?: unknown };
  /** 校验并冻结 commit intent snapshot。 */
  validateCommitIntentSnapshot?: (input: unknown, expectedHash: string) => { ok: boolean; intent?: unknown };
};

/** 可被基础阶段接受的最小只读委派契约。 */
const validContract: DelegateTaskInput = {
  task: 'Inspect one runtime file',
  acceptanceCriteria: ['Report the lock owner'],
  mode: 'read',
  resources: [{ kind: 'file', reference: 'electron/main/modules/chat/runtime/service.mts' }],
  requestedTools: ['read_file'],
  required: true,
  priority: 'normal'
};

/** 符合批准设计的完整结构化结果。 */
const validResult: ChatAgentResult = {
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
          summary: 'The project name is Tibis.',
          evidence: [{ kind: 'resource_snapshot', referenceId: 'snapshot-1', contentHash: 'a'.repeat(64) }]
        },
        verification: {
          status: 'verified',
          verifier: 'tool',
          evidence: [{ kind: 'tool_event', referenceId: 'event-1', contentHash: 'b'.repeat(64) }]
        }
      }
    ]
  },
  summary: 'Read the project name.',
  warnings: [],
  artifacts: [
    {
      artifactId: 'artifact-1',
      kind: 'report',
      reference: 'agent-artifacts/report-1',
      contentHash: 'c'.repeat(64),
      owner: { taskId: 'task-1', agentId: 'child-1', attemptId: 'attempt-1' },
      visibility: 'primary',
      createdAt: '2026-07-23T08:00:00.000Z'
    }
  ],
  usage: {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    modelCalls: 1,
    toolRounds: 1,
    queueDurationMs: 4,
    executionDurationMs: 20,
    externalRequests: 0,
    monetaryCost: {
      currency: 'USD',
      pricingVersion: 'unknown',
      estimated: 'unknown',
      actual: 'unknown'
    }
  }
};

/**
 * 创建与基础契约绑定的只读执行计划。
 * @param contract - 已规范化基础契约
 * @returns 带 contract-bound hash 的计划快照
 */
function createExecutionPlan(contract: DelegateTaskInput): AgentExecutionPlanSnapshot {
  const validation = validateFoundationContract(contract);
  if (!validation.ok) throw new Error('Fixture contract must be valid');
  const body = {
    planSchemaVersion: 1,
    policyVersion: 'read-runtime-v1',
    capabilitySet: ['read_file'],
    modelSnapshot: { providerId: 'openai', modelId: 'gpt-5' },
    permissionSnapshot: { scopeIds: ['workspace-read'] },
    resourceScopes: ['file:CONTEXT.md'],
    toolEffectSet: [{ toolName: 'read_file', effect: 'pure_read' as const }],
    commitPolicy: { mode: 'none' as const },
    budget: { tokenLimit: 1000, costLimitUsd: 0.1, pricingVersion: 'test-v1' }
  };

  return {
    ...body,
    planHash: hashExecutionPlanSnapshot(validation.contractSnapshot, body)
  };
}

/**
 * 创建与写入契约绑定的暂存执行计划。
 * @param contract - 已规范化写入契约
 * @returns 带 contract-bound hash 的暂存计划快照
 */
function createWritePlan(contract: DelegateTaskInput): AgentExecutionPlanSnapshot {
  const validation = validateFoundationContract(contract);
  if (!validation.ok) throw new Error('Fixture write contract must be valid');
  const body = {
    planSchemaVersion: 1,
    policyVersion: 'controlled-write-v1',
    capabilitySet: ['read_file', 'stage_file_edit'],
    modelSnapshot: { providerId: 'openai', modelId: 'gpt-5' },
    permissionSnapshot: { scopeIds: ['workspace-write'] },
    resourceScopes: ['file:CONTEXT.md'],
    toolEffectSet: [
      { toolName: 'read_file', effect: 'pure_read' as const },
      { toolName: 'stage_file_edit', effect: 'staged_file_write' as const }
    ],
    commitPolicy: { mode: 'staged' as const, adapter: 'atomic-file-v1' },
    budget: { tokenLimit: 1000, costLimitUsd: 0.1, pricingVersion: 'test-v1' }
  };

  return {
    ...body,
    planHash: hashExecutionPlanSnapshot(validation.contractSnapshot, body)
  };
}

/**
 * 创建合法的 Runtime A 续接快照。
 * @returns 可验证 hash 的续接快照
 */
function createContinuation(): AgentDelegationContinuationSnapshot {
  return {
    checkpointSchemaVersion: 1,
    policyVersion: 'foundation-v1',
    modelSnapshot: { providerId: 'openai', modelId: 'gpt-5' },
    continuationContextReference: 'continuation-1',
    continuationContextHash: 'b'.repeat(64),
    sourceMessageRevision: 'revision-1',
    toolSchemaSnapshotHash: 'c'.repeat(64),
    orderedToolCalls: [
      {
        toolCallId: 'tool-call-1',
        taskId: 'task-1',
        required: true,
        argumentsHash: 'd'.repeat(64),
        providerMetadataHash: 'e'.repeat(64)
      }
    ],
    reservedResumeBudget: { tokenLimit: 500, costLimitUsd: 0.05, pricingVersion: 'test-v1' },
    absoluteTurnDeadline: '2026-07-23T09:00:00.000Z'
  };
}

describe('foundation delegation contract', (): void => {
  it('normalizes a bounded read contract without widening requested resources', (): void => {
    const result = validateFoundationContract({
      ...validContract,
      task: '  Inspect one runtime file  ',
      requestedTools: ['grep', 'read_file']
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.contract).toMatchObject({
      task: 'Inspect one runtime file',
      requestedTools: ['grep', 'read_file']
    });
    expect(result.contractSnapshot.resources).toEqual(validContract.resources);
    expect(Object.isFrozen(result.contract)).toBe(true);
    expect(Object.isFrozen(result.contract.resources)).toBe(true);
    expect(result.contractSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ['empty criteria', { acceptanceCriteria: [] }],
    ['empty resources', { resources: [] }],
    ['delegate recursion', { requestedTools: ['delegate_task'] }]
  ])('rejects %s in the foundation phase', (_name: string, patch: object): void => {
    expect(validateFoundationContract({ ...validContract, ...patch })).toMatchObject({
      ok: false,
      error: { phase: 'contract_validation', retryable: false }
    });
  });

  it('accepts a bounded write contract with an explicit staged capability', (): void => {
    const result = validateFoundationContract({
      ...validContract,
      mode: 'write',
      requestedTools: ['read_file', 'stage_file_edit']
    });

    expect(result).toMatchObject({
      ok: true,
      contractSnapshot: {
        mode: 'write',
        requestedTools: ['read_file', 'stage_file_edit']
      }
    });
  });

  it('rejects write contracts without a file or directory resource scope', (): void => {
    expect(
      validateFoundationContract({
        ...validContract,
        mode: 'write',
        resources: [{ kind: 'webview', reference: 'active-webview' }],
        requestedTools: ['stage_file_edit']
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: 'invalid_contract',
        phase: 'contract_validation',
        details: { reason: 'write_resource_scope_invalid' }
      }
    });
  });

  it('rejects invalid deadlines, unknown keys, and duplicate requested tools', (): void => {
    expect(validateFoundationContract({ ...validContract, deadlineAt: 'tomorrow' })).toMatchObject({ ok: false });
    expect(validateFoundationContract({ ...validContract, secret: 'must-not-persist' })).toMatchObject({ ok: false });
    expect(validateFoundationContract({ ...validContract, requestedTools: ['read_file', 'read_file'] })).toMatchObject({ ok: false });
    expect(
      validateFoundationContract({
        ...validContract,
        resources: [{ kind: 'file', reference: 'CONTEXT.md', authorization: 'Bearer secret' }]
      })
    ).toMatchObject({ ok: false });
  });

  it('preserves ordered fields while canonicalizing only set-like tool names', (): void => {
    const result = validateFoundationContract({
      ...validContract,
      acceptanceCriteria: ['Second visible check', 'First visible check'],
      resources: [
        { kind: 'file', reference: 'second.ts' },
        { kind: 'file', reference: 'first.ts' }
      ],
      requestedTools: ['read_file', 'grep']
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.contract.acceptanceCriteria).toEqual(['Second visible check', 'First visible check']);
    expect(result.contract.resources.map((resource): string => resource.reference)).toEqual(['second.ts', 'first.ts']);
    expect(result.contract.requestedTools).toEqual(['grep', 'read_file']);
  });

  it.each([
    ['task', { task: 'Inspect Authorization: Bearer contract-bearer-secret' }],
    ['task Basic header', { task: 'Inspect Authorization: Basic contract-basic-secret' }],
    ['acceptance criterion', { acceptanceCriteria: ['Report api_key=contract-api-secret'] }],
    ['acceptance Proxy header', { acceptanceCriteria: ['Report Proxy-Authorization: Bearer contract-proxy-secret'] }],
    ['resource reference', { resources: [{ kind: 'file', reference: 'CONTEXT.md?access_token=resource-secret' }] }],
    ['resource Cookie header', { resources: [{ kind: 'resource', reference: 'Cookie: session=resource-cookie-secret' }] }],
    ['resource revision', { resources: [{ kind: 'file', reference: 'CONTEXT.md', revision: 'DB_PASSWORD=revision-secret' }] }],
    ['resource JSON revision', { resources: [{ kind: 'file', reference: 'CONTEXT.md', revision: '"apiKey": "revision-json-secret"' }] }],
    ['tool provider error', { requestedTools: ['read_file', 'clientSecret: tool-provider-secret'] }],
    ['tool identity', { requestedTools: ['read_file', 'lookup_apiKey=tool-secret'] }]
  ])('rejects secret-shaped values in the immutable %s layer', (_name: string, patch: object): void => {
    expect(validateFoundationContract({ ...validContract, ...patch })).toMatchObject({
      ok: false,
      error: { phase: 'contract_validation', retryable: false }
    });
  });

  it('does not reject ordinary authorization terminology without a credential value', (): void => {
    expect(
      validateFoundationContract({
        ...validContract,
        task: 'Explain the authorization flow'
      })
    ).toMatchObject({ ok: true });
  });

  it('exports the bounded identity normalizer for Store ingress', (): void => {
    expect(normalizeAgentIdentity('  runtime-1  ')).toBe('runtime-1');
    expect(normalizeAgentIdentity('x'.repeat(4001))).toBeNull();
    expect(normalizeAgentIdentity('Authorization: Basic exported-secret')).toBeNull();
  });

  it('creates stable hashes for equivalent structured-clone-safe payloads', (): void => {
    const first = hashAgentPayload({ second: ['b', 'a'], first: { value: 1 } });
    const second = hashAgentPayload({ first: { value: 1 }, second: ['b', 'a'] });

    expect(first).toBe(second);
    expect((): string => hashAgentPayload({ unsafe: (): void => undefined })).toThrowError(/structured-clone-safe/i);
  });

  it('rejects contracts and canonical payloads that exceed explicit bounds', (): void => {
    expect(
      validateFoundationContract({
        ...validContract,
        acceptanceCriteria: Array.from({ length: AGENT_MAX_ACCEPTANCE_CRITERIA + 1 }, (_value, index): string => `criterion-${index}`)
      })
    ).toMatchObject({ ok: false });
    expect(
      validateFoundationContract({
        ...validContract,
        resources: Array.from({ length: AGENT_MAX_RESOURCES + 1 }, (_value, index): { kind: 'file'; reference: string } => ({
          kind: 'file',
          reference: `file-${index}.ts`
        }))
      })
    ).toMatchObject({ ok: false });
    expect(
      validateFoundationContract({
        ...validContract,
        requestedTools: Array.from({ length: AGENT_MAX_REQUESTED_TOOLS + 1 }, (_value, index): string => `read-tool-${index}`)
      })
    ).toMatchObject({ ok: false });
    expect((): string => hashAgentPayload({ oversized: 'x'.repeat(AGENT_CANONICAL_PAYLOAD_MAX_BYTES + 1) })).toThrowError(/size limit/i);
  });

  it('validates a contract-bound execution plan and deep-freezes every nested snapshot', (): void => {
    const contractValidation = validateFoundationContract(validContract);
    if (!contractValidation.ok) throw new Error('Fixture contract must be valid');
    const plan = createExecutionPlan(validContract);
    const validation = validateExecutionPlanSnapshot(contractValidation.contractSnapshot, plan);

    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(Object.isFrozen(validation.plan)).toBe(true);
    expect(Object.isFrozen(validation.plan.capabilitySet)).toBe(true);
    expect(Object.isFrozen(validation.plan.modelSnapshot)).toBe(true);
  });

  it('validates staged write plans and rejects effect or adapter mismatches', (): void => {
    const contract: DelegateTaskInput = {
      ...validContract,
      mode: 'write',
      requestedTools: ['read_file', 'stage_file_edit']
    };
    const contractValidation = validateFoundationContract(contract);
    if (!contractValidation.ok) throw new Error('Fixture write contract must be valid');
    const plan = createWritePlan(contract);
    const missingAdapter = {
      ...plan,
      commitPolicy: { mode: 'staged' as const }
    };
    const unknownAdapter = {
      ...plan,
      commitPolicy: { mode: 'staged' as const, adapter: 'unknown-adapter' }
    };
    const noStagedEffect = {
      ...plan,
      toolEffectSet: [
        { toolName: 'read_file', effect: 'pure_read' as const },
        { toolName: 'stage_file_edit', effect: 'pure_read' as const }
      ]
    };

    expect(validateExecutionPlanSnapshot(contractValidation.contractSnapshot, plan)).toMatchObject({ ok: true });
    expect(validateExecutionPlanSnapshot(contractValidation.contractSnapshot, missingAdapter)).toMatchObject({
      ok: false,
      error: { details: { reason: 'plan_commit_policy_invalid' } }
    });
    expect(validateExecutionPlanSnapshot(contractValidation.contractSnapshot, unknownAdapter)).toMatchObject({
      ok: false,
      error: { details: { reason: 'plan_commit_policy_invalid' } }
    });
    expect(validateExecutionPlanSnapshot(contractValidation.contractSnapshot, noStagedEffect)).toMatchObject({
      ok: false,
      error: { details: { reason: 'plan_effect_invalid' } }
    });
  });

  it('validates immutable write snapshots and rejects hash-bound mutations', (): void => {
    const writeContracts = agentContracts as WriteSnapshotContracts;
    expect(typeof writeContracts.validateChangesetSnapshot).toBe('function');
    expect(typeof writeContracts.validateConfirmationRequestSnapshot).toBe('function');
    expect(typeof writeContracts.validateCommitIntentSnapshot).toBe('function');
    if (!writeContracts.validateChangesetSnapshot || !writeContracts.validateConfirmationRequestSnapshot || !writeContracts.validateCommitIntentSnapshot) {
      return;
    }
    const operation = {
      operationId: 'operation-1',
      kind: 'replace' as const,
      displayPath: 'CONTEXT.md',
      targetPath: '/workspace/CONTEXT.md',
      resourceScope: 'file:/workspace/CONTEXT.md',
      baseRevision: '1'.repeat(64),
      baseContentHash: '2'.repeat(64),
      targetContentHash: '3'.repeat(64),
      candidateReference: 'overlay/task-1/attempt-1/candidate-1',
      rollbackReference: 'overlay/task-1/attempt-1/rollback-1',
      byteLength: 12
    };
    const changeset = {
      changesetSchemaVersion: 1,
      changesetId: 'changeset-1',
      taskId: 'task-1',
      attemptId: 'attempt-1',
      agentId: 'child-1',
      runtimeId: 'runtime-1',
      planHash: '4'.repeat(64),
      baseRevision: '5'.repeat(64),
      diffReference: 'overlay/task-1/attempt-1/changes.diff',
      diffHash: '6'.repeat(64),
      operationSetHash: '7'.repeat(64),
      resourceScopes: ['file:/workspace/CONTEXT.md'],
      operations: [operation],
      createdAt: '2026-07-27T08:00:00.000Z'
    };
    const changesetHash = hashAgentPayload({
      schemaVersion: changeset.changesetSchemaVersion,
      changeset
    });
    const request = {
      confirmationSchemaVersion: 1,
      confirmationId: 'confirmation-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      taskId: 'task-1',
      attemptId: 'attempt-1',
      agentId: 'child-1',
      runtimeId: 'runtime-1',
      toolCallId: 'tool-call-1',
      changesetId: 'changeset-1',
      planHash: changeset.planHash,
      baseRevision: changeset.baseRevision,
      diffHash: changeset.diffHash,
      operationSetHash: changeset.operationSetHash,
      resourceScopes: changeset.resourceScopes,
      displayPaths: ['CONTEXT.md'],
      unifiedDiffReference: changeset.diffReference,
      riskLevel: 'write' as const,
      createdAt: '2026-07-27T08:01:00.000Z'
    };
    const requestHash = hashAgentPayload({
      schemaVersion: request.confirmationSchemaVersion,
      request
    });
    const resultDraft = {
      taskId: 'task-1',
      agentId: 'child-1',
      attemptId: 'attempt-1',
      summary: 'Prepared one file update.',
      criteria: validResult.completion.criteria,
      warnings: [],
      usage: validResult.usage
    };
    const intent = {
      journalSchemaVersion: 1,
      changesetSnapshotHash: changesetHash,
      confirmationId: request.confirmationId,
      confirmationVersion: 2,
      planHash: changeset.planHash,
      resultDraft,
      operations: changeset.operations,
      createdAt: '2026-07-27T08:02:00.000Z'
    };
    const intentHash = hashAgentPayload({
      schemaVersion: intent.journalSchemaVersion,
      intent
    });

    expect(writeContracts.validateChangesetSnapshot(changeset, changesetHash)).toMatchObject({ ok: true });
    expect(writeContracts.validateConfirmationRequestSnapshot(request, requestHash)).toMatchObject({ ok: true });
    expect(writeContracts.validateCommitIntentSnapshot(intent, intentHash)).toMatchObject({ ok: true });
    expect(writeContracts.validateChangesetSnapshot({ ...changeset, diffHash: '8'.repeat(64) }, changesetHash)).toMatchObject({ ok: false });
    expect(writeContracts.validateConfirmationRequestSnapshot({ ...request, operationSetHash: '8'.repeat(64) }, requestHash)).toMatchObject({ ok: false });
    expect(writeContracts.validateCommitIntentSnapshot({ ...intent, confirmationVersion: 3 }, intentHash)).toMatchObject({ ok: false });
  });

  it('rejects forged, unsupported, or capability-expanding execution plans', (): void => {
    const contractValidation = validateFoundationContract(validContract);
    if (!contractValidation.ok) throw new Error('Fixture contract must be valid');
    const plan = createExecutionPlan(validContract);
    const expandedBody = {
      ...plan,
      capabilitySet: ['read_file', 'write_file']
    };
    const expandedPlan = {
      ...expandedBody,
      planHash: hashExecutionPlanSnapshot(contractValidation.contractSnapshot, expandedBody)
    };
    const externalBody = {
      ...plan,
      toolEffectSet: [{ toolName: 'read_file', effect: 'external_read' as const }]
    };
    const externalPlan = {
      ...externalBody,
      planHash: hashExecutionPlanSnapshot(contractValidation.contractSnapshot, externalBody)
    };

    expect(validateExecutionPlanSnapshot(contractValidation.contractSnapshot, { ...plan, planHash: 'f'.repeat(64) })).toMatchObject({
      ok: false
    });
    expect(
      validateExecutionPlanSnapshot(contractValidation.contractSnapshot, {
        ...plan,
        planSchemaVersion: 999
      })
    ).toMatchObject({ ok: false });
    expect(validateExecutionPlanSnapshot(contractValidation.contractSnapshot, expandedPlan)).toMatchObject({ ok: false });
    expect(validateExecutionPlanSnapshot(contractValidation.contractSnapshot, { ...plan, policyVersion: 'foundation-v1' })).toMatchObject({ ok: false });
    expect(validateExecutionPlanSnapshot(contractValidation.contractSnapshot, externalPlan)).toMatchObject({ ok: false });
    expect(
      validateExecutionPlanSnapshot(contractValidation.contractSnapshot, {
        ...plan,
        permissionSnapshot: { scopeIds: [] }
      })
    ).toMatchObject({ ok: false });
  });

  it('rejects secret-shaped model and continuation identities even when their hashes are recomputed', (): void => {
    const contractValidation = validateFoundationContract(validContract);
    if (!contractValidation.ok) throw new Error('Fixture contract must be valid');
    const plan = createExecutionPlan(validContract);
    const secretPlanBody = {
      ...plan,
      modelSnapshot: {
        providerId: 'provider_apiKey=provider-secret',
        modelId: 'gpt-5'
      }
    };
    const secretPlan = {
      ...secretPlanBody,
      planHash: hashExecutionPlanSnapshot(contractValidation.contractSnapshot, secretPlanBody)
    };
    const continuation = {
      ...createContinuation(),
      continuationContextReference: `continuation-sk-${'a'.repeat(24)}`
    };

    expect(validateExecutionPlanSnapshot(contractValidation.contractSnapshot, secretPlan)).toMatchObject({ ok: false });
    expect(validateContinuationSnapshot(continuation, hashContinuationSnapshot(continuation))).toMatchObject({ ok: false });
  });

  it('rejects secret-shaped model, agent, runtime, and Outbox opaque identities', (): void => {
    const payload = {
      checkpointId: 'checkpoint-1',
      sessionId: 'Cookie: session=outbox-identity-secret',
      turnId: 'turn-1'
    };

    expect(validateChatAgentResult({ ...validResult, agentId: '"apiKey": "agent-identity-secret"' })).toMatchObject({ ok: false });
    expect(
      validateChatAgentEvent({
        eventId: 'event-runtime-identity',
        aggregate: { kind: 'task', id: 'task-1' },
        taskId: 'task-1',
        runtimeId: 'clientSecret: runtime-identity-secret',
        sequence: 1,
        type: 'task.completed',
        occurredAt: '2026-07-23T08:00:00.000Z',
        source: 'runtime',
        schemaVersion: 1,
        payload: { resultHash: 'a'.repeat(64) }
      })
    ).toMatchObject({ ok: false });
    expect(
      validateFoundationOutbox({
        eventType: 'delegation.created',
        schemaVersion: 1,
        payload,
        payloadHash: hashAgentPayload(payload)
      })
    ).toMatchObject({ ok: false });
  });

  it('validates and deep-freezes a versioned continuation snapshot with its hash', (): void => {
    const continuation = createContinuation();
    const continuationHash = hashContinuationSnapshot(continuation);
    const validation = validateContinuationSnapshot(continuation, continuationHash);

    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(Object.isFrozen(validation.continuation)).toBe(true);
    expect(Object.isFrozen(validation.continuation.orderedToolCalls)).toBe(true);
    expect(validateContinuationSnapshot(continuation, 'f'.repeat(64))).toMatchObject({ ok: false });
    expect(
      validateContinuationSnapshot(
        {
          ...continuation,
          orderedToolCalls: []
        },
        hashContinuationSnapshot({ ...continuation, orderedToolCalls: [] })
      )
    ).toMatchObject({ ok: false });
  });

  it('validates discriminated task and checkpoint events without accepting aggregate mismatch', (): void => {
    const checkpointEvent: ChatAgentEvent<'primary.suspended'> = {
      eventId: 'event-1',
      aggregate: { kind: 'checkpoint', id: 'checkpoint-1' },
      checkpointId: 'checkpoint-1',
      sequence: 2,
      type: 'primary.suspended',
      occurredAt: '2026-07-23T08:00:00.000Z',
      source: 'primary',
      schemaVersion: 1,
      payload: { sourceRuntimeId: 'runtime-a' }
    };

    expect(validateChatAgentEvent(checkpointEvent)).toMatchObject({ ok: true });
    expect(
      validateChatAgentEvent({
        ...checkpointEvent,
        aggregate: { kind: 'task', id: 'task-1' },
        taskId: 'task-1'
      })
    ).toMatchObject({ ok: false });
  });

  it.each([
    [
      'delegation.cancel_requested',
      {
        eventId: 'event-cancel',
        aggregate: { kind: 'checkpoint', id: 'checkpoint-1' },
        checkpointId: 'checkpoint-1',
        sequence: 1,
        type: 'delegation.cancel_requested',
        occurredAt: '2026-07-23T08:00:00.000Z',
        source: 'user',
        schemaVersion: 1,
        payload: { reason: 'Authorization: Bearer cancel-event-secret' }
      },
      'cancel-event-secret'
    ],
    [
      'task.tombstoned',
      {
        eventId: 'event-tombstone',
        aggregate: { kind: 'task', id: 'task-1' },
        taskId: 'task-1',
        sequence: 2,
        type: 'task.tombstoned',
        occurredAt: '2026-07-23T08:00:00.000Z',
        source: 'system',
        schemaVersion: 1,
        payload: { reason: 'refresh_token=tombstone-event-secret' }
      },
      'tombstone-event-secret'
    ],
    [
      'runtime.replaced',
      {
        eventId: 'event-runtime',
        aggregate: { kind: 'task', id: 'task-1' },
        taskId: 'task-1',
        sequence: 3,
        type: 'runtime.replaced',
        occurredAt: '2026-07-23T08:00:00.000Z',
        source: 'coordinator',
        schemaVersion: 1,
        payload: {
          previousRuntimeId: 'runtime-a',
          nextRuntimeId: 'runtime-b',
          reason: 'CLIENT_SECRET=runtime-event-secret'
        }
      },
      'runtime-event-secret'
    ]
  ])('redacts the display reason before persisting %s', (_name: string, event: object, rawSecret: string): void => {
    const validation = validateChatAgentEvent(event);

    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(validation.event.payload).toMatchObject({ reason: '[REDACTED]' });
    expect(JSON.stringify(validation.event)).not.toContain(rawSecret);
  });

  it('binds event hashes to the redacted value instead of the raw secret', (): void => {
    const rawEvent = {
      eventId: 'event-hash',
      aggregate: { kind: 'checkpoint', id: 'checkpoint-1' },
      checkpointId: 'checkpoint-1',
      sequence: 4,
      type: 'delegation.cancel_requested',
      occurredAt: '2026-07-23T08:00:00.000Z',
      source: 'user',
      schemaVersion: 1,
      payload: { reason: 'api_key=hash-binding-secret' }
    };
    const redactedEvent = {
      ...rawEvent,
      payload: { reason: '[REDACTED]' }
    };
    const rawValidation = validateChatAgentEvent(rawEvent);
    const redactedValidation = validateChatAgentEvent(redactedEvent);

    expect(rawValidation.ok).toBe(true);
    expect(redactedValidation.ok).toBe(true);
    if (!rawValidation.ok || !redactedValidation.ok) return;
    expect(hashAgentPayload(rawValidation.event)).toBe(hashAgentPayload(redactedValidation.event));
    expect(hashAgentPayload(rawValidation.event)).not.toBe(hashAgentPayload(rawEvent));
  });

  it.each([
    [
      'delegation.interrupted',
      {
        eventId: 'event-interrupted-secret',
        aggregate: { kind: 'checkpoint', id: 'checkpoint-1' },
        checkpointId: 'checkpoint-1',
        sequence: 5,
        type: 'delegation.interrupted',
        occurredAt: '2026-07-23T08:00:00.000Z',
        source: 'system',
        schemaVersion: 1,
        payload: {
          error: {
            code: 'runtime_interrupted',
            phase: 'recovery',
            category: 'runtime',
            retryable: true,
            message: 'Set-Cookie: session=interrupted-message-secret',
            details: { reason: '"apiKey": "interrupted-detail-secret"' }
          }
        }
      }
    ],
    [
      'task.failed',
      {
        eventId: 'event-failed-secret',
        aggregate: { kind: 'task', id: 'task-1' },
        taskId: 'task-1',
        sequence: 6,
        type: 'task.failed',
        occurredAt: '2026-07-23T08:00:00.000Z',
        source: 'runtime',
        schemaVersion: 1,
        payload: {
          error: {
            code: 'runtime_failed',
            phase: 'runtime',
            category: 'runtime',
            retryable: false,
            message: 'Authorization: Basic failed-message-secret',
            details: { reason: 'accessToken: failed-detail-secret' }
          }
        }
      }
    ]
  ])('persists only normalized nested errors for %s', (_name: string, event: object): void => {
    const validation = validateChatAgentEvent(event);

    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(validation.event.payload).toMatchObject({
      error: {
        message: '[REDACTED]',
        details: { reason: '[REDACTED]' }
      }
    });
    expect(JSON.stringify(validation.event)).not.toMatch(/(?:interrupted|failed)-(?:message|detail)-secret/);
  });

  it('binds nested-error event hashes to normalized values', (): void => {
    const rawEvent = {
      eventId: 'event-nested-hash',
      aggregate: { kind: 'checkpoint', id: 'checkpoint-1' },
      checkpointId: 'checkpoint-1',
      sequence: 7,
      type: 'delegation.interrupted',
      occurredAt: '2026-07-23T08:00:00.000Z',
      source: 'system',
      schemaVersion: 1,
      payload: {
        error: {
          code: 'runtime_interrupted',
          phase: 'recovery',
          category: 'runtime',
          retryable: true,
          message: '"clientSecret": "nested-hash-secret"'
        }
      }
    };
    const redactedEvent = {
      ...rawEvent,
      payload: {
        error: {
          ...rawEvent.payload.error,
          message: '[REDACTED]'
        }
      }
    };
    const rawValidation = validateChatAgentEvent(rawEvent);
    const redactedValidation = validateChatAgentEvent(redactedEvent);

    expect(rawValidation.ok).toBe(true);
    expect(redactedValidation.ok).toBe(true);
    if (!rawValidation.ok || !redactedValidation.ok) return;
    expect(hashAgentPayload(rawValidation.event)).toBe(hashAgentPayload(redactedValidation.event));
    expect(hashAgentPayload(rawValidation.event)).not.toBe(hashAgentPayload(rawEvent));
  });

  it('rejects secret-shaped opaque event identities', (): void => {
    expect(
      validateChatAgentEvent({
        eventId: `event-sk-${'b'.repeat(24)}`,
        aggregate: { kind: 'task', id: 'task-1' },
        taskId: 'task-1',
        sequence: 1,
        type: 'task.completed',
        occurredAt: '2026-07-23T08:00:00.000Z',
        source: 'coordinator',
        schemaVersion: 1,
        payload: { resultHash: 'a'.repeat(64) }
      })
    ).toMatchObject({ ok: false });
  });

  it('accepts only the foundation delegation.created outbox payload allowlist', (): void => {
    const payload = {
      checkpointId: 'checkpoint-1',
      sessionId: 'session-1',
      turnId: 'turn-1'
    };
    const envelope = {
      eventType: 'delegation.created',
      schemaVersion: 1,
      payload,
      payloadHash: hashAgentPayload(payload)
    };

    expect(validateFoundationOutbox(envelope)).toMatchObject({ ok: true });
    expect(
      validateFoundationOutbox({
        ...envelope,
        payload: {
          ...payload,
          metadata: {
            provider: {
              authorization: 'Bearer secret',
              apiKey: 'secret-key',
              environment: 'SECRET=value'
            }
          }
        }
      })
    ).toMatchObject({ ok: false });
  });

  it('accepts the approved result envelope without inventing unknown cost', (): void => {
    const validation = validateChatAgentResult(validResult);

    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(validation.result.completion.criteria[0].verification.status).toBe('verified');
    expect(validation.result.artifacts[0].owner).toEqual({
      taskId: 'task-1',
      agentId: 'child-1',
      attemptId: 'attempt-1'
    });
    expect(validation.result.usage.monetaryCost.actual).toBe('unknown');
    expect(Object.isFrozen(validation.result)).toBe(true);
  });

  it.each([
    ['invalid_contract', { code: 'invalid_contract', phase: 'contract_validation', category: 'protocol', retryable: false }],
    ['capability_denied', { code: 'capability_denied', phase: 'confirmation', category: 'policy', retryable: false }],
    ['resource_scope_invalid', { code: 'resource_scope_invalid', phase: 'commit_validation', category: 'integrity', retryable: false }],
    ['plan_version_unsupported', { code: 'plan_version_unsupported', phase: 'recovery', category: 'protocol', retryable: false }],
    ['deadline_exceeded', { code: 'deadline_exceeded', phase: 'confirmation', category: 'runtime', retryable: false }],
    ['budget_exceeded', { code: 'budget_exceeded', phase: 'commit', category: 'policy', retryable: false }],
    ['runtime_start_failed', { code: 'runtime_start_failed', phase: 'starting', category: 'runtime', retryable: false }],
    ['runtime_failed', { code: 'runtime_failed', phase: 'runtime', category: 'runtime', retryable: false }],
    ['runtime_interrupted', { code: 'runtime_interrupted', phase: 'recovery', category: 'runtime', retryable: true }],
    ['result_evidence_invalid', { code: 'result_evidence_invalid', phase: 'result_validation', category: 'integrity', retryable: false }],
    ['confirmation_denied', { code: 'confirmation_denied', phase: 'confirmation', category: 'user', retryable: false }],
    ['stale_context', { code: 'stale_context', phase: 'commit_validation', category: 'resource', retryable: false }],
    ['commit_failed', { code: 'commit_failed', phase: 'recovery', category: 'integrity', retryable: false }],
    ['manual_recovery_required', { code: 'manual_recovery_required', phase: 'commit', category: 'runtime', retryable: false }],
    ['cancelled', { code: 'cancelled', phase: 'commit', category: 'user', retryable: false }],
    ['protocol_error', { code: 'protocol_error', phase: 'resource_validation', category: 'protocol', retryable: false }]
  ])('accepts the global %s error matrix', (_name: string, error: object): void => {
    expect(validateAgentTaskError(error)).toEqual(error);
  });

  it.each([
    ['invalid_contract', { code: 'invalid_contract', phase: 'plan_validation', category: 'protocol', retryable: false }],
    ['capability_denied', { code: 'capability_denied', phase: 'runtime', category: 'policy', retryable: false }],
    ['resource_scope_invalid', { code: 'resource_scope_invalid', phase: 'resource_validation', category: 'policy', retryable: false }],
    ['plan_version_unsupported', { code: 'plan_version_unsupported', phase: 'recovery', category: 'integrity', retryable: false }],
    ['deadline_exceeded', { code: 'deadline_exceeded', phase: 'recovery', category: 'policy', retryable: false }],
    ['budget_exceeded', { code: 'budget_exceeded', phase: 'runtime', category: 'runtime', retryable: false }],
    ['runtime_start_failed', { code: 'runtime_start_failed', phase: 'runtime', category: 'runtime', retryable: false }],
    ['runtime_failed', { code: 'runtime_failed', phase: 'runtime', category: 'policy', retryable: false }],
    ['runtime_interrupted', { code: 'runtime_interrupted', phase: 'starting', category: 'runtime', retryable: true }],
    ['result_evidence_invalid', { code: 'result_evidence_invalid', phase: 'result_validation', category: 'runtime', retryable: false }],
    ['confirmation_denied', { code: 'confirmation_denied', phase: 'runtime', category: 'user', retryable: false }],
    ['stale_context', { code: 'stale_context', phase: 'commit_validation', category: 'user', retryable: false }],
    ['commit_failed', { code: 'commit_failed', phase: 'runtime', category: 'integrity', retryable: false }],
    ['manual_recovery_required', { code: 'manual_recovery_required', phase: 'recovery', category: 'resource', retryable: false }],
    ['cancelled', { code: 'cancelled', phase: 'queue', category: 'user', retryable: false }],
    ['protocol_error', { code: 'protocol_error', phase: 'runtime', category: 'integrity', retryable: false }]
  ])('rejects the global %s error matrix violation', (_name: string, error: object): void => {
    expect(validateAgentTaskError(error)).toBeNull();
  });

  it.each([
    ['Bearer authorization', 'Authorization: Bearer bearer-display-secret', 'bearer-display-secret'],
    ['Basic authorization', 'Authorization: Basic basic-display-secret', 'basic-display-secret'],
    ['Bearer proxy authorization', 'Proxy-Authorization: Bearer proxy-bearer-display-secret', 'proxy-bearer-display-secret'],
    ['Basic proxy authorization', 'Proxy-Authorization: Basic proxy-basic-display-secret', 'proxy-basic-display-secret'],
    ['Cookie header', 'Cookie: session=cookie-header-display-secret', 'cookie-header-display-secret'],
    ['Set-Cookie header', 'Set-Cookie: session=set-cookie-header-display-secret; HttpOnly', 'set-cookie-header-display-secret'],
    ['snake-case API key', 'api_key=snake-api-secret', 'snake-api-secret'],
    ['camel-case API key', 'apiKey=camel-api-secret', 'camel-api-secret'],
    ['provider API key', 'provider error apiKey: provider-api-secret', 'provider-api-secret'],
    ['JSON API key', 'provider error {"apiKey": "json-api-secret"}', 'json-api-secret'],
    ['access token', 'access_token=access-display-secret', 'access-display-secret'],
    ['camel access token', 'accessToken: camel-access-secret', 'camel-access-secret'],
    ['refresh token', 'refresh_token=refresh-display-secret', 'refresh-display-secret'],
    ['JSON refresh token', '{"refreshToken": "json-refresh-secret"}', 'json-refresh-secret'],
    ['client secret', 'client_secret=client-display-secret', 'client-display-secret'],
    ['JSON client secret', '{"clientSecret": "json-client-secret"}', 'json-client-secret'],
    ['password', 'password=password-display-secret', 'password-display-secret'],
    ['provider password', 'provider error password: provider-password-secret', 'provider-password-secret'],
    ['cookie', 'cookie=cookie-display-secret', 'cookie-display-secret'],
    ['environment key', 'OPENAI_API_KEY=env-key-secret', 'env-key-secret'],
    ['environment token', 'SESSION_TOKEN=env-token-secret', 'env-token-secret'],
    ['environment secret', 'CLIENT_SECRET=env-client-secret', 'env-client-secret'],
    ['environment password', 'DB_PASSWORD=env-password-secret', 'env-password-secret'],
    ['sk token', `sk-${'c'.repeat(24)}`, `sk-${'c'.repeat(24)}`],
    ['rk token', `rk-${'d'.repeat(24)}`, `rk-${'d'.repeat(24)}`]
  ])('redacts %s from display strings', (_name: string, summary: string, rawSecret: string): void => {
    const validation = validateChatAgentResult({ ...validResult, summary });

    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(validation.result.summary).toContain('[REDACTED]');
    expect(JSON.stringify(validation.result)).not.toContain(rawSecret);
  });

  it('redacts nested result display and error-detail string values before persistence', (): void => {
    const criterion = validResult.completion.criteria[0];
    const validation = validateChatAgentResult({
      ...validResult,
      executionStatus: 'failed',
      summary: 'Authorization: Bearer result-summary-secret',
      completion: {
        ...validResult.completion,
        criteria: [
          {
            ...criterion,
            claim: {
              ...criterion.claim,
              summary: 'apiKey=criterion-claim-secret'
            }
          }
        ]
      },
      warnings: [{ code: 'runtime_warning', message: 'refresh_token=warning-message-secret' }],
      error: {
        code: 'runtime_failed',
        phase: 'runtime',
        category: 'runtime',
        retryable: false,
        message: 'cookie=error-message-secret',
        details: {
          reason: 'DB_PASSWORD=detail-value-secret'
        }
      }
    });

    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(validation.result).toMatchObject({
      summary: '[REDACTED]',
      completion: { criteria: [{ claim: { summary: '[REDACTED]' } }] },
      warnings: [{ code: 'runtime_warning', message: '[REDACTED]' }],
      error: {
        message: '[REDACTED]',
        details: { reason: '[REDACTED]' }
      }
    });
    const persisted = JSON.stringify(validation.result);
    ['result-summary-secret', 'criterion-claim-secret', 'warning-message-secret', 'error-message-secret', 'detail-value-secret'].forEach((rawSecret): void => {
      expect(persisted).not.toContain(rawSecret);
    });
  });

  it('rejects artifact and evidence references that contain secret-shaped values', (): void => {
    const criterion = validResult.completion.criteria[0];

    expect(
      validateChatAgentResult({
        ...validResult,
        artifacts: [
          {
            ...validResult.artifacts[0],
            reference: 'agent-artifacts/report?access_token=artifact-reference-secret'
          }
        ]
      })
    ).toMatchObject({ ok: false, error: { phase: 'result_validation' } });
    expect(
      validateChatAgentResult({
        ...validResult,
        completion: {
          ...validResult.completion,
          criteria: [
            {
              ...criterion,
              claim: {
                ...criterion.claim,
                evidence: [{ kind: 'resource_snapshot', referenceId: 'api_key=evidence-reference-secret' }]
              }
            }
          ]
        }
      })
    ).toMatchObject({ ok: false, error: { phase: 'result_validation' } });
  });

  it.each(['failed', 'cancelled', 'deadline_exceeded', 'commit_failed'] as const)('requires a structured error for %s results', (executionStatus): void => {
    expect(validateChatAgentResult({ ...validResult, executionStatus })).toMatchObject({
      ok: false,
      error: { phase: 'result_validation' }
    });
  });

  it.each([
    ['completed with error', 'completed', { code: 'runtime_failed', phase: 'runtime', category: 'runtime', retryable: false }],
    ['failed with cancelled code', 'failed', { code: 'cancelled', phase: 'runtime', category: 'user', retryable: false }],
    ['failed with deadline code', 'failed', { code: 'deadline_exceeded', phase: 'runtime', category: 'policy', retryable: false }],
    ['failed with commit code', 'failed', { code: 'commit_failed', phase: 'commit', category: 'integrity', retryable: false }],
    ['cancelled with wrong code', 'cancelled', { code: 'runtime_failed', phase: 'runtime', category: 'runtime', retryable: false }],
    ['cancelled with wrong phase', 'cancelled', { code: 'cancelled', phase: 'queue', category: 'user', retryable: false }],
    ['cancelled with wrong category', 'cancelled', { code: 'cancelled', phase: 'runtime', category: 'policy', retryable: false }],
    ['deadline with wrong code', 'deadline_exceeded', { code: 'cancelled', phase: 'runtime', category: 'user', retryable: false }],
    ['deadline with wrong phase', 'deadline_exceeded', { code: 'deadline_exceeded', phase: 'recovery', category: 'policy', retryable: false }],
    ['deadline with wrong category', 'deadline_exceeded', { code: 'deadline_exceeded', phase: 'runtime', category: 'user', retryable: false }],
    ['commit failure with wrong code', 'commit_failed', { code: 'runtime_failed', phase: 'commit', category: 'runtime', retryable: false }],
    ['commit failure with wrong phase', 'commit_failed', { code: 'commit_failed', phase: 'runtime', category: 'integrity', retryable: false }],
    ['commit failure with wrong category', 'commit_failed', { code: 'commit_failed', phase: 'commit', category: 'policy', retryable: false }]
  ])('rejects %s', (_name: string, executionStatus: string, error: object): void => {
    expect(validateChatAgentResult({ ...validResult, executionStatus, error })).toMatchObject({
      ok: false,
      error: { phase: 'result_validation' }
    });
  });

  it.each([
    ['failed', 'failed', { code: 'runtime_failed', phase: 'runtime', category: 'runtime', retryable: false }],
    ['cancelled at runtime', 'cancelled', { code: 'cancelled', phase: 'runtime', category: 'user', retryable: false }],
    ['cancelled during commit', 'cancelled', { code: 'cancelled', phase: 'commit', category: 'runtime', retryable: false }],
    ['cancelled during recovery', 'cancelled', { code: 'cancelled', phase: 'recovery', category: 'user', retryable: false }],
    ['deadline in queue', 'deadline_exceeded', { code: 'deadline_exceeded', phase: 'queue', category: 'policy', retryable: false }],
    ['deadline while starting', 'deadline_exceeded', { code: 'deadline_exceeded', phase: 'starting', category: 'runtime', retryable: false }],
    ['deadline at runtime', 'deadline_exceeded', { code: 'deadline_exceeded', phase: 'runtime', category: 'policy', retryable: false }],
    ['deadline at confirmation', 'deadline_exceeded', { code: 'deadline_exceeded', phase: 'confirmation', category: 'runtime', retryable: false }],
    ['deadline during commit', 'deadline_exceeded', { code: 'deadline_exceeded', phase: 'commit', category: 'policy', retryable: false }],
    ['commit validation failure', 'commit_failed', { code: 'commit_failed', phase: 'commit_validation', category: 'resource', retryable: false }],
    ['commit runtime failure', 'commit_failed', { code: 'commit_failed', phase: 'commit', category: 'runtime', retryable: false }],
    ['commit recovery failure', 'commit_failed', { code: 'commit_failed', phase: 'recovery', category: 'integrity', retryable: false }]
  ])('accepts %s with its approved structured error', (_name: string, executionStatus: string, error: object): void => {
    expect(validateChatAgentResult({ ...validResult, executionStatus, error })).toMatchObject({
      ok: true
    });
  });

  it.each([
    ['full without satisfied verification', 'full', 'unsatisfied', 'unverified'],
    ['none with satisfied verification', 'none', 'satisfied', 'verified'],
    ['partial with every criterion satisfied', 'partial', 'satisfied', 'verified']
  ])(
    'rejects completion level %s when criterion evidence is inconsistent',
    (_name: string, level: string, claimStatus: string, verificationStatus: string): void => {
      const criterion = validResult.completion.criteria[0];
      expect(
        validateChatAgentResult({
          ...validResult,
          completion: {
            level,
            criteria: [
              {
                ...criterion,
                claim: { ...criterion.claim, status: claimStatus },
                verification: { ...criterion.verification, status: verificationStatus }
              }
            ]
          }
        })
      ).toMatchObject({ ok: false, error: { phase: 'result_validation' } });
    }
  );

  it('rejects foundation read changesets', (): void => {
    expect(
      validateChatAgentResult({
        ...validResult,
        changeset: {
          changesetId: 'changeset-1',
          baseRevision: 'revision-1',
          diffHash: 'd'.repeat(64),
          operationSetHash: 'e'.repeat(64),
          planHash: 'f'.repeat(64)
        }
      })
    ).toMatchObject({ ok: false, error: { phase: 'result_validation' } });
  });

  it('rejects user-visible Child artifacts', (): void => {
    expect(
      validateChatAgentResult({
        ...validResult,
        artifacts: validResult.artifacts.map((artifact): object => ({
          ...artifact,
          visibility: 'user'
        }))
      })
    ).toMatchObject({ ok: false, error: { phase: 'result_validation' } });
  });

  it.each([
    [
      'legacy flat criterion',
      {
        completion: {
          level: 'full',
          criteria: [{ criterion: 'name', status: 'verified', claim: 'Tibis', evidence: [] }]
        }
      }
    ],
    [
      'nested error details',
      {
        error: {
          code: 'runtime_failed',
          phase: 'runtime',
          category: 'runtime',
          retryable: false,
          details: { nested: { secret: true } }
        }
      }
    ],
    [
      'artifact without owner',
      {
        artifacts: [
          {
            artifactId: 'artifact-1',
            kind: 'report',
            reference: 'agent-artifacts/report-1',
            visibility: 'primary',
            createdAt: '2026-07-23T08:00:00.000Z'
          }
        ]
      }
    ],
    [
      'fabricated zero cost shape',
      {
        usage: {
          ...validResult.usage,
          monetaryCost: {
            currency: 'USD',
            pricingVersion: 'unknown',
            estimated: 0,
            actual: 0,
            unknown: true
          }
        }
      }
    ]
  ])('rejects %s', (_name: string, patch: object): void => {
    expect(validateChatAgentResult({ ...validResult, ...patch })).toMatchObject({
      ok: false,
      error: { phase: 'result_validation', category: 'protocol', retryable: false }
    });
  });

  it('rejects arbitrary result output including deeply nested sensitive keys', (): void => {
    expect(
      validateChatAgentResult({
        ...validResult,
        output: {
          first: {
            second: {
              authorization: 'Bearer secret',
              apiKey: 'secret-key',
              environment: 'SECRET=value'
            }
          }
        }
      })
    ).toMatchObject({ ok: false, error: { phase: 'result_validation' } });
  });

  it.each(['authorization', 'apiKey', 'environment'])('rejects the sensitive error detail key %s', (sensitiveKey: string): void => {
    expect(
      validateChatAgentResult({
        ...validResult,
        executionStatus: 'failed',
        error: {
          code: 'runtime_failed',
          phase: 'runtime',
          category: 'runtime',
          retryable: false,
          details: { [sensitiveKey]: 'secret' }
        }
      })
    ).toMatchObject({ ok: false, error: { phase: 'result_validation' } });
  });

  it.each([
    ['empty currency', { currency: '', pricingVersion: 'test-v1', estimated: 0, actual: 0 }],
    ['lowercase currency', { currency: 'usd', pricingVersion: 'test-v1', estimated: 0, actual: 0 }],
    ['empty pricing version', { currency: 'USD', pricingVersion: '', estimated: 0, actual: 0 }],
    ['secret-shaped pricing version', { currency: 'USD', pricingVersion: 'pricing_api_key=cost-secret', estimated: 0, actual: 0 }],
    ['numeric unknown cost', { currency: 'unknown', pricingVersion: 'unknown', estimated: 0, actual: 0 }]
  ])('rejects %s cost accounting', (_name: string, monetaryCost: object): void => {
    expect(
      validateChatAgentResult({
        ...validResult,
        usage: {
          ...validResult.usage,
          monetaryCost
        }
      })
    ).toMatchObject({ ok: false, error: { phase: 'result_validation' } });
  });
});
