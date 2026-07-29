/**
 * @file bubble-part-agent.component.test.ts
 * @description Child Agent 轻量任务卡片的身份匹配、恢复、状态与安全回退测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import type { ChatMessageToolPart } from 'types/chat';
import type {
  AgentTaskQueuePhase,
  AgentTaskStatus,
  ChatAgentCancelTaskResult,
  ChatAgentConfirmationSnapshot,
  ChatAgentGetTaskResult,
  ChatAgentHandlerResult,
  ChatAgentTaskDetailSnapshot,
  ChatAgentTaskSummarySnapshot,
  ChatAgentTaskTombstoneSnapshot
} from 'types/chat-agent';
import { defineComponent, nextTick } from 'vue';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BubblePartAgent from '@/components/BChat/components/MessageBubble/BubblePartAgent/index.vue';
import { readTaskResultId, readTaskResultStatus } from '@/components/BChat/utils/agentTaskPart';
import { createTaskIndexKey, useChatAgentTaskStore } from '@/stores/chat/agentTask';
import { useChatConfirmationQueueStore } from '@/stores/chat/confirmationQueue';

/** Agent Task IPC 测试边界。 */
const agentAPI = vi.hoisted(() => ({
  getTask: vi.fn(),
  listConfirmations: vi.fn(),
  cancelTask: vi.fn()
}));

/** Artifact 导航测试边界。 */
const routerAPI = vi.hoisted(() => ({
  push: vi.fn()
}));

/** 日志测试边界。 */
const loggerAPI = vi.hoisted(() => ({
  error: vi.fn()
}));

vi.mock('@/shared/platform/electron-api', () => ({
  getElectronAPI: (): Record<string, unknown> => ({
    chatAgentGetTask: agentAPI.getTask,
    chatAgentListConfirmations: agentAPI.listConfirmations,
    chatAgentCancelTask: agentAPI.cancelTask
  })
}));

vi.mock('@/router', () => ({
  default: routerAPI
}));

vi.mock('@/shared/logger', () => ({
  logger: loggerAPI
}));

vi.mock('@/hooks/useNavigate', () => ({
  useNavigate: vi.fn(() => ({
    openFile: vi.fn(),
    openSkill: vi.fn(),
    openWebview: vi.fn()
  }))
}));

/** BIcon 展示壳，保留图标语义供断言。 */
const BIconStub = defineComponent({
  name: 'BIcon',
  props: {
    icon: {
      type: String,
      required: true
    },
    size: {
      type: Number,
      default: 16
    }
  },
  template: '<i class="icon-stub" :data-icon="icon" />'
});

/** 文本截断展示壳。 */
const BTruncateTextStub = defineComponent({
  name: 'BTruncateText',
  props: {
    text: {
      type: String,
      default: ''
    }
  },
  template: '<span>{{ text }}</span>'
});

/** Markdown 展示壳，避免安全回退依赖应用级全局注册。 */
const BMessageStub = defineComponent({
  name: 'BMessage',
  props: {
    content: {
      type: String,
      default: ''
    }
  },
  template: '<div>{{ content }}</div>'
});

/** 可手动完成的测试 Promise。 */
interface Deferred<T> {
  /** 未决 Promise。 */
  promise: Promise<T>;
  /** 完成 Promise。 */
  resolve: (value: T) => void;
  /** 拒绝 Promise。 */
  reject: (reason?: unknown) => void;
}

/** 卡片挂载结果。 */
interface CardHarness {
  /** 测试 Pinia。 */
  pinia: Pinia;
  /** Vue 组件包装器。 */
  wrapper: VueWrapper;
}

/**
 * 创建可手动完成的 Promise。
 * @returns Deferred 控制器
 */
function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = (): void => undefined;
  let rejectPromise: (reason?: unknown) => void = (): void => undefined;
  const promise = new Promise<T>((resolve, reject): void => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

/**
 * 创建公开 Task Summary。
 * @param patch - 可覆盖字段
 * @returns 完整公开 Summary
 */
function createSummary(patch: Partial<ChatAgentTaskSummarySnapshot> = {}): ChatAgentTaskSummarySnapshot {
  return {
    recordState: 'active',
    taskId: 'task-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    checkpointId: 'checkpoint-1',
    assistantMessageId: 'assistant-1',
    toolCallId: 'tool-call-1',
    agentId: 'agent-1',
    projectionSchemaVersion: 1,
    taskSequence: 1,
    task: '检查 Renderer 投影',
    mode: 'read',
    required: true,
    priority: 'normal',
    status: 'running',
    summary: '正在检查复合索引',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:01.000Z',
    ...patch
  };
}

/**
 * 创建公开 Task Detail。
 * @param patch - 可覆盖字段
 * @returns 完整公开 Detail
 */
function createDetail(patch: Partial<ChatAgentTaskDetailSnapshot> = {}): ChatAgentTaskDetailSnapshot {
  return {
    ...createSummary(patch),
    acceptanceCriteria: ['投影匹配原 Tool Part'],
    resources: [],
    timeline: {
      entries: [],
      truncated: false
    },
    warnings: [],
    artifacts: [],
    ...patch
  };
}

/**
 * 创建覆盖全部公开 section 的 Task Detail。
 * @param patch - 可覆盖字段
 * @returns 完整公开 Detail
 */
function createFullDetail(patch: Partial<ChatAgentTaskDetailSnapshot> = {}): ChatAgentTaskDetailSnapshot {
  return createDetail({
    currentAttempt: {
      attemptId: 'attempt-1',
      attemptNumber: 1,
      agentId: 'agent-1',
      attemptState: 'running',
      runtimeId: 'runtime-1',
      createdAt: '2026-07-28T00:00:00.000Z',
      startedAt: '2026-07-28T00:00:01.000Z'
    },
    resources: [
      {
        kind: 'file',
        displayReference: 'src/example.ts',
        revision: 'revision-1'
      }
    ],
    timeline: {
      entries: [
        {
          sequence: 1,
          type: 'runtime',
          code: 'runtime.started',
          summary: '已启动公开 Runtime',
          occurredAt: '2026-07-28T00:00:01.000Z',
          payload: 'SECRET_RAW_PAYLOAD',
          input: 'SECRET_RAW_INPUT',
          output: 'SECRET_RAW_OUTPUT'
        }
      ],
      firstSequence: 1,
      lastSequence: 1,
      truncated: true
    },
    completion: {
      level: 'full',
      summary: 'Child 声明完成',
      criteria: [
        {
          criterionIndex: 0,
          claimStatus: 'satisfied',
          verificationStatus: 'contradicted',
          claimSummary: 'Child 声明满足'
        }
      ]
    },
    warnings: [{ code: 'warning-code', message: '公开告警' }],
    error: {
      code: 'runtime_failed',
      phase: 'runtime',
      category: 'runtime',
      retryable: false,
      message: '辅助错误说明',
      details: {
        reason: '公开原因',
        toolName: 'read_file',
        secret: 'SECRET_ERROR_DETAIL'
      }
    },
    usage: {
      inputTokens: 0,
      outputTokens: 2,
      totalTokens: 2,
      modelCalls: 1,
      toolRounds: 1,
      queueDurationMs: 10,
      executionDurationMs: 20,
      externalRequests: 0,
      monetaryCost: {
        currency: 'unknown',
        pricingVersion: 'unknown',
        estimated: 'unknown',
        actual: 'unknown'
      }
    },
    changeset: {
      changesetId: 'changeset-1',
      baseRevision: 'base-1',
      diffHash: 'diff-1',
      operationSetHash: 'ops-1',
      displayPaths: ['src/example.ts'],
      phase: 'awaiting_confirmation'
    },
    artifacts: [
      {
        artifactId: 'artifact-visible',
        kind: 'document',
        reference: 'document-1',
        owner: {
          taskId: 'task-1',
          agentId: 'agent-1',
          attemptId: 'attempt-1'
        },
        visibility: 'user',
        createdAt: '2026-07-28T00:00:02.000Z'
      },
      {
        artifactId: 'artifact-forged',
        kind: 'document',
        reference: 'document-forged',
        owner: {
          taskId: 'task-other',
          agentId: 'agent-1',
          attemptId: 'attempt-1'
        },
        visibility: 'user',
        createdAt: '2026-07-28T00:00:02.000Z'
      }
    ],
    ...patch
  } as Partial<ChatAgentTaskDetailSnapshot>);
}

/**
 * 创建确认快照。
 * @param patch - 可覆盖字段
 * @returns 完整公开 confirmation
 */
function createConfirmation(patch: Partial<ChatAgentConfirmationSnapshot> = {}): ChatAgentConfirmationSnapshot {
  return {
    confirmationId: 'confirmation-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    taskId: 'task-1',
    attemptId: 'attempt-1',
    agentId: 'agent-1',
    runtimeId: 'runtime-1',
    toolCallId: 'tool-call-1',
    changesetId: 'changeset-1',
    status: 'pending',
    version: 1,
    riskLevel: 'write',
    displayPaths: ['src/example.ts'],
    resourceScopes: ['file:/workspace/src/example.ts'],
    unifiedDiff: '--- a/src/example.ts\n+++ b/src/example.ts',
    baseRevision: 'base-1',
    diffHash: 'diff-1',
    operationSetHash: 'ops-1',
    planHash: 'plan-1',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    ...patch
  };
}

/**
 * 创建公开 Task tombstone。
 * @param patch - 可覆盖字段
 * @returns 最小 tombstone
 */
function createTombstone(patch: Partial<ChatAgentTaskTombstoneSnapshot> = {}): ChatAgentTaskTombstoneSnapshot {
  return {
    recordState: 'tombstoned',
    taskId: 'task-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    checkpointId: 'checkpoint-1',
    assistantMessageId: 'assistant-1',
    toolCallId: 'tool-call-1',
    projectionSchemaVersion: 1,
    taskSequence: 2,
    updatedAt: '2026-07-28T00:00:05.000Z',
    ...patch
  };
}

/**
 * 创建 delegate_task Tool Part。
 * @param patch - 可覆盖字段
 * @returns 完整 Tool Part
 */
function createTaskPart(patch: Partial<ChatMessageToolPart> = {}): ChatMessageToolPart {
  return {
    id: 'part-task-1',
    type: 'tool',
    toolCallId: 'tool-call-1',
    toolName: 'delegate_task',
    status: 'executing',
    input: {
      task: 'SECRET_INPUT_SHOULD_NOT_RENDER'
    },
    ...patch
  };
}

/**
 * 创建成功 Tool Result 的任务片段。
 * @param taskId - Result 中的 Task 身份
 * @param dataPatch - Result data 扩展字段
 * @returns 终态 Tool Part
 */
function createSuccessPart(taskId: string, dataPatch: Record<string, unknown> = {}): ChatMessageToolPart {
  return createTaskPart({
    status: 'done',
    result: {
      toolName: 'delegate_task',
      status: 'success',
      data: {
        taskId,
        ...dataPatch
      }
    }
  });
}

/**
 * 创建成功 IPC 信封。
 * @param snapshot - 定向 Task 快照
 * @returns IPC handler 结果
 */
function createTaskResult(snapshot: ChatAgentGetTaskResult): ChatAgentHandlerResult<ChatAgentGetTaskResult> {
  return {
    ok: true,
    data: snapshot
  };
}

/**
 * 挂载真实 Store 驱动的任务卡片。
 * @param part - 原始 Tool Part
 * @param sessionId - 权威 Session
 * @param assistantMessageId - 原 Assistant 消息
 * @returns 卡片测试容器
 */
function mountTaskCard(part: ChatMessageToolPart = createTaskPart(), sessionId: string | null = 'session-1', assistantMessageId = 'assistant-1'): CardHarness {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(BubblePartAgent, {
    props: {
      sessionId,
      assistantMessageId,
      part
    },
    global: {
      plugins: [pinia],
      stubs: {
        BIcon: BIconStub,
        BMessage: BMessageStub,
        BTruncateText: BTruncateTextStub
      }
    }
  });
  return { pinia, wrapper };
}

/**
 * 使用现有 Pinia 挂载任务卡片。
 * @param pinia - 已写入投影的 Pinia
 * @param part - 原始 Tool Part
 * @param sessionId - 权威 Session
 * @param assistantMessageId - 原 Assistant 消息
 * @returns Vue 组件包装器
 */
function mountWithPinia(
  pinia: Pinia,
  part: ChatMessageToolPart = createTaskPart(),
  sessionId: string | null = 'session-1',
  assistantMessageId = 'assistant-1'
): VueWrapper {
  setActivePinia(pinia);
  return mount(BubblePartAgent, {
    props: {
      sessionId,
      assistantMessageId,
      part
    },
    global: {
      plugins: [pinia],
      stubs: {
        BIcon: BIconStub,
        BMessage: BMessageStub,
        BTruncateText: BTruncateTextStub
      }
    }
  });
}

/**
 * 在新 Pinia 中预先应用一个 Task 投影后挂载。
 * @param snapshot - 待应用投影
 * @param part - Tool Part
 * @returns 卡片测试容器
 */
function mountProjected(snapshot: ChatAgentTaskSummarySnapshot | ChatAgentTaskTombstoneSnapshot, part: ChatMessageToolPart = createTaskPart()): CardHarness {
  const pinia = createPinia();
  setActivePinia(pinia);
  useChatAgentTaskStore().applySummary(snapshot);
  return {
    pinia,
    wrapper: mountWithPinia(pinia, part)
  };
}

describe('readTaskResultId', (): void => {
  it('accepts only a done success result with an own plain data taskId', (): void => {
    expect(readTaskResultId(createSuccessPart('task-1'))).toBe('task-1');
    expect(readTaskResultId(createSuccessPart('任務-😀'))).toBe('任務-😀');
    expect(readTaskResultId(createSuccessPart('x'.repeat(160)))).toBe('x'.repeat(160));
  });

  it('rejects invalid lifecycle, result and data shapes', (): void => {
    const inheritedResult = Object.create({
      result: createSuccessPart('task-inherited').result
    }) as Record<string, unknown>;
    Object.assign(inheritedResult, createTaskPart({ status: 'done', result: undefined }));
    delete inheritedResult.result;

    const inheritedData = Object.create({ taskId: 'task-inherited' }) as Record<string, unknown>;
    const inheritedTask = createTaskPart({
      status: 'done',
      result: {
        toolName: 'delegate_task',
        status: 'success',
        data: inheritedData
      }
    });

    expect(readTaskResultId(createTaskPart({ status: 'executing', result: createSuccessPart('task-1').result }))).toBeUndefined();
    expect(
      readTaskResultId(
        createTaskPart({
          status: 'done',
          result: {
            toolName: 'delegate_task',
            status: 'failure',
            error: {
              code: 'EXECUTION_FAILED',
              message: 'failed'
            }
          }
        })
      )
    ).toBeUndefined();
    expect(readTaskResultId(inheritedResult as unknown as ChatMessageToolPart)).toBeUndefined();
    expect(readTaskResultId(inheritedTask)).toBeUndefined();
    expect(readTaskResultId(createSuccessPart(' task-1'))).toBeUndefined();
    expect(readTaskResultId(createSuccessPart('task-1 '))).toBeUndefined();
    expect(readTaskResultId(createSuccessPart('task-\n1'))).toBeUndefined();
    expect(readTaskResultId(createSuccessPart('task-\u00851'))).toBeUndefined();
    expect(readTaskResultId(createSuccessPart('x'.repeat(161)))).toBeUndefined();
  });

  it('rejects inherited, boxed and accessor task identities without invoking getters', (): void => {
    const inheritedTaskId = Object.create({ taskId: 'task-inherited' }) as Record<string, unknown>;
    const boxedPart = createSuccessPart('task-1');
    if (boxedPart.result?.status === 'success') {
      boxedPart.result.data = { taskId: Object('task-boxed') };
    }
    const accessorData: Record<string, unknown> = {};
    const taskGetter = vi.fn((): string => {
      throw new Error('task getter must not run');
    });
    Object.defineProperty(accessorData, 'taskId', {
      enumerable: true,
      get: taskGetter
    });

    expect(
      readTaskResultId(
        createTaskPart({
          status: 'done',
          result: {
            toolName: 'delegate_task',
            status: 'success',
            data: inheritedTaskId
          }
        })
      )
    ).toBeUndefined();
    expect(readTaskResultId(boxedPart)).toBeUndefined();
    expect(
      readTaskResultId(
        createTaskPart({
          status: 'done',
          result: {
            toolName: 'delegate_task',
            status: 'success',
            data: accessorData
          }
        })
      )
    ).toBeUndefined();
    expect(taskGetter).not.toHaveBeenCalled();
  });

  it('fails closed when defensive Proxy reflection throws', (): void => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const part = createTaskPart({
      status: 'done',
      result: revoked.proxy as unknown as ChatMessageToolPart['result']
    });

    expect((): string | undefined => readTaskResultId(part)).not.toThrow();
    expect(readTaskResultId(part)).toBeUndefined();
  });

  it('reads Result status through own data descriptors without invoking accessors', (): void => {
    const statusGetter = vi.fn((): string => 'success');
    const result: Record<string, unknown> = {};
    Object.defineProperty(result, 'status', {
      enumerable: true,
      get: statusGetter
    });
    const part = createTaskPart({
      status: 'done',
      result: result as unknown as ChatMessageToolPart['result']
    });

    expect(readTaskResultStatus(part)).toBeUndefined();
    expect(statusGetter).not.toHaveBeenCalled();
  });
});

describe('BubblePartAgent', (): void => {
  beforeEach((): void => {
    agentAPI.getTask.mockReset();
    agentAPI.listConfirmations.mockReset();
    agentAPI.cancelTask.mockReset();
    routerAPI.push.mockReset();
    routerAPI.push.mockResolvedValue(undefined);
    loggerAPI.error.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T00:00:10.000Z'));
  });

  afterEach((): void => {
    vi.useRealTimers();
  });

  it('renders a running Task from the composite index without directed IPC', (): void => {
    const { wrapper } = mountProjected(createSummary());

    expect(wrapper.classes()).toContain('b-agent-task-card');
    expect(wrapper.text()).toContain('只读');
    expect(wrapper.text()).toContain('检查 Renderer 投影');
    expect(wrapper.text()).toContain('运行中');
    expect(wrapper.text()).toContain('普通优先级');
    expect(wrapper.text()).toContain('正在检查复合索引');
    expect(wrapper.text()).toContain('约 10 秒');
    expect(wrapper.find('[data-icon="lucide:play-circle"]').exists()).toBe(true);
    expect(agentAPI.getTask).not.toHaveBeenCalled();
  });

  it('does not optimistically mutate status while a Task cancellation is pending', async (): Promise<void> => {
    const cancellation = createDeferred<ChatAgentHandlerResult<ChatAgentCancelTaskResult>>();
    agentAPI.cancelTask.mockReturnValue(cancellation.promise);
    const { wrapper } = mountProjected(createSummary());
    const taskStore = useChatAgentTaskStore();
    const button = wrapper.find('[data-action="cancel-task"]');

    expect(button.exists()).toBe(true);
    await button.trigger('click');

    expect(agentAPI.cancelTask).toHaveBeenCalledWith({ sessionId: 'session-1', taskId: 'task-1' });
    expect(button.attributes('disabled')).toBeDefined();
    expect(taskStore.tasksById['task-1']).toMatchObject({
      status: 'running',
      taskSequence: 1
    });
    expect(taskStore.tasksById['task-1']?.recordState === 'active' ? taskStore.tasksById['task-1'].cancellation : undefined).toBeUndefined();
    expect(wrapper.text()).toContain('运行中');
    expect(wrapper.text()).not.toContain('取消中');
  });

  it('applies only the authoritative cancellation Summary returned by Main', async (): Promise<void> => {
    const updated = createSummary({
      status: 'cancelling',
      taskSequence: 2,
      cancellation: {
        requestKind: 'single_task',
        requestedAt: '2026-07-28T00:00:11.000Z'
      },
      updatedAt: '2026-07-28T00:00:11.000Z'
    });
    agentAPI.cancelTask.mockResolvedValue({
      ok: true,
      data: {
        disposition: 'cancel_requested',
        task: updated
      }
    });
    const { wrapper } = mountProjected(createSummary());
    const taskStore = useChatAgentTaskStore();

    await wrapper.find('[data-action="cancel-task"]').trigger('click');
    await flushPromises();

    expect(taskStore.tasksById['task-1']).toEqual(updated);
    expect(wrapper.text()).toContain('取消中');
    expect(wrapper.text()).toContain('取消已请求');
    expect(wrapper.find('[data-action="cancel-task"]').attributes('disabled')).toBeDefined();
  });

  it('warns that a committing Task may no longer be interruptible', (): void => {
    const { wrapper } = mountProjected(createSummary({ status: 'committing' }));

    expect(wrapper.find('[data-action="cancel-task"]').text()).toBe('请求取消');
    expect(wrapper.text()).toContain('提交可能已无法中断');
  });

  it('keeps the current Summary on cancellation failure and exposes only a stable local error', async (): Promise<void> => {
    agentAPI.cancelTask.mockResolvedValue({
      ok: false,
      error: 'SECRET_CANCEL_FAILURE',
      code: 'CANCEL_FAILED'
    });
    const baseline = createSummary();
    const { wrapper } = mountProjected(baseline);
    const taskStore = useChatAgentTaskStore();

    await wrapper.find('[data-action="cancel-task"]').trigger('click');
    await flushPromises();

    expect(taskStore.tasksById['task-1']).toEqual(baseline);
    expect(wrapper.text()).toContain('agent_task_cancel_failed');
    expect(wrapper.html()).not.toContain('SECRET_CANCEL_FAILURE');
  });

  it('ignores a late cancellation response after the card identity changes', async (): Promise<void> => {
    const cancellation = createDeferred<ChatAgentHandlerResult<ChatAgentCancelTaskResult>>();
    agentAPI.cancelTask.mockReturnValue(cancellation.promise);
    const baseline = createSummary();
    const { wrapper } = mountProjected(baseline);
    const taskStore = useChatAgentTaskStore();
    await wrapper.find('[data-action="cancel-task"]').trigger('click');

    await wrapper.setProps({ sessionId: 'session-2' });
    cancellation.resolve({
      ok: true,
      data: {
        disposition: 'cancel_requested',
        task: createSummary({
          status: 'cancelling',
          taskSequence: 2,
          cancellation: {
            requestKind: 'single_task',
            requestedAt: '2026-07-28T00:00:11.000Z'
          }
        })
      }
    });
    await flushPromises();

    expect(taskStore.tasksById['task-1']).toEqual(baseline);
  });

  it('loads Detail only on first expansion and reuses the trusted cached sequence', async (): Promise<void> => {
    const { wrapper } = mountProjected(createSummary());
    agentAPI.getTask.mockResolvedValue(createTaskResult(createFullDetail()));

    await wrapper.find('[data-action="toggle-detail"]').trigger('click');
    await flushPromises();
    expect(agentAPI.getTask).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-section="contract"]').exists()).toBe(true);

    await wrapper.find('[data-action="toggle-detail"]').trigger('click');
    await wrapper.find('[data-action="toggle-detail"]').trigger('click');
    await flushPromises();
    expect(agentAPI.getTask).toHaveBeenCalledOnce();
  });

  it('invalidates old Detail on a newer Summary and performs one bounded follow-up after an obsolete flight', async (): Promise<void> => {
    const first = createDeferred<ChatAgentHandlerResult<ChatAgentGetTaskResult>>();
    agentAPI.getTask
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(createTaskResult(createFullDetail({ taskSequence: 3, acceptanceCriteria: ['最新详情标准'] })));
    const { pinia, wrapper } = mountProjected(createSummary());

    await wrapper.find('[data-action="toggle-detail"]').trigger('click');
    setActivePinia(pinia);
    useChatAgentTaskStore().applySummary(createSummary({ taskSequence: 2, summary: '最新摘要', updatedAt: '2026-07-28T00:00:02.000Z' }));
    useChatAgentTaskStore().applySummary(createSummary({ taskSequence: 3, summary: '最终摘要', updatedAt: '2026-07-28T00:00:03.000Z' }));
    first.resolve(createTaskResult(createFullDetail({ taskSequence: 1, summary: '过期详情' })));
    await flushPromises();
    await flushPromises();

    expect(agentAPI.getTask).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('最新详情标准');
    expect(wrapper.text()).not.toContain('过期详情');
  });

  it('renders the fixed public Detail order without raw fields or forged artifacts', async (): Promise<void> => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useChatAgentTaskStore().applyDetail(createFullDetail({ status: 'completed' }));
    const wrapper = mountWithPinia(pinia);

    await wrapper.find('[data-action="toggle-detail"]').trigger('click');
    await flushPromises();
    const sections = wrapper.findAll('[data-section]').map((section): string | undefined => section.attributes('data-section'));

    expect(sections).toEqual(['contract', 'execution', 'timeline', 'completion', 'usage', 'changeset', 'artifacts']);
    expect(wrapper.text()).toContain('更早事件已截断');
    expect(wrapper.text()).toContain('contradicted');
    expect(wrapper.text()).toContain('runtime_failed');
    expect(wrapper.text()).toContain('runtime');
    expect(wrapper.text()).toContain('不可重试');
    expect(wrapper.text()).toContain('未知');
    expect(wrapper.text()).not.toContain('$0');
    expect(wrapper.html()).not.toContain('SECRET_RAW_PAYLOAD');
    expect(wrapper.html()).not.toContain('SECRET_RAW_INPUT');
    expect(wrapper.html()).not.toContain('SECRET_RAW_OUTPUT');
    expect(wrapper.html()).not.toContain('SECRET_ERROR_DETAIL');
    expect(wrapper.html()).not.toContain('document-forged');
    expect(wrapper.findAll('.b-agent-task-card__open-artifact')).toHaveLength(1);
    expect(wrapper.find('.b-agent-task-card__criterion--contradicted').exists()).toBe(true);
  });

  it('renders all public contract, attempt and usage accounting fields with unknown distinct from zero', async (): Promise<void> => {
    const detail = createFullDetail({
      mode: 'write',
      priority: 'high',
      required: false,
      deadlineAt: '2026-07-29T00:00:00.000Z',
      status: 'completed',
      currentAttempt: {
        attemptId: 'attempt-public',
        attemptNumber: 2,
        agentId: 'agent-1',
        attemptState: 'completed',
        runtimeId: 'runtime-public',
        createdAt: '2026-07-28T00:00:00.000Z',
        startedAt: '2026-07-28T00:00:01.000Z',
        endedAt: '2026-07-28T00:00:03.000Z'
      },
      usage: {
        inputTokens: 0,
        outputTokens: 2,
        totalTokens: 2,
        modelCalls: 1,
        toolRounds: 1,
        queueDurationMs: 10,
        executionDurationMs: 20,
        externalRequests: 0,
        monetaryCost: {
          currency: 'USD',
          pricingVersion: 'pricing-v1',
          estimated: 'unknown',
          actual: 0
        }
      },
      artifacts: []
    });
    const pinia = createPinia();
    setActivePinia(pinia);
    useChatAgentTaskStore().applyDetail(detail);
    const wrapper = mountWithPinia(pinia);

    await wrapper.find('[data-action="toggle-detail"]').trigger('click');
    expect(wrapper.text()).toContain('受控写入');
    expect(wrapper.text()).toContain('高优先级');
    expect(wrapper.text()).toContain('可选任务');
    expect(wrapper.text()).toContain('2026-07-29T00:00:00.000Z');
    expect(wrapper.text()).toContain('agent-1');
    expect(wrapper.text()).toContain('runtime-public');
    expect(wrapper.text()).toContain('2026-07-28T00:00:00.000Z');
    expect(wrapper.text()).toContain('排队耗时10 ms');
    expect(wrapper.text()).toContain('执行耗时20 ms');
    expect(wrapper.text()).toContain('pricing-v1');
    expect(wrapper.text()).toContain('估算成本未知');
    expect(wrapper.text()).toContain('实际成本USD 0');
  });

  it('shows artifact metadata while allowing open only for a completed Task', async (): Promise<void> => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useChatAgentTaskStore().applyDetail(createFullDetail({ status: 'running' }));
    const wrapper = mountWithPinia(pinia);

    await wrapper.find('[data-action="toggle-detail"]').trigger('click');

    expect(wrapper.text()).toContain('document-1');
    expect(wrapper.findAll('.b-agent-task-card__open-artifact')).toHaveLength(0);
  });

  it.each(
    (['changesetId', 'baseRevision', 'diffHash', 'operationSetHash'] as const).flatMap(
      (field): ReadonlyArray<readonly [typeof field, 'blank' | 'mismatch']> => [
        [field, 'blank'],
        [field, 'mismatch']
      ]
    )
  )('rejects %s integrity when values are %s', async (field, condition): Promise<void> => {
    const detailValue = condition === 'blank' ? '' : `detail-${field}`;
    const confirmationValue = condition === 'blank' ? '' : `confirmation-${field}`;
    const detail = createFullDetail({
      status: 'waiting_confirmation',
      changeset: {
        changesetId: 'changeset-1',
        baseRevision: 'base-1',
        diffHash: 'diff-1',
        operationSetHash: 'ops-1',
        displayPaths: ['src/example.ts'],
        phase: 'awaiting_confirmation',
        [field]: detailValue
      }
    });
    const pinia = createPinia();
    setActivePinia(pinia);
    useChatAgentTaskStore().applyDetail(detail);
    useChatConfirmationQueueStore().applyAgent(
      createConfirmation({
        [field]: confirmationValue
      })
    );
    const wrapper = mountWithPinia(pinia);

    await wrapper.find('[data-action="toggle-detail"]').trigger('click');
    await wrapper.find('[data-action="open-confirmation"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('agent_confirmation_integrity_invalid');
    expect(useChatConfirmationQueueStore().selectedId).toBeNull();
  });

  it.each([
    ['attempt', { currentAttempt: undefined }],
    ['changeset', { changeset: undefined }]
  ] as const)('shows a stable protocol error when waiting confirmation lacks %s', async (_label, patch): Promise<void> => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useChatAgentTaskStore().applyDetail(createFullDetail({ status: 'waiting_confirmation', ...patch }));
    const wrapper = mountWithPinia(pinia);

    await wrapper.find('[data-action="toggle-detail"]').trigger('click');

    expect(wrapper.text()).toContain('agent_confirmation_context_invalid');
    expect(wrapper.find('[data-action="open-confirmation"]').exists()).toBe(false);
  });

  it('ignores a late artifact open failure after collapse and never mutates Task Store', async (): Promise<void> => {
    const navigation = createDeferred<void>();
    routerAPI.push.mockReturnValue(navigation.promise);
    const pinia = createPinia();
    setActivePinia(pinia);
    const taskStore = useChatAgentTaskStore();
    taskStore.applyDetail(createFullDetail({ status: 'completed' }));
    const beforeTasks = JSON.stringify(taskStore.tasksById);
    const beforeDetails = JSON.stringify(taskStore.detailsById);
    const wrapper = mountWithPinia(pinia);

    await wrapper.find('[data-action="toggle-detail"]').trigger('click');
    await wrapper.find('.b-agent-task-card__open-artifact').trigger('click');
    await wrapper.find('[data-action="toggle-detail"]').trigger('click');
    navigation.reject(new Error('navigation failed'));
    await flushPromises();
    await wrapper.find('[data-action="toggle-detail"]').trigger('click');

    expect(wrapper.text()).not.toContain('agent_artifact_open_failed');
    expect(JSON.stringify(taskStore.tasksById)).toBe(beforeTasks);
    expect(JSON.stringify(taskStore.detailsById)).toBe(beforeDetails);
  });

  it('does not leak an old artifact failure into an already expanded replacement Task', async (): Promise<void> => {
    const navigation = createDeferred<void>();
    routerAPI.push.mockReturnValue(navigation.promise);
    const pinia = createPinia();
    setActivePinia(pinia);
    const taskStore = useChatAgentTaskStore();
    taskStore.applyDetail(createFullDetail({ status: 'completed' }));
    taskStore.applyDetail(
      createFullDetail({
        taskId: 'task-2',
        turnId: 'turn-2',
        checkpointId: 'checkpoint-2',
        assistantMessageId: 'assistant-2',
        toolCallId: 'tool-call-2',
        agentId: 'agent-2',
        status: 'completed',
        currentAttempt: {
          attemptId: 'attempt-2',
          attemptNumber: 1,
          agentId: 'agent-2',
          attemptState: 'completed',
          runtimeId: 'runtime-2',
          createdAt: '2026-07-28T00:00:00.000Z',
          startedAt: '2026-07-28T00:00:01.000Z',
          endedAt: '2026-07-28T00:00:02.000Z'
        },
        artifacts: [
          {
            artifactId: 'artifact-2',
            kind: 'document',
            reference: 'document-2',
            owner: {
              taskId: 'task-2',
              agentId: 'agent-2',
              attemptId: 'attempt-2'
            },
            visibility: 'user',
            createdAt: '2026-07-28T00:00:02.000Z'
          }
        ]
      })
    );
    const wrapper = mountWithPinia(pinia);

    await wrapper.find('[data-action="toggle-detail"]').trigger('click');
    await wrapper.find('.b-agent-task-card__open-artifact').trigger('click');
    const replacementPart = createSuccessPart('task-2');
    replacementPart.toolCallId = 'tool-call-2';
    await wrapper.setProps({
      assistantMessageId: 'assistant-2',
      part: replacementPart
    });
    await flushPromises();
    await wrapper.find('[data-action="toggle-detail"]').trigger('click');
    expect(wrapper.text()).toContain('document-2');

    navigation.reject(new Error('old navigation failed'));
    await flushPromises();

    expect(wrapper.text()).not.toContain('agent_artifact_open_failed');
    expect(wrapper.text()).toContain('document-2');
  });

  it('selects the one exact integrity-bound confirmation from waiting Detail', async (): Promise<void> => {
    const detail = createFullDetail({ status: 'waiting_confirmation' });
    const pinia = createPinia();
    setActivePinia(pinia);
    useChatAgentTaskStore().applyDetail(detail);
    useChatConfirmationQueueStore().applyAgent(createConfirmation());
    const wrapper = mountWithPinia(pinia);

    await wrapper.find('[data-action="toggle-detail"]').trigger('click');
    await wrapper.find('[data-action="open-confirmation"]').trigger('click');

    expect(useChatConfirmationQueueStore().selectedId).toBe('confirmation-1');
    expect(wrapper.text()).not.toContain('agent_confirmation_integrity_invalid');
  });

  it('recovers zero confirmation matches once and reports multiple matches as a protocol error', async (): Promise<void> => {
    const detail = createFullDetail({ status: 'waiting_confirmation' });
    const pinia = createPinia();
    setActivePinia(pinia);
    useChatAgentTaskStore().applyDetail(detail);
    const recovered = createConfirmation();
    agentAPI.listConfirmations.mockResolvedValue({ ok: true, data: [recovered] });
    const wrapper = mountWithPinia(pinia);

    await wrapper.find('[data-action="toggle-detail"]').trigger('click');
    await wrapper.find('[data-action="open-confirmation"]').trigger('click');
    await flushPromises();
    expect(agentAPI.listConfirmations).toHaveBeenCalledOnce();
    expect(useChatConfirmationQueueStore().selectedId).toBe('confirmation-1');

    useChatConfirmationQueueStore().applyAgent(createConfirmation({ confirmationId: 'confirmation-2' }));
    await wrapper.find('[data-action="open-confirmation"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('agent_confirmation_ambiguous');
    expect(agentAPI.listConfirmations).toHaveBeenCalledOnce();
  });

  it('uses projected status and summary instead of the outer Tool Result', (): void => {
    const projected = createSummary({
      status: 'failed',
      summary: '投影确认执行失败',
      updatedAt: '2026-07-28T00:00:04.000Z'
    });
    const part = createSuccessPart('task-1', {
      status: 'completed',
      summary: 'OUTER_SUCCESS_MUST_NOT_RENDER',
      usage: {
        monetaryCost: {
          status: 'known',
          amount: 0
        }
      }
    });
    const { wrapper } = mountProjected(projected, part);

    expect(wrapper.text()).toContain('失败');
    expect(wrapper.text()).toContain('投影确认执行失败');
    expect(wrapper.text()).not.toContain('OUTER_SUCCESS_MUST_NOT_RENDER');
    expect(wrapper.text()).not.toContain('$0');
    expect(wrapper.find('[data-icon="lucide:circle-alert"]').exists()).toBe(true);
  });

  it.each([
    ['created', undefined, '已创建', 'lucide:file-plus-2'],
    ['planning', undefined, '规划中', 'lucide:list-tree'],
    ['authorized', undefined, '已授权', 'lucide:shield-check'],
    ['queued', 'start', '等待启动', 'lucide:clock-3'],
    ['queued', 'commit', '等待提交', 'lucide:clock-3'],
    ['starting', undefined, '启动中', 'lucide:loader-circle'],
    ['running', undefined, '运行中', 'lucide:play-circle'],
    ['waiting_confirmation', undefined, '等待确认', 'lucide:circle-help'],
    ['committing', undefined, '提交中', 'lucide:git-commit-horizontal'],
    ['cancelling', undefined, '取消中', 'lucide:loader-circle'],
    ['completed', undefined, '已完成', 'lucide:circle-check'],
    ['failed', undefined, '失败', 'lucide:circle-alert'],
    ['cancelled', undefined, '已取消', 'lucide:circle-x'],
    ['deadline_exceeded', undefined, '已超时', 'lucide:timer-off'],
    ['commit_failed', undefined, '提交失败', 'lucide:git-commit-horizontal']
  ] satisfies ReadonlyArray<readonly [AgentTaskStatus, AgentTaskQueuePhase | undefined, string, string]>)(
    'renders status %s with text and icon',
    (status, queuePhase, label, icon): void => {
      const { wrapper } = mountProjected(
        createSummary({
          status,
          ...(queuePhase ? { queuePhase } : {}),
          ...(status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'deadline_exceeded' || status === 'commit_failed'
            ? { updatedAt: '2026-07-28T00:00:04.000Z' }
            : {})
        })
      );

      expect(wrapper.text()).toContain(label);
      expect(wrapper.find(`[data-icon="${icon}"]`).exists()).toBe(true);
    }
  );

  it('updates active approximate elapsed time once per second and stops after unmount', async (): Promise<void> => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const { wrapper } = mountProjected(createSummary());

    expect(wrapper.text()).toContain('约 10 秒');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(wrapper.text()).toContain('约 11 秒');

    wrapper.unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('freezes terminal duration and omits approximate wording', async (): Promise<void> => {
    const { wrapper } = mountProjected(
      createSummary({
        status: 'completed',
        createdAt: '2026-07-28T00:00:00.000Z',
        updatedAt: '2026-07-28T00:00:04.000Z'
      })
    );

    expect(wrapper.text()).toContain('4 秒');
    expect(wrapper.text()).not.toContain('约 4 秒');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(wrapper.text()).toContain('4 秒');
  });

  it('prefers complete persisted Summary duration over wall-clock fallback', (): void => {
    const { wrapper } = mountProjected(
      createSummary({
        duration: {
          queueDurationMs: 2_000,
          executionDurationMs: 3_000,
          complete: true
        }
      })
    );

    expect(wrapper.text()).toContain('5 秒');
    expect(wrapper.text()).not.toContain('约 5 秒');
    expect(wrapper.text()).not.toContain('约 10 秒');
  });

  it('marks an incomplete persisted duration as approximate', (): void => {
    const { wrapper } = mountProjected(
      createSummary({
        duration: {
          queueDurationMs: 2_000,
          executionDurationMs: 3_000,
          complete: false
        }
      })
    );

    expect(wrapper.text()).toContain('约 5 秒');
  });

  it('omits invalid or negative elapsed time', (): void => {
    const invalid = mountProjected(
      createSummary({
        status: 'completed',
        createdAt: 'invalid',
        updatedAt: '2026-07-28T00:00:04.000Z'
      })
    );
    const negative = mountProjected(
      createSummary({
        status: 'completed',
        createdAt: '2026-07-28T00:00:05.000Z',
        updatedAt: '2026-07-28T00:00:04.000Z'
      })
    );

    expect(invalid.wrapper.find('.b-agent-task-card__elapsed').exists()).toBe(false);
    expect(negative.wrapper.find('.b-agent-task-card__elapsed').exists()).toBe(false);
  });

  it('renders a tombstone with only removal text and minimal update time', (): void => {
    const { wrapper } = mountProjected(createTombstone());

    expect(wrapper.text()).toContain('任务记录已移除');
    expect(wrapper.text()).toContain('2026/07/28');
    expect(wrapper.text()).not.toContain('检查 Renderer 投影');
    expect(wrapper.text()).not.toContain('task-1');
  });

  it('loads a missing terminal projection once and renders only the indexed response', async (): Promise<void> => {
    agentAPI.getTask.mockResolvedValue(createTaskResult(createDetail({ status: 'completed', updatedAt: '2026-07-28T00:00:04.000Z' })));
    const { wrapper } = mountTaskCard(createSuccessPart('task-1'));
    await flushPromises();

    expect(agentAPI.getTask).toHaveBeenCalledOnce();
    expect(agentAPI.getTask).toHaveBeenCalledWith({
      sessionId: 'session-1',
      taskId: 'task-1'
    });
    expect(wrapper.text()).toContain('检查 Renderer 投影');
    expect(wrapper.text()).toContain('已完成');
  });

  it('loads a missing indexed running Task once', async (): Promise<void> => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useChatAgentTaskStore();
    store.taskIdsByMessageToolCall[createTaskIndexKey('session-1', 'assistant-1', 'tool-call-1')] = 'task-1';
    agentAPI.getTask.mockResolvedValue(createTaskResult(createDetail()));

    const wrapper = mountWithPinia(pinia);
    await flushPromises();

    expect(agentAPI.getTask).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('检查 Renderer 投影');
  });

  it('renders a directed tombstone without live fields', async (): Promise<void> => {
    agentAPI.getTask.mockResolvedValue(createTaskResult(createTombstone()));
    const { wrapper } = mountTaskCard(createSuccessPart('task-1'));
    await flushPromises();

    expect(wrapper.text()).toContain('任务记录已移除');
    expect(wrapper.text()).not.toContain('检查 Renderer 投影');
  });

  it('fails closed when the composite index and Result taskId disagree', async (): Promise<void> => {
    const { wrapper } = mountProjected(
      createSummary({
        task: 'SECRET_INDEXED_TITLE',
        summary: 'SECRET_INDEXED_SUMMARY'
      }),
      createSuccessPart('task-result-secret', {
        summary: 'SECRET_RESULT_SUMMARY'
      })
    );
    await flushPromises();

    expect(wrapper.text()).toContain('agent_task_identity_conflict');
    expect(wrapper.text()).not.toContain('SECRET_INDEXED_TITLE');
    expect(wrapper.text()).not.toContain('SECRET_INDEXED_SUMMARY');
    expect(wrapper.text()).not.toContain('SECRET_RESULT_SUMMARY');
    expect(wrapper.text()).not.toContain('task-result-secret');
    expect(agentAPI.getTask).not.toHaveBeenCalled();
  });

  it('rejects a directed response whose original message position differs', async (): Promise<void> => {
    agentAPI.getTask.mockResolvedValue(
      createTaskResult(
        createDetail({
          assistantMessageId: 'assistant-other',
          toolCallId: 'tool-call-other',
          task: 'SECRET_WRONG_POSITION'
        })
      )
    );
    const { pinia, wrapper } = mountTaskCard(createSuccessPart('task-1'));
    await flushPromises();

    expect(wrapper.text()).toContain('agent_task_projection_invalid');
    expect(wrapper.findComponent({ name: 'BubblePartTool' }).exists()).toBe(false);
    expect(wrapper.text()).not.toContain('SECRET_WRONG_POSITION');

    const secondPart = createTaskPart();
    secondPart.toolCallId = 'tool-call-other';
    const secondPosition = mountWithPinia(pinia, secondPart, 'session-1', 'assistant-other');
    expect(secondPosition.text()).not.toContain('SECRET_WRONG_POSITION');
    expect(secondPosition.findComponent({ name: 'BubblePartTool' }).exists()).toBe(true);
  });

  it('uses a metadata-only generic fallback after a null lookup', async (): Promise<void> => {
    agentAPI.getTask.mockResolvedValue(createTaskResult(null));
    const part = createSuccessPart('task-1', {
      output: 'SECRET_OUTPUT',
      usage: 'SECRET_USAGE',
      artifacts: ['SECRET_ARTIFACT']
    });
    const { wrapper } = mountTaskCard(part);
    await flushPromises();

    const fallback = wrapper.findComponent({ name: 'BubblePartTool' });
    expect(fallback.exists()).toBe(true);
    expect(fallback.props('part')).toMatchObject({
      status: 'done',
      input: {},
      result: {
        status: 'success',
        data: {
          taskId: 'task-1',
          projection: 'unavailable'
        }
      }
    });
    expect(wrapper.html()).not.toContain('SECRET_INPUT_SHOULD_NOT_RENDER');
    expect(wrapper.html()).not.toContain('SECRET_OUTPUT');
    expect(wrapper.html()).not.toContain('SECRET_USAGE');
    expect(wrapper.html()).not.toContain('SECRET_ARTIFACT');
  });

  it.each(['handler failure', 'transport rejection'] as const)('keeps the generic fallback after %s', async (failureKind): Promise<void> => {
    if (failureKind === 'handler failure') {
      agentAPI.getTask.mockResolvedValue({
        ok: false,
        error: 'SECRET_HANDLER_ERROR',
        code: 'TASK_LOOKUP_FAILED'
      });
    } else {
      agentAPI.getTask.mockRejectedValue(new Error('SECRET_TRANSPORT_ERROR'));
    }
    const { wrapper } = mountTaskCard(createSuccessPart('task-1', { output: 'SECRET_LOOKUP_OUTPUT' }));
    await flushPromises();

    expect(wrapper.findComponent({ name: 'BubblePartTool' }).exists()).toBe(true);
    expect(wrapper.html()).not.toContain('SECRET_HANDLER_ERROR');
    expect(wrapper.html()).not.toContain('SECRET_TRANSPORT_ERROR');
    expect(wrapper.html()).not.toContain('SECRET_LOOKUP_OUTPUT');
  });

  it.each(['failure', 'cancelled'] as const)('removes raw %s error messages from fallback DOM', (status): void => {
    const part = createTaskPart({
      status: 'done',
      result: {
        toolName: 'delegate_task',
        status,
        error: {
          code: status === 'failure' ? 'EXECUTION_FAILED' : 'USER_CANCELLED',
          message: 'SECRET_ERROR_MESSAGE',
          details: {
            output: 'SECRET_ERROR_DETAILS'
          }
        }
      }
    });
    const { wrapper } = mountTaskCard(part);
    const fallbackPart = wrapper.findComponent({ name: 'BubblePartTool' }).props('part') as ChatMessageToolPart;

    expect(fallbackPart.input).toEqual({});
    expect(fallbackPart.result).toMatchObject({
      status,
      error: {
        code: status === 'failure' ? 'EXECUTION_FAILED' : 'USER_CANCELLED',
        message: status === 'failure' ? 'Child Task 投影不可用' : 'Child Task 已取消'
      }
    });
    expect(wrapper.html()).not.toContain('SECRET_ERROR_MESSAGE');
    expect(wrapper.html()).not.toContain('SECRET_ERROR_DETAILS');
    expect(agentAPI.getTask).not.toHaveBeenCalled();
  });

  it('does not query without a Session or without any Task identity', (): void => {
    const nullSession = mountTaskCard(createSuccessPart('task-1'), null);
    const running = mountTaskCard(createTaskPart());

    expect(nullSession.wrapper.findComponent({ name: 'BubblePartTool' }).exists()).toBe(true);
    expect(running.wrapper.findComponent({ name: 'BubblePartTool' }).exists()).toBe(true);
    expect(agentAPI.getTask).not.toHaveBeenCalled();
  });

  it('automatically replaces a fallback when a later Event supplies the composite projection', async (): Promise<void> => {
    const { pinia, wrapper } = mountTaskCard(createTaskPart());
    expect(wrapper.findComponent({ name: 'BubblePartTool' }).exists()).toBe(true);

    setActivePinia(pinia);
    useChatAgentTaskStore().applySummary(createSummary());
    await nextTick();

    expect(wrapper.findComponent({ name: 'BubblePartTool' }).exists()).toBe(false);
    expect(wrapper.text()).toContain('检查 Renderer 投影');
  });

  it('ignores an obsolete lookup response after the rendered Tool Part changes', async (): Promise<void> => {
    const firstResponse = createDeferred<ChatAgentHandlerResult<ChatAgentGetTaskResult>>();
    agentAPI.getTask.mockReturnValueOnce(firstResponse.promise).mockResolvedValueOnce(
      createTaskResult(
        createDetail({
          taskId: 'task-2',
          assistantMessageId: 'assistant-2',
          toolCallId: 'tool-call-2',
          task: 'CURRENT_TASK_TITLE'
        })
      )
    );
    const { wrapper } = mountTaskCard(createSuccessPart('task-1'));
    const currentPart = createSuccessPart('task-2', {
      marker: 'current'
    });
    currentPart.toolCallId = 'tool-call-2';

    await wrapper.setProps({
      sessionId: 'session-1',
      assistantMessageId: 'assistant-2',
      part: currentPart
    });
    await flushPromises();
    expect(wrapper.text()).toContain('CURRENT_TASK_TITLE');

    firstResponse.resolve(
      createTaskResult(
        createDetail({
          task: 'OBSOLETE_TASK_TITLE'
        })
      )
    );
    await flushPromises();

    expect(wrapper.text()).toContain('CURRENT_TASK_TITLE');
    expect(wrapper.text()).not.toContain('OBSOLETE_TASK_TITLE');
    expect(wrapper.text()).not.toContain('agent_task_projection_invalid');
  });
});
