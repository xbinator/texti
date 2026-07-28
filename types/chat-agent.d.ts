/**
 * @file chat-agent.d.ts
 * @description Child Agent 委派契约、持久化快照、结果信封与审计事件的共享类型。
 */
import type { ChatRuntimeAddress } from './chat-runtime';

/** 委派任务优先级；调度器只能在该固定集合内比较。 */
export type AgentTaskPriority = 'low' | 'normal' | 'high';

/** 委派任务执行模式。 */
export type AgentTaskMode = 'read' | 'write';

/** Main-owned Primary 委派灰度能力；Renderer 不能覆盖。 */
export interface PrimaryDelegationFeatureConfig {
  /** 是否向可信 Primary Runtime A 暴露 delegate_task。 */
  readonly enabled: boolean;
  /** 是否允许 pure-read Child。 */
  readonly pureReadChildEnabled: boolean;
  /** 是否允许受控 staged-write Child。 */
  readonly controlledWriteChildEnabled: boolean;
  /** 首版固定最大并行 read Child 数。 */
  readonly maxParallelReadChildren: 3;
}

/** Task 可变执行状态，与 tombstone 记录状态正交。 */
export type AgentTaskStatus =
  | 'created'
  | 'planning'
  | 'authorized'
  | 'queued'
  | 'starting'
  | 'running'
  | 'waiting_confirmation'
  | 'committing'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'deadline_exceeded'
  | 'commit_failed';

/** queued 状态对应的执行阶段。 */
export type AgentTaskQueuePhase = 'start' | 'commit';

/** Delegation Checkpoint 的可变执行状态。 */
export type AgentCheckpointStatus =
  | 'preparing'
  | 'waiting_children'
  | 'ready_to_resume'
  | 'resuming'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

/** 持久化记录的逻辑删除状态。 */
export type AgentRecordState = 'active' | 'tombstoned';

/** 显式资源引用，仅保存授权范围内的稳定标识。 */
export interface AgentResourceReference {
  /** 资源域，由注册的 scope resolver 解释。 */
  readonly kind: 'file' | 'directory' | 'document' | 'webview' | 'resource';
  /** 仓库相对路径或稳定的资源域标识。 */
  readonly reference: string;
  /** 调用方观察到的可选修订，用于后续完整性验证。 */
  readonly revision?: string;
}

/** Primary 提交给 Coordinator 的受限任务契约。 */
export interface DelegateTaskInput {
  /** 单一、具体且无需聊天上下文补全的任务描述。 */
  task: string;
  /** 按原始顺序保存的验收标准。 */
  acceptanceCriteria: string[];
  /** 只读或受控写入模式。 */
  mode: AgentTaskMode;
  /** 任务可以访问的最小资源集合。 */
  resources: AgentResourceReference[];
  /** Primary 请求、但仍需策略收缩的工具名称集合。 */
  requestedTools: string[];
  /** 失败时是否阻止 Primary 正常完成当前 Turn。 */
  required: boolean;
  /** 任务调度优先级。 */
  priority: AgentTaskPriority;
  /** 可选绝对 ISO-8601 截止时间。 */
  deadlineAt?: string;
}

/** 不可变 Task Contract Snapshot。 */
export interface AgentTaskContractSnapshot {
  /** 契约 Schema 版本。 */
  readonly contractSchemaVersion: number;
  /** 规范化任务描述。 */
  readonly task: string;
  /** 有序验收标准。 */
  readonly acceptanceCriteria: readonly string[];
  /** 冻结的任务模式。 */
  readonly mode: AgentTaskMode;
  /** 有序资源引用。 */
  readonly resources: readonly AgentResourceReference[];
  /** 规范化并排序后的请求工具集合。 */
  readonly requestedTools: readonly string[];
  /** 任务是否为必需任务。 */
  readonly required: boolean;
}

/** 冻结模型选择，不包含密钥或完整 Provider 配置。 */
export interface AgentModelSnapshot {
  /** Provider 注册标识。 */
  readonly providerId: string;
  /** 模型注册标识。 */
  readonly modelId: string;
}

/** 冻结权限范围，只保存已解析的稳定 scope ID。 */
export interface AgentPermissionSnapshot {
  /** 任务授权时已存在的权限 scope。 */
  readonly scopeIds: readonly string[];
}

/** 执行计划中单个工具的副作用事实。 */
export interface AgentPlanToolEffect {
  /** 工具注册名。 */
  readonly toolName: string;
  /** 授权时冻结的副作用分类。 */
  readonly effect: 'pure_read' | 'external_read' | 'staged_file_write' | 'transactional_write' | 'immediate_side_effect' | 'unknown';
}

/** 执行计划的提交策略。 */
export interface AgentCommitPolicy {
  /** 无写入或受控提交协议。 */
  readonly mode: 'none' | 'staged';
  /** staged 模式必须冻结 adapter 注册名；none 模式必须省略。 */
  readonly adapter?: string;
}

/** 任务或续接预留的预算快照。 */
export interface AgentBudgetSnapshot {
  /** 最大 token 数。 */
  readonly tokenLimit: number;
  /** 最大美元成本。 */
  readonly costLimitUsd: number;
  /** 计算成本时使用的定价版本。 */
  readonly pricingVersion: string;
}

/** Coordinator 冻结的不可变 Execution Plan Snapshot。 */
export interface AgentExecutionPlanSnapshot {
  /** 对规范化计划内容计算的完整性 hash。 */
  readonly planHash: string;
  /** 执行计划 Schema 版本。 */
  readonly planSchemaVersion: number;
  /** 授权时使用的策略版本。 */
  readonly policyVersion: string;
  /** 已冻结且只能在恢复时收缩的能力集合。 */
  readonly capabilitySet: readonly string[];
  /** 不含敏感配置的模型快照。 */
  readonly modelSnapshot: AgentModelSnapshot;
  /** 不含令牌的权限快照。 */
  readonly permissionSnapshot: AgentPermissionSnapshot;
  /** 规范化资源门禁范围。 */
  readonly resourceScopes: readonly string[];
  /** 计划内工具的副作用事实。 */
  readonly toolEffectSet: readonly AgentPlanToolEffect[];
  /** 写入提交策略。 */
  readonly commitPolicy: AgentCommitPolicy;
  /** Task 级预算预留。 */
  readonly budget: AgentBudgetSnapshot;
}

/** Checkpoint 中按 Provider tool-call 顺序冻结的任务链接。 */
export interface AgentOrderedToolCallSnapshot {
  /** 原始 Provider tool-call ID。 */
  readonly toolCallId: string;
  /** 对应的稳定 Task ID。 */
  readonly taskId: string;
  /** 该工具调用是否必须成功。 */
  readonly required: boolean;
  /** 规范化工具参数 hash。 */
  readonly argumentsHash: string;
  /** 经 allowlist 裁剪的 Provider metadata hash。 */
  readonly providerMetadataHash: string;
}

/** Runtime A 挂起时冻结的不可变 Continuation Snapshot。 */
export interface AgentDelegationContinuationSnapshot {
  /** Checkpoint Schema 版本。 */
  readonly checkpointSchemaVersion: number;
  /** 创建快照时的安全策略版本。 */
  readonly policyVersion: string;
  /** Runtime B 必须继承的模型选择。 */
  readonly modelSnapshot: AgentModelSnapshot;
  /** 主进程内部 continuation context 的不透明引用。 */
  readonly continuationContextReference: string;
  /** 规范化 continuation context hash。 */
  readonly continuationContextHash: string;
  /** Runtime A assistant 消息的精确修订。 */
  readonly sourceMessageRevision: string;
  /** 委派工具 Schema 集合 hash。 */
  readonly toolSchemaSnapshotHash: string;
  /** 按原 tool-call 顺序冻结的 Task 关联。 */
  readonly orderedToolCalls: readonly AgentOrderedToolCallSnapshot[];
  /** 为 Primary Runtime B 预留的预算。 */
  readonly reservedResumeBudget: AgentBudgetSnapshot;
  /** 当前 Turn 的绝对截止时间。 */
  readonly absoluteTurnDeadline: string;
}

/** AgentTaskError.details 允许持久化的稳定机器键。 */
export type AgentTaskErrorDetailKey =
  | 'reason'
  | 'resourceReference'
  | 'resourceScope'
  | 'toolName'
  | 'expectedHash'
  | 'actualHash'
  | 'expectedVersion'
  | 'actualVersion'
  | 'status'
  | 'limit'
  | 'observed'
  | 'deadlineAt'
  | 'taskId'
  | 'checkpointId'
  | 'attemptId'
  | 'runtimeId'
  | 'operationId'
  | 'usageIncomplete';

/** 机器可判断的 Agent 错误阶段。 */
export type AgentTaskErrorPhase =
  | 'contract_validation'
  | 'plan_validation'
  | 'resource_validation'
  | 'queue'
  | 'starting'
  | 'runtime'
  | 'result_validation'
  | 'confirmation'
  | 'commit_validation'
  | 'commit'
  | 'recovery';

/** 稳定机器错误码。 */
export type AgentTaskErrorCode =
  | 'invalid_contract'
  | 'capability_denied'
  | 'resource_scope_invalid'
  | 'plan_version_unsupported'
  | 'deadline_exceeded'
  | 'budget_exceeded'
  | 'runtime_start_failed'
  | 'runtime_failed'
  | 'runtime_interrupted'
  | 'result_evidence_invalid'
  | 'confirmation_denied'
  | 'stale_context'
  | 'commit_failed'
  | 'manual_recovery_required'
  | 'cancelled'
  | 'protocol_error';

/** 结构化 Agent 错误；message 仅用于展示。 */
export interface AgentTaskError {
  /** 稳定机器错误码。 */
  code: AgentTaskErrorCode;
  /** 失败发生的协议阶段。 */
  phase: AgentTaskErrorPhase;
  /** 机器可聚合的错误类别。 */
  category: 'policy' | 'resource' | 'runtime' | 'protocol' | 'user' | 'integrity';
  /** 同一不可变契约是否允许重试。 */
  retryable: boolean;
  /** 用户可读说明，不参与控制流。 */
  message?: string;
  /** 经 allowlist 裁剪的机器细节。 */
  details?: Partial<Record<AgentTaskErrorDetailKey, string | number | boolean | null>>;
}

/** 验收证据引用。 */
export interface AgentEvidenceReference {
  /** 证据存储域。 */
  kind: 'tool_event' | 'artifact' | 'resource_snapshot' | 'commit_journal' | 'task_result';
  /** 稳定证据标识或授权资源引用。 */
  referenceId: string;
  /** 可选证据内容 hash。 */
  contentHash?: string;
}

/** 单条验收标准的结构化结论。 */
export interface AgentCriteriaResult {
  /** 对应 acceptanceCriteria 的稳定数组索引。 */
  criterionIndex: number;
  /** Child 提交但不能自行升级为 verified 的声明。 */
  claim: {
    /** Child 对验收标准的判断。 */
    status: 'satisfied' | 'unsatisfied' | 'unknown';
    /** 紧凑声明摘要。 */
    summary: string;
    /** Child 声明引用的证据。 */
    evidence: AgentEvidenceReference[];
  };
  /** 独立验证层，不直接信任 Child 声明。 */
  verification: {
    /** 验证器的最终判断。 */
    status: 'verified' | 'unverified' | 'contradicted';
    /** 产生验证结论的可信主体。 */
    verifier: 'tool' | 'coordinator' | 'primary' | 'policy';
    /** 验证器实际检查的证据。 */
    evidence: AgentEvidenceReference[];
  };
}

/** 非终止性任务警告。 */
export interface AgentTaskWarning {
  /** 稳定警告码。 */
  code: string;
  /** 用户可读警告说明。 */
  message: string;
}

/** Task 产物所有权和可见性。 */
export interface AgentArtifactReference {
  /** 稳定产物标识。 */
  artifactId: string;
  /** 所有权域，避免 Child 越权转移产物。 */
  owner: {
    /** 产物来源 Task。 */
    taskId: string;
    /** 产物来源 Child Actor。 */
    agentId: string;
    /** 产物来源 Attempt。 */
    attemptId: string;
  };
  /** 可见性层级。 */
  visibility: 'internal' | 'primary' | 'user';
  /** 产物种类。 */
  kind: string;
  /** 稳定产物引用。 */
  reference: string;
  /** 可选产物内容或清单 hash。 */
  contentHash?: string;
  /** 产物创建时间。 */
  createdAt: string;
}

/** 受控写入结果的完整性引用。 */
export interface AgentChangesetResult {
  /** changeset 稳定标识。 */
  changesetId: string;
  /** 写入前基础修订。 */
  baseRevision: string;
  /** 用户确认和提交共同绑定的 diff hash。 */
  diffHash: string;
  /** 规范化操作集合 hash。 */
  operationSetHash: string;
  /** 生成 changeset 的执行计划 hash。 */
  planHash: string;
}

/** changeset 中单个文件操作的不可变事实。 */
export interface AgentFileOperationSnapshot {
  /** 操作稳定身份。 */
  readonly operationId: string;
  /** 创建新文件或替换已有文件。 */
  readonly kind: 'create' | 'replace';
  /** 面向确认界面的工作区相对路径。 */
  readonly displayPath: string;
  /** Main 校验后的真实目标路径。 */
  readonly targetPath: string;
  /** 操作命中的冻结资源 scope。 */
  readonly resourceScope: string;
  /** 单文件基础修订 hash。 */
  readonly baseRevision: string;
  /** 基础内容 hash。 */
  readonly baseContentHash: string;
  /** 候选内容 hash。 */
  readonly targetContentHash: string;
  /** 私有 overlay 中的候选内容引用。 */
  readonly candidateReference: string;
  /** 私有 overlay 中的回滚内容引用。 */
  readonly rollbackReference: string;
  /** 候选内容 UTF-8 字节数。 */
  readonly byteLength: number;
}

/** write Attempt 生成的不可变 changeset。 */
export interface AgentChangesetSnapshot {
  /** changeset Schema 版本。 */
  readonly changesetSchemaVersion: number;
  /** changeset 稳定身份。 */
  readonly changesetId: string;
  /** 所属 Task。 */
  readonly taskId: string;
  /** 产生 changeset 的 Attempt。 */
  readonly attemptId: string;
  /** 所属 Child Actor。 */
  readonly agentId: string;
  /** 产生 changeset 的 Runtime。 */
  readonly runtimeId: string;
  /** 绑定的 Execution Plan hash。 */
  readonly planHash: string;
  /** 全部基础文件事实的聚合修订。 */
  readonly baseRevision: string;
  /** 私有 overlay 中完整 unified diff 引用。 */
  readonly diffReference: string;
  /** 完整 diff 完整性 hash。 */
  readonly diffHash: string;
  /** 规范化操作集合 hash。 */
  readonly operationSetHash: string;
  /** changeset 命中的资源 scopes。 */
  readonly resourceScopes: readonly string[];
  /** 按目标路径规范化排序的文件操作。 */
  readonly operations: readonly AgentFileOperationSnapshot[];
  /** 不可变创建时间。 */
  readonly createdAt: string;
}

/** 用户确认请求的不可变展示与完整性事实。 */
export interface AgentConfirmationRequestSnapshot {
  /** confirmation Schema 版本。 */
  readonly confirmationSchemaVersion: number;
  /** confirmation 稳定身份。 */
  readonly confirmationId: string;
  /** 所属会话。 */
  readonly sessionId: string;
  /** 所属 Turn。 */
  readonly turnId: string;
  /** 所属 Task。 */
  readonly taskId: string;
  /** 所属 Attempt。 */
  readonly attemptId: string;
  /** 所属 Child Actor。 */
  readonly agentId: string;
  /** 生成 changeset 的 Runtime。 */
  readonly runtimeId: string;
  /** 原始 delegate_task tool-call。 */
  readonly toolCallId: string;
  /** 待确认 changeset。 */
  readonly changesetId: string;
  /** 绑定的 Execution Plan hash。 */
  readonly planHash: string;
  /** 绑定的基础修订。 */
  readonly baseRevision: string;
  /** 绑定的 diff hash。 */
  readonly diffHash: string;
  /** 绑定的操作集合 hash。 */
  readonly operationSetHash: string;
  /** 确认覆盖的资源 scopes。 */
  readonly resourceScopes: readonly string[];
  /** 面向用户展示的文件路径。 */
  readonly displayPaths: readonly string[];
  /** 完整 unified diff 的受保护引用。 */
  readonly unifiedDiffReference: string;
  /** 确认风险等级。 */
  readonly riskLevel: 'write' | 'dangerous';
  /** 不可变创建时间。 */
  readonly createdAt: string;
}

/** Task 实际资源与成本记账。 */
export interface AgentUsageAccounting {
  /** Provider 输入 token。 */
  inputTokens: number;
  /** Provider 输出 token。 */
  outputTokens: number;
  /** 输入与输出 token 合计。 */
  totalTokens: number;
  /** Provider 模型调用次数。 */
  modelCalls: number;
  /** Agent 工具执行轮次。 */
  toolRounds: number;
  /** 排队耗时。 */
  queueDurationMs: number;
  /** 实际执行耗时。 */
  executionDurationMs: number;
  /** 外部请求次数。 */
  externalRequests: number;
  /** 可显式表达未知值的货币成本。 */
  monetaryCost: {
    /** ISO-4217 货币代码；Provider 未提供时为 unknown。 */
    currency: string | 'unknown';
    /** 成本计算使用的定价版本；不可用时为 unknown。 */
    pricingVersion: string | 'unknown';
    /** 预估成本；没有可靠价格时为 unknown。 */
    estimated: number | 'unknown';
    /** Provider 返回的实际成本；不可用时为 unknown。 */
    actual: number | 'unknown';
  };
}

/** write Runtime 结束模型执行后冻结的结果草稿。 */
export interface AgentWriteResultDraft {
  /** 所属 Task。 */
  readonly taskId: string;
  /** 所属 Child Actor。 */
  readonly agentId: string;
  /** 所属 Attempt。 */
  readonly attemptId: string;
  /** 面向 Primary 的结果摘要。 */
  readonly summary: string;
  /** 经安全裁剪的可选结构化输出。 */
  readonly output?: unknown;
  /** 按契约顺序生成的验收结论。 */
  readonly criteria: readonly AgentCriteriaResult[];
  /** 不改变执行终态的警告。 */
  readonly warnings: readonly AgentTaskWarning[];
  /** write Attempt 已消费的成本。 */
  readonly usage: AgentUsageAccounting;
}

/** commit journal 首次创建时冻结的完整提交意图。 */
export interface AgentCommitIntentSnapshot {
  /** journal intent Schema 版本。 */
  readonly journalSchemaVersion: number;
  /** 完整 changeset snapshot hash。 */
  readonly changesetSnapshotHash: string;
  /** 已批准 confirmation。 */
  readonly confirmationId: string;
  /** 已批准的 confirmation CAS 版本。 */
  readonly confirmationVersion: number;
  /** 绑定的 Execution Plan hash。 */
  readonly planHash: string;
  /** commit 完成后生成结果所需的不可变草稿。 */
  readonly resultDraft: AgentWriteResultDraft;
  /** 按 changeset 冻结的文件操作。 */
  readonly operations: readonly AgentFileOperationSnapshot[];
  /** 不可变创建时间。 */
  readonly createdAt: string;
}

/** confirmation 可变状态。 */
export type AgentConfirmationStatus = 'pending' | 'approved' | 'rejected' | 'revoked';

/** confirmation CAS 决议。 */
export type AgentConfirmationDecision = {
  /** 用户批准或拒绝。 */
  readonly decision: 'approved' | 'rejected';
  /** 决议后版本。 */
  readonly version: number;
};

/** commit journal 可变协议状态。 */
export type AgentCommitJournalStatus = 'created' | 'applying' | 'applied' | 'finalized' | 'cancelled' | 'manual_recovery';

/** changeset 的不可变快照与可变状态投影。 */
export interface AgentChangesetRecord {
  /** 不可变 changeset。 */
  readonly snapshot: AgentChangesetSnapshot;
  /** changeset snapshot hash。 */
  readonly snapshotHash: string;
  /** changeset 当前状态。 */
  readonly status: 'prepared' | 'awaiting_confirmation' | 'approved' | 'rejected' | 'revoked' | 'committing' | 'committed' | 'discarded';
  /** 绑定的 confirmation。 */
  readonly confirmationId?: string;
  /** 逻辑记录状态。 */
  readonly recordState: AgentRecordState;
  /** 投影更新时间。 */
  readonly updatedAt: string;
}

/** confirmation 的不可变请求与 CAS 投影。 */
export interface AgentConfirmationRecord {
  /** confirmation 稳定身份。 */
  readonly confirmationId: string;
  /** 唯一绑定 changeset。 */
  readonly changesetId: string;
  /** 不可变确认请求。 */
  readonly request: AgentConfirmationRequestSnapshot;
  /** 请求快照 hash。 */
  readonly requestHash: string;
  /** 当前确认状态。 */
  readonly status: AgentConfirmationStatus;
  /** 当前 CAS 版本。 */
  readonly version: number;
  /** 已持久化决定。 */
  readonly decision?: AgentConfirmationDecision['decision'];
  /** 不可变创建时间。 */
  readonly createdAt: string;
  /** 投影更新时间。 */
  readonly updatedAt: string;
}

/** commit journal 的不可变意图与可恢复进度。 */
export interface AgentCommitJournalRecord {
  /** journal 稳定身份。 */
  readonly journalId: string;
  /** 所属 Task。 */
  readonly taskId: string;
  /** 所属 Attempt。 */
  readonly attemptId: string;
  /** 唯一绑定 changeset。 */
  readonly changesetId: string;
  /** 已批准 confirmation。 */
  readonly confirmationId: string;
  /** 已批准 confirmation 版本。 */
  readonly confirmationVersion: number;
  /** 绑定的 Execution Plan hash。 */
  readonly planHash: string;
  /** 不可变提交意图。 */
  readonly intent: AgentCommitIntentSnapshot;
  /** 提交意图 hash。 */
  readonly intentHash: string;
  /** journal 当前状态。 */
  readonly status: AgentCommitJournalStatus;
  /** 已应用操作的有序身份。 */
  readonly appliedOperationIds: readonly string[];
  /** 可选结构化提交错误。 */
  readonly error?: AgentTaskError;
  /** 不可变创建时间。 */
  readonly createdAt: string;
  /** 投影更新时间。 */
  readonly updatedAt: string;
  /** journal 完成时间。 */
  readonly finalizedAt?: string;
}

/** Primary Runtime B 消费的结构化终态结果。 */
export interface ChatAgentResult {
  /** 结果所属 Task。 */
  taskId: string;
  /** 稳定 Child Actor ID。 */
  agentId: string;
  /** 产生结果的 Attempt ID。 */
  attemptId: string;
  /** 机器执行终态。 */
  executionStatus: 'completed' | 'failed' | 'cancelled' | 'deadline_exceeded' | 'commit_failed';
  /** 与执行状态分离的验收完成度。 */
  completion: {
    /** 整体完成度。 */
    level: 'full' | 'partial' | 'none';
    /** 每条验收标准的证据结论。 */
    criteria: AgentCriteriaResult[];
  };
  /** 面向 Primary 的紧凑结果摘要。 */
  summary: string;
  /** 经 allowlist 裁剪的可选结构化输出。 */
  output?: unknown;
  /** 不改变执行终态的警告。 */
  warnings: AgentTaskWarning[];
  /** 有明确所有权和可见性的产物。 */
  artifacts: AgentArtifactReference[];
  /** 受控写任务的可选 changeset 完整性信息。 */
  changeset?: AgentChangesetResult;
  /** Task/Attempt 实际成本。 */
  usage: AgentUsageAccounting;
  /** 失败终态的结构化错误。 */
  error?: AgentTaskError;
}

/**
 * Coordinator 在 Runtime/Attempt 创建前生成的失败结果。
 * 该结果显式没有 attemptId，避免把授权或资源裁决伪装成一次执行。
 */
export interface AgentPreAttemptFailureResult {
  /** 判别授权前失败与真实 Attempt 结果。 */
  resultKind: 'pre_attempt_failure';
  /** 结果所属 Task。 */
  taskId: string;
  /** 稳定 Child Actor ID。 */
  agentId: string;
  /** 授权前失败统一映射为 Task failed。 */
  executionStatus: 'failed';
  /** 未开始执行时所有验收标准只能是未完成。 */
  completion: {
    /** 授权前失败不能声明部分或完整完成。 */
    level: 'none';
    /** 与不可变 acceptanceCriteria 精确对齐的未知结论。 */
    criteria: AgentCriteriaResult[];
  };
  /** 面向 Primary 的紧凑失败摘要。 */
  summary: string;
  /** 授权前失败不产生非终止性警告。 */
  warnings: AgentTaskWarning[];
  /** 授权前失败不拥有 Runtime 产物。 */
  artifacts: AgentArtifactReference[];
  /** 未启动 Runtime 的零成本记账。 */
  usage: AgentUsageAccounting;
  /** 不可重试的授权、计划、资源或无 Attempt 恢复错误。 */
  error: AgentTaskError;
}

/** Runtime/Attempt 创建前的合作式取消结果。 */
export interface AgentPreAttemptCancellationResult {
  /** 判别无 Attempt 取消。 */
  readonly resultKind: 'pre_attempt_cancelled';
  /** 结果所属 Task。 */
  readonly taskId: string;
  /** 稳定 Child Actor。 */
  readonly agentId: string;
  /** 机器执行终态。 */
  readonly executionStatus: 'cancelled';
  /** 未执行时不能声明任何验收完成。 */
  readonly completion: {
    /** 无 Attempt 取消没有验收完成度。 */
    readonly level: 'none';
    /** 与不可变 Contract 精确对齐的未知结论。 */
    readonly criteria: readonly AgentCriteriaResult[];
  };
  /** 面向 Primary 的稳定摘要。 */
  readonly summary: string;
  /** 无 Attempt 取消不产生非终止性警告。 */
  readonly warnings: readonly [];
  /** 无 Attempt 取消不产生 artifact。 */
  readonly artifacts: readonly [];
  /** 所有计数为零、货币成本为 unknown。 */
  readonly usage: AgentUsageAccounting;
  /** 固定 queue/user cancellation 错误。 */
  readonly error: AgentTaskError;
}

/** Checkpoint rendezvous 可消费的全部 Child 终态结果。 */
export type AgentTaskResult = ChatAgentResult | AgentPreAttemptFailureResult | AgentPreAttemptCancellationResult;

/** 基础阶段 delegation.created Outbox 的唯一 payload。 */
export interface AgentDelegationCreatedPayload {
  /** 已原子持久化的 Checkpoint。 */
  readonly checkpointId: string;
  /** Checkpoint 所属会话。 */
  readonly sessionId: string;
  /** Checkpoint 所属 Turn。 */
  readonly turnId: string;
}

/** 全部 Child 结果已原子汇合后的 delegation.ready Outbox payload。 */
export interface AgentDelegationReadyPayload {
  /** 可由 Primary Runtime B claim 的 Checkpoint。 */
  readonly checkpointId: string;
  /** Checkpoint 所属会话。 */
  readonly sessionId: string;
  /** Checkpoint 所属 Turn。 */
  readonly turnId: string;
  /** 按冻结 tool-call 顺序汇合的结果数量。 */
  readonly resultCount: number;
}

/** Agent 审计事件的稳定来源。 */
export type ChatAgentEventSource = 'primary' | 'coordinator' | 'child' | 'runtime' | 'user' | 'system';

/** 当前基础阶段可持久化的 Agent Event 类型。 */
export type ChatAgentEventType =
  | 'task.created'
  | 'task.cancel_requested'
  | 'task.status_changed'
  | 'plan.authorized'
  | 'task.queued'
  | 'delegation.checkpoint_created'
  | 'primary.suspended'
  | 'runtime.starting'
  | 'runtime.started'
  | 'runtime.replaced'
  | 'confirmation.requested'
  | 'confirmation.resolved'
  | 'confirmation.invalidated'
  | 'tool.started'
  | 'tool.completed'
  | 'changeset.prepared'
  | 'commit.journal_created'
  | 'commit.mutation_applied'
  | 'commit.finalized'
  | 'protocol.error'
  | 'child.result_recorded'
  | 'delegation.ready'
  | 'delegation.cancel_requested'
  | 'delegation.interrupted'
  | 'primary.resume_started'
  | 'delegation.completed'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  | 'task.tombstoned';

/** 以 Task 作为历史聚合根的 Event。 */
export type ChatAgentTaskEventType =
  | 'task.created'
  | 'task.cancel_requested'
  | 'task.status_changed'
  | 'plan.authorized'
  | 'task.queued'
  | 'runtime.starting'
  | 'runtime.started'
  | 'runtime.replaced'
  | 'confirmation.requested'
  | 'confirmation.resolved'
  | 'confirmation.invalidated'
  | 'tool.started'
  | 'tool.completed'
  | 'changeset.prepared'
  | 'commit.journal_created'
  | 'commit.mutation_applied'
  | 'commit.finalized'
  | 'protocol.error'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  | 'task.tombstoned';

/** 以 Delegation Checkpoint 作为历史聚合根的 Event。 */
export type ChatAgentCheckpointEventType = Exclude<ChatAgentEventType, ChatAgentTaskEventType>;

/** Agent Event 的结构化 payload 映射。 */
export interface ChatAgentEventPayloadMap {
  /** Task 创建事件。 */
  'task.created': { checkpointId: string; toolCallId: string };
  /** Task 收到 cooperative cancellation 请求。 */
  'task.cancel_requested': { requestKind: 'single_task' | 'checkpoint_cascade' };
  /** 通用 Task 状态投影变化。 */
  'task.status_changed': { from: AgentTaskStatus; to: AgentTaskStatus; queuePhase?: AgentTaskQueuePhase };
  /** Execution Plan 首次冻结。 */
  'plan.authorized': { planHash: string; planSchemaVersion: number; policyVersion: string };
  /** Task 进入指定排队阶段。 */
  'task.queued': { queuePhase: AgentTaskQueuePhase };
  /** Checkpoint 创建。 */
  'delegation.checkpoint_created': { taskIds: readonly string[]; sourceRuntimeId: string };
  /** Primary Runtime A 已安全挂起。 */
  'primary.suspended': { sourceRuntimeId: string };
  /** Runtime 即将启动。 */
  'runtime.starting': { runtimeId: string };
  /** Runtime 已启动。 */
  'runtime.started': { runtimeId: string };
  /** 同一 Attempt 的 Runtime 被替换。 */
  'runtime.replaced': { previousRuntimeId: string; nextRuntimeId: string; reason: string };
  /** 用户确认请求已创建。 */
  'confirmation.requested': { requestId: string; requestHash: string; diffHash: string; version: number };
  /** 用户确认已决议。 */
  'confirmation.resolved': { requestId: string; decision: 'approved' | 'rejected'; diffHash: string; version: number };
  /** 基础修订变化使确认失效。 */
  'confirmation.invalidated': { requestId: string; reason: string; version: number };
  /** Child 工具开始执行。 */
  'tool.started': { toolCallId: string; toolName: string };
  /** Child 工具执行完成。 */
  'tool.completed': { toolCallId: string; toolName: string; resultHash: string };
  /** changeset 已准备。 */
  'changeset.prepared': { changesetId: string; snapshotHash: string; diffHash: string };
  /** commit journal 已创建。 */
  'commit.journal_created': { journalId: string; changesetId: string; intentHash: string; confirmationVersion: number };
  /** 单个外部变更已应用。 */
  'commit.mutation_applied': { journalId: string; operationId: string; targetHash: string };
  /** commit journal 已验证并结束。 */
  'commit.finalized': { journalId: string; finalHash: string };
  /** 幂等写入收到与已持久化事实冲突的协议输入。 */
  'protocol.error': { reason: string; expectedHash: string; actualHash: string };
  /** Child 或 Coordinator 终态结果已按 tool-call ID 写入。 */
  'child.result_recorded': { toolCallId: string; resultHash: string };
  /** 所有结果已汇合。 */
  'delegation.ready': { resultCount: number };
  /** cooperative cancellation 请求已持久化。 */
  'delegation.cancel_requested': { reason: string };
  /** 恢复校验失败或主进程重启造成中断。 */
  'delegation.interrupted': { error: AgentTaskError };
  /** Primary Runtime B 的 CAS claim 已成功。 */
  'primary.resume_started': { runtimeId: string };
  /** Delegation Checkpoint 已终止。 */
  'delegation.completed': { outcome: 'completed' | 'failed' | 'cancelled' };
  /** Task 完成。 */
  'task.completed': { resultHash: string };
  /** Task 失败。 */
  'task.failed': { error?: AgentTaskError; resultHash?: string };
  /** Task 已合作式取消。 */
  'task.cancelled': { resultHash: string };
  /** Task 被逻辑删除。 */
  'task.tombstoned': { reason: string };
}

/** 追加写、带 Schema 版本的 Agent 审计事件。 */
export interface ChatAgentEventBase<TType extends ChatAgentEventType> {
  /** 全局唯一 Event ID。 */
  eventId: string;
  /** 聚合内严格递增序号。 */
  sequence: number;
  /** 可选 Attempt 稳定链接。 */
  attemptId?: string;
  /** 可选 Runtime 稳定链接。 */
  runtimeId?: string;
  /** 判别 Event 类型。 */
  type: TType;
  /** ISO-8601 发生时间。 */
  occurredAt: string;
  /** 可信事件来源。 */
  source: ChatAgentEventSource;
  /** Event payload Schema 版本。 */
  schemaVersion: number;
  /** 与 type 对应的结构化 payload。 */
  payload: ChatAgentEventPayloadMap[TType];
}

/** Task Event 强制携带匹配的 Task 聚合身份。 */
export type ChatAgentTaskEvent<TType extends ChatAgentTaskEventType = ChatAgentTaskEventType> = ChatAgentEventBase<TType> & {
  aggregate: { kind: 'task'; id: string };
  taskId: string;
  checkpointId?: string;
};

/** Checkpoint Event 强制携带匹配的 Checkpoint 聚合身份。 */
export type ChatAgentCheckpointEvent<TType extends ChatAgentCheckpointEventType = ChatAgentCheckpointEventType> = ChatAgentEventBase<TType> & {
  aggregate: { kind: 'checkpoint'; id: string };
  taskId?: string;
  checkpointId: string;
};

/** 由 Event type 判别并强制聚合身份一致的审计事件。 */
export type ChatAgentEvent<TType extends ChatAgentEventType = ChatAgentEventType> = TType extends ChatAgentTaskEventType
  ? ChatAgentTaskEvent<TType>
  : TType extends ChatAgentCheckpointEventType
  ? ChatAgentCheckpointEvent<TType>
  : never;

/** Renderer 可安全展示的资源引用。 */
export interface ChatAgentTaskResourceSnapshot {
  /** 资源类型。 */
  readonly kind: AgentResourceReference['kind'];
  /** 仓库相对路径或稳定资源域标识。 */
  readonly displayReference: string;
  /** 调用方观察到的可选修订。 */
  readonly revision?: string;
}

/** 当前 Attempt 与可替换 Runtime 的展示状态。 */
export interface ChatAgentTaskAttemptSnapshot {
  /** Attempt 稳定身份。 */
  readonly attemptId: string;
  /** 从一开始的 Attempt 序号。 */
  readonly attemptNumber: number;
  /** Child Actor 稳定身份。 */
  readonly agentId: string;
  /** Attempt 自身的持久化执行状态。 */
  readonly attemptState: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled' | 'deadline_exceeded' | 'interrupted';
  /** 当前可替换 Runtime 身份。 */
  readonly runtimeId: string;
  /** Attempt 创建时间。 */
  readonly createdAt: string;
  /** Runtime 开始时间。 */
  readonly startedAt?: string;
  /** Attempt 结束时间。 */
  readonly endedAt?: string;
}

/** 经过 allowlist 转换的单条 Task 时间线。 */
export interface ChatAgentTaskTimelineEntry {
  /** Task 聚合内单调 Event sequence。 */
  readonly sequence: number;
  /** 可展示事件类别，不透传内部 Event payload。 */
  readonly type: 'status' | 'runtime' | 'tool' | 'confirmation' | 'commit' | 'warning';
  /** 稳定机器标签，由 Main 映射表生成。 */
  readonly code: string;
  /** 可选用户可读短说明。 */
  readonly summary?: string;
  /** 事件发生时间。 */
  readonly occurredAt: string;
}

/** 被截断的最近 Task 时间线窗口。 */
export interface ChatAgentTaskTimelineSnapshot {
  /** 最多最近五十条已裁剪事件。 */
  readonly entries: readonly ChatAgentTaskTimelineEntry[];
  /** entries 第一条的 sequence；空数组时省略。 */
  readonly firstSequence?: number;
  /** entries 最后一条的 sequence；空数组时省略。 */
  readonly lastSequence?: number;
  /** 更早事件是否被截断。 */
  readonly truncated: boolean;
}

/** 用户可见的单条验收结果。 */
export interface ChatAgentTaskCriterionSnapshot {
  /** 对应 Contract acceptanceCriteria 的稳定索引。 */
  readonly criterionIndex: number;
  /** Child 声明状态。 */
  readonly claimStatus: AgentCriteriaResult['claim']['status'];
  /** 独立验证状态。 */
  readonly verificationStatus: AgentCriteriaResult['verification']['status'];
  /** 来自 Child claim、但已经 Main 裁剪的摘要。 */
  readonly claimSummary: string;
}

/** 任务完成程度与摘要；和执行状态分开表达。 */
export interface ChatAgentTaskCompletionSnapshot {
  /** full、partial 或 none 的完成程度。 */
  readonly level: 'full' | 'partial' | 'none';
  /** 面向用户的紧凑摘要。 */
  readonly summary: string;
  /** 按 Contract 顺序排列的验收结果。 */
  readonly criteria: readonly ChatAgentTaskCriterionSnapshot[];
}

/** Renderer 可安全展示的深只读货币成本。 */
export interface ChatAgentMonetaryCostSnapshot {
  /** ISO-4217 货币代码；不可用时为 unknown。 */
  readonly currency: string | 'unknown';
  /** 定价版本；不可用时为 unknown。 */
  readonly pricingVersion: string | 'unknown';
  /** 估算成本；不可用时为 unknown。 */
  readonly estimated: number | 'unknown';
  /** Provider 实际成本；不可用时为 unknown。 */
  readonly actual: number | 'unknown';
}

/** Renderer 可展示的成本核算。 */
export interface ChatAgentTaskUsageSnapshot {
  /** Provider 输入 token。 */
  readonly inputTokens: number;
  /** Provider 输出 token。 */
  readonly outputTokens: number;
  /** 输入和输出 token 合计。 */
  readonly totalTokens: number;
  /** Provider 模型调用次数。 */
  readonly modelCalls: number;
  /** Agent 工具轮次。 */
  readonly toolRounds: number;
  /** 排队耗时。 */
  readonly queueDurationMs: number;
  /** 执行耗时。 */
  readonly executionDurationMs: number;
  /** 外部请求次数。 */
  readonly externalRequests: number;
  /** 没有可靠价格时保留 unknown。 */
  readonly monetaryCost: ChatAgentMonetaryCostSnapshot;
}

/** Task 卡片允许展示的错误 details 键。 */
export type ChatAgentTaskErrorDetailKey =
  | 'reason'
  | 'toolName'
  | 'expectedHash'
  | 'actualHash'
  | 'expectedVersion'
  | 'actualVersion'
  | 'status'
  | 'limit'
  | 'observed'
  | 'deadlineAt';

/** 公开的深只读结构化错误。 */
export interface ChatAgentTaskErrorSnapshot {
  /** 稳定机器错误码。 */
  readonly code: AgentTaskErrorCode;
  /** 失败协议阶段。 */
  readonly phase: AgentTaskErrorPhase;
  /** 稳定错误类别。 */
  readonly category: 'policy' | 'resource' | 'runtime' | 'protocol' | 'user' | 'integrity';
  /** 同一不可变 Contract 是否允许重试。 */
  readonly retryable: boolean;
  /** 经二次裁剪的辅助展示文本。 */
  readonly message?: string;
  /** 默认不包含资源引用、scope 或内部身份。 */
  readonly details?: Readonly<Partial<Record<ChatAgentTaskErrorDetailKey, string | number | boolean | null>>>;
}

/** 公开的深只读非终止性警告。 */
export interface ChatAgentTaskWarningSnapshot {
  /** 稳定警告码。 */
  readonly code: string;
  /** 经长度和秘密模式裁剪的展示文本。 */
  readonly message: string;
}

/** 写入 Task 的公开 changeset 阶段。 */
export type ChatAgentTaskChangesetPhase =
  | 'prepared'
  | 'awaiting_confirmation'
  | 'approved'
  | 'commit_queued'
  | 'journal_created'
  | 'mutation_applied'
  | 'finalized'
  | 'discarded'
  | 'recovery_required';

/** 写入 Task 的公开 changeset 摘要。 */
export interface ChatAgentTaskChangesetSnapshot {
  /** changeset 稳定身份。 */
  readonly changesetId: string;
  /** 用户确认和提交共同绑定的基础修订。 */
  readonly baseRevision: string;
  /** 用户确认和提交共同绑定的 diff hash。 */
  readonly diffHash: string;
  /** 规范化操作集合 hash。 */
  readonly operationSetHash: string;
  /** 仅包含工作区相对展示路径。 */
  readonly displayPaths: readonly string[];
  /** 提交协议公开阶段。 */
  readonly phase: ChatAgentTaskChangesetPhase;
}

/** 公开 artifact 的深只读 ownership。 */
export interface ChatAgentArtifactOwnerSnapshot {
  /** 来源 Task。 */
  readonly taskId: string;
  /** 来源 Child Actor。 */
  readonly agentId: string;
  /** 来源 Attempt。 */
  readonly attemptId: string;
}

/** 只允许 visibility=user 的 artifact 进入此类型。 */
export interface ChatAgentTaskArtifactSnapshot {
  /** artifact 稳定身份。 */
  readonly artifactId: string;
  /** artifact 种类。 */
  readonly kind: string;
  /** 用户可打开的稳定引用。 */
  readonly reference: string;
  /** 可选内容 hash。 */
  readonly contentHash?: string;
  /** 来源 ownership，不能由 Renderer 改写。 */
  readonly owner: ChatAgentArtifactOwnerSnapshot;
  /** 公开投影固定为 user。 */
  readonly visibility: 'user';
  /** artifact 创建时间。 */
  readonly createdAt: string;
}

/** 已持久化的 cooperative cancellation 请求摘要。 */
export interface ChatAgentTaskCancellationSnapshot {
  /** 区分单卡片取消和 Checkpoint 级联。 */
  readonly requestKind: 'single_task' | 'checkpoint_cascade';
  /** 取消请求写入 Task 聚合的时间。 */
  readonly requestedAt: string;
}

/** 列表、事件和卡片收起态使用的轻量 Task 摘要。 */
export interface ChatAgentTaskSummarySnapshot {
  /** 判别字段。 */
  readonly recordState: 'active';
  /** Task 稳定身份。 */
  readonly taskId: string;
  /** Session 稳定身份。 */
  readonly sessionId: string;
  /** Turn 稳定身份。 */
  readonly turnId: string;
  /** Checkpoint 稳定身份。 */
  readonly checkpointId: string;
  /** Assistant 消息稳定身份。 */
  readonly assistantMessageId: string;
  /** 原 Tool Part 稳定身份。 */
  readonly toolCallId: string;
  /** 当前 Child Actor。 */
  readonly agentId: string;
  /** 公开投影 Schema 版本。 */
  readonly projectionSchemaVersion: 1;
  /** Task 聚合最新已提交 Event sequence。 */
  readonly taskSequence: number;
  /** 收起态使用的任务描述。 */
  readonly task: string;
  /** Task 执行模式。 */
  readonly mode: AgentTaskMode;
  /** Task 是否阻塞 Primary 正常完成。 */
  readonly required: boolean;
  /** Task 调度优先级。 */
  readonly priority: AgentTaskPriority;
  /** Task 可选绝对截止时间。 */
  readonly deadlineAt?: string;
  /** 当前执行状态。 */
  readonly status: AgentTaskStatus;
  /** 当前可选排队阶段。 */
  readonly queuePhase?: AgentTaskQueuePhase;
  /** 当前可选 Attempt 投影。 */
  readonly currentAttempt?: ChatAgentTaskAttemptSnapshot;
  /** 已记录的取消请求；没有请求时省略。 */
  readonly cancellation?: ChatAgentTaskCancellationSnapshot;
  /** 经 Main 生成或裁剪的一句进度或终态摘要。 */
  readonly summary?: string;
  /** Task 不可变创建时间。 */
  readonly createdAt: string;
  /** 投影更新时间。 */
  readonly updatedAt: string;
}

/** 展开卡片通过定向查询取得的完整公开投影。 */
export interface ChatAgentTaskDetailSnapshot extends ChatAgentTaskSummarySnapshot {
  /** Contract 的用户可见验收标准。 */
  readonly acceptanceCriteria: readonly string[];
  /** Contract 的用户可见资源。 */
  readonly resources: readonly ChatAgentTaskResourceSnapshot[];
  /** 最近五十条连续已裁剪 Task Event。 */
  readonly timeline: ChatAgentTaskTimelineSnapshot;
  /** 可选终态或进度完成信息。 */
  readonly completion?: ChatAgentTaskCompletionSnapshot;
  /** 非终止性公开警告。 */
  readonly warnings: readonly ChatAgentTaskWarningSnapshot[];
  /** 可选公开结构化错误。 */
  readonly error?: ChatAgentTaskErrorSnapshot;
  /** 可选公开成本核算。 */
  readonly usage?: ChatAgentTaskUsageSnapshot;
  /** 可选公开 changeset 摘要。 */
  readonly changeset?: ChatAgentTaskChangesetSnapshot;
  /** visibility=user 的公开 artifacts。 */
  readonly artifacts: readonly ChatAgentTaskArtifactSnapshot[];
}

/** 显式查询 tombstone 时返回的最小标记。 */
export interface ChatAgentTaskTombstoneSnapshot {
  /** 判别字段。 */
  readonly recordState: 'tombstoned';
  /** Task 稳定身份。 */
  readonly taskId: string;
  /** Session 稳定身份。 */
  readonly sessionId: string;
  /** Turn 稳定身份。 */
  readonly turnId: string;
  /** Checkpoint 稳定身份。 */
  readonly checkpointId: string;
  /** Assistant 消息稳定身份。 */
  readonly assistantMessageId: string;
  /** 原 Tool Part 稳定身份。 */
  readonly toolCallId: string;
  /** 公开投影 Schema 版本。 */
  readonly projectionSchemaVersion: 1;
  /** tombstone Event sequence。 */
  readonly taskSequence: number;
  /** 记录移除时间。 */
  readonly updatedAt: string;
}

/** 列表分页返回的非 tombstone 摘要。 */
export type ChatAgentTaskListSnapshot = ChatAgentTaskSummarySnapshot;

/** Application Event 可携带的轻量更新。 */
export type ChatAgentTaskEventSnapshot = ChatAgentTaskSummarySnapshot | ChatAgentTaskTombstoneSnapshot;

/** 定向查询可返回的详情或 tombstone。 */
export type ChatAgentTaskSnapshot = ChatAgentTaskDetailSnapshot | ChatAgentTaskTombstoneSnapshot;

/** 按 Session 恢复 Task 投影。 */
export interface ChatAgentListTasksInput {
  /** 当前聊天 Session。 */
  readonly sessionId: string;
  /** Main 生成的可选历史分页游标。 */
  readonly cursor?: string;
  /** 请求页大小，默认五十、最大一百。 */
  readonly limit?: number;
}

/** 定向恢复单个 Task，包括 tombstone。 */
export interface ChatAgentGetTaskInput {
  /** Task 所属 Session，用于防止跨 Session 枚举。 */
  readonly sessionId: string;
  /** 目标 Task。 */
  readonly taskId: string;
}

/** 请求协作取消单个 Task。 */
export interface ChatAgentCancelTaskInput {
  /** Task 所属 Session。 */
  readonly sessionId: string;
  /** 目标 Task。 */
  readonly taskId: string;
}

/** 默认 Session 查询的一页轻量摘要。 */
export interface ChatAgentListTasksResult {
  /** 第一页先包含全部活动 Task，再包含一页最近终态 Task。 */
  readonly tasks: readonly ChatAgentTaskListSnapshot[];
  /** 仍有更早终态 Task 时由 Main 生成。 */
  readonly nextCursor?: string;
}

/** 定向查询允许返回最小 tombstone；不存在或 Session 不匹配时返回 null。 */
export type ChatAgentGetTaskResult = ChatAgentTaskSnapshot | null;

/** 单 Task 取消命令的权威处理结果。 */
export interface ChatAgentCancelTaskResult {
  /** 取消请求已记录、提交正在收敛，或 Task 原本已终态。 */
  readonly disposition: 'cancel_requested' | 'commit_in_progress' | 'already_settled';
  /** 命令处理完成时重新投影的 Task。 */
  readonly task: ChatAgentTaskSummarySnapshot;
}

/**
 * Renderer 可见的 Checkpoint allowlist 投影。
 * 不包含 continuation、模型、工具结果、artifact、错误消息或其他内部执行事实。
 */
export interface ChatAgentCheckpointSnapshot {
  /** Checkpoint 稳定身份。 */
  readonly checkpointId: string;
  /** 所属会话。 */
  readonly sessionId: string;
  /** 所属 Turn。 */
  readonly turnId: string;
  /** Primary Actor 身份。 */
  readonly primaryAgentId: string;
  /** Turn 根 Runtime。 */
  readonly rootRuntimeId: string;
  /** 已挂起的 Runtime A。 */
  readonly sourceRuntimeId: string;
  /** 当前权威状态。 */
  readonly status: AgentCheckpointStatus;
  /** Checkpoint CAS 版本。 */
  readonly version: number;
  /** CAS claim 后唯一 Runtime B。 */
  readonly resumeRuntimeId?: string;
  /** Checkpoint 事件流的持久化 cursor。 */
  readonly checkpointSequence: number;
  /** 不可变创建时间。 */
  readonly createdAt: string;
  /** 投影更新时间。 */
  readonly updatedAt: string;
}

/**
 * Renderer 可见的 confirmation allowlist 投影。
 * 私有 overlay 引用、候选文件和 rollback 内容不得跨越 Main 边界。
 */
export interface ChatAgentConfirmationSnapshot {
  /** confirmation 稳定身份。 */
  readonly confirmationId: string;
  /** 所属会话。 */
  readonly sessionId: string;
  /** 所属 Turn。 */
  readonly turnId: string;
  /** 所属 Child Task。 */
  readonly taskId: string;
  /** 产生 changeset 的 Attempt。 */
  readonly attemptId: string;
  /** 所属 Child Actor。 */
  readonly agentId: string;
  /** 产生 changeset 的 Runtime。 */
  readonly runtimeId: string;
  /** 原始 delegate_task tool-call。 */
  readonly toolCallId: string;
  /** 待确认 changeset。 */
  readonly changesetId: string;
  /** confirmation 当前权威状态。 */
  readonly status: AgentConfirmationStatus;
  /** confirmation CAS 版本。 */
  readonly version: number;
  /** 用户风险提示等级。 */
  readonly riskLevel: 'write' | 'dangerous';
  /** 面向用户展示的 workspace 相对路径。 */
  readonly displayPaths: readonly string[];
  /** Main 授权的资源 scopes。 */
  readonly resourceScopes: readonly string[];
  /** 已通过 diffHash 校验的文本 unified diff。 */
  readonly unifiedDiff: string;
  /** 绑定的基础修订。 */
  readonly baseRevision: string;
  /** 完整 diff 完整性 hash。 */
  readonly diffHash: string;
  /** 规范化操作集合 hash。 */
  readonly operationSetHash: string;
  /** 绑定的 Execution Plan hash。 */
  readonly planHash: string;
  /** 不可变请求时间。 */
  readonly createdAt: string;
  /** 权威投影更新时间。 */
  readonly updatedAt: string;
}

/** Renderer 重载恢复所需的公开委派投影。 */
export type ChatAgentRecoverySnapshot = ChatAgentCheckpointSnapshot;

/** Renderer 请求 CAS 启动 Primary Runtime B 的最小输入。 */
export interface ChatAgentResumePrimaryInput {
  /** ready Checkpoint。 */
  readonly checkpointId: string;
  /** Renderer 观察到的 CAS 版本。 */
  readonly expectedVersion: number;
  /** Renderer 预注册的 Runtime B 身份提议。 */
  readonly resumeRuntimeId: string;
}

/** Renderer 请求 cooperative cancellation 的最小输入。 */
export interface ChatAgentCancelCheckpointInput {
  /** 目标 Checkpoint。 */
  readonly checkpointId: string;
}

/** Renderer 请求 CAS 决议 confirmation 的最小输入。 */
export interface ChatAgentResolveConfirmationInput {
  /** 目标 confirmation。 */
  readonly confirmationId: string;
  /** Renderer 观察到的 CAS 版本。 */
  readonly expectedVersion: number;
  /** 仅允许一次性批准或拒绝。 */
  readonly decision: 'approved' | 'rejected';
}

/** Primary Runtime B 已启动或已由其他窗口启动的权威结果。 */
export interface ChatAgentActiveResumeResult {
  /** 本调用取得 claim，或观察到同一 Runtime 已被 claim。 */
  readonly status: 'started' | 'already_started';
  /** claim 后的公开 Checkpoint 投影。 */
  readonly checkpoint: ChatAgentCheckpointSnapshot;
  /** 从持久化身份派生的完整 Runtime B 地址。 */
  readonly address: ChatRuntimeAddress;
}

/** Renderer 重试时观察到 Checkpoint 已经终态化的权威结果。 */
export interface ChatAgentSettledResumeResult {
  /** settled 结果不得再次启动 Runtime。 */
  readonly status: 'settled';
  /** 当前终态 Checkpoint 投影。 */
  readonly checkpoint: ChatAgentCheckpointSnapshot & {
    readonly status: 'completed' | 'failed' | 'cancelled' | 'interrupted';
  };
  /** completed/failed 且存在 Runtime B 时可返回其派生地址。 */
  readonly address?: ChatRuntimeAddress;
}

/** Resume IPC 的启动或幂等终态观察结果。 */
export type ChatAgentResumeResult = ChatAgentActiveResumeResult | ChatAgentSettledResumeResult;

/** 应用级持久化 Checkpoint 事件。 */
export interface ChatAgentCheckpointApplicationEvent {
  /** Application event schema 版本。 */
  readonly schemaVersion: 1;
  /** 权威 Checkpoint 更新。 */
  readonly type: 'checkpoint.updated';
  /** 不含敏感执行事实的 Checkpoint 投影。 */
  readonly checkpoint: ChatAgentCheckpointSnapshot;
  /** 与 Checkpoint 投影一致的单调 cursor。 */
  readonly checkpointSequence: number;
}

/** 应用级持久化 confirmation 事件。 */
export interface ChatAgentConfirmationApplicationEvent {
  /** Application event schema 版本。 */
  readonly schemaVersion: 1;
  /** 权威 confirmation 更新。 */
  readonly type: 'confirmation.updated';
  /** 已通过 Main allowlist 与 diff integrity 校验的投影。 */
  readonly confirmation: ChatAgentConfirmationSnapshot;
}

/** 应用级已提交 Task 轻量投影事件。 */
export interface ChatAgentTaskUpdatedEvent {
  /** Application event schema 版本。 */
  readonly schemaVersion: 1;
  /** 权威 Task 更新。 */
  readonly type: 'task.updated';
  /** 不含敏感详情的 Summary 或 Tombstone。 */
  readonly task: ChatAgentTaskEventSnapshot;
  /** 与 Task 投影一致的单调 cursor。 */
  readonly taskSequence: number;
}

/** 由事件类型判别的应用级 Agent 投影事件。 */
export type ChatAgentApplicationEvent = ChatAgentCheckpointApplicationEvent | ChatAgentConfirmationApplicationEvent | ChatAgentTaskUpdatedEvent;

/** Chat Agent IPC 统一结果。 */
export type ChatAgentHandlerResult<T> = { ok: true; data: T } | { ok: false; error: string; code: string };
