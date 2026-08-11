/**
 * @file projection.mts
 * @description 合并 ChatRuntime Assistant 的实时追加事件与耐久完整快照。
 */
import { Buffer } from 'node:buffer';
import type { ChatMessageRecord } from 'types/chat';
import type { ChatRuntimeMessageDelta, ChatRuntimeMessageMutation } from 'types/chat-runtime';
import { debounce } from 'lodash-es';
import { asyncTo } from '../../../../../../shared/utils/asyncTo.js';

/** 实时事件普通等待时间。 */
const LIVE_WAIT_MS = 16;
/** 实时事件最大等待时间。 */
const LIVE_MAX_WAIT_MS = 50;
/** 实时事件累计文本立即刷新阈值。 */
const LIVE_TEXT_LIMIT_BYTES = 64 * 1024;
/** 单个实时事件允许的最大 mutation 数量。 */
const LIVE_MUTATION_LIMIT = 512;
/** 耐久快照普通等待时间。 */
const SNAPSHOT_WAIT_MS = 100;
/** 耐久快照最大等待时间。 */
const SNAPSHOT_MAX_WAIT_MS = 250;

/** Assistant 投影器依赖。 */
export interface AssistantProjectionOptions {
  /** 工作 Assistant 消息 ID。 */
  messageId: string;
  /** 在真正保存边界创建最新安全快照。 */
  createSnapshot: () => ChatMessageRecord;
  /** 发送不含 Runtime 地址的实时增量。 */
  emitDelta: (delta: ChatRuntimeMessageDelta) => void;
  /** 持久化完整安全快照。 */
  persist: (snapshot: ChatMessageRecord, revision: number) => Promise<void>;
  /** 前一个模型续轮已经提交的修订号。 */
  initialRevision?: number;
  /** 修订号推进通知，用于跨模型续轮保存 Runtime 内存状态。 */
  onRevision?: (revision: number) => void;
}

/** Assistant 投影器。 */
export interface AssistantProjection {
  /** 追加一个已经写入工作消息的高频可见变更。 */
  append: (mutation: ChatRuntimeMessageMutation) => void;
  /** 标记一个只通过完整检查点投影的结构变化。 */
  mark: () => void;
  /** 立即刷新实时增量与最新耐久快照。 */
  checkpoint: () => Promise<void>;
  /** 排空全部待处理投影。 */
  flush: () => Promise<void>;
  /** 取消计时器、拒绝晚到变更，并等待已经开始的耐久写入结束。 */
  cancel: () => Promise<void>;
  /** 读取当前工作消息修订号。 */
  revision: () => number;
}

/**
 * 判断两个 mutation 是否可以安全合并。
 * @param current - 已排队 mutation
 * @param next - 新 mutation
 * @returns 是否属于同类型和同目标
 */
function canMergeMutation(current: ChatRuntimeMessageMutation, next: ChatRuntimeMessageMutation): boolean {
  if (current.kind !== next.kind) return false;
  if (current.kind === 'append-tool-input' && next.kind === 'append-tool-input') return current.toolCallId === next.toolCallId;
  if (current.kind === 'append-text' && next.kind === 'append-text') return current.partId === next.partId;
  if (current.kind === 'append-reasoning' && next.kind === 'append-reasoning') return current.partId === next.partId;
  return false;
}

/**
 * 合并两个已确认同目标的 mutation。
 * @param current - 已排队 mutation
 * @param next - 新 mutation
 * @returns 保持目标身份的合并 mutation
 */
function mergeMutation(current: ChatRuntimeMessageMutation, next: ChatRuntimeMessageMutation): ChatRuntimeMessageMutation {
  if (current.kind === 'append-tool-input' && next.kind === 'append-tool-input') {
    return { ...current, text: `${current.text}${next.text}` };
  }
  if (current.kind === 'append-text' && next.kind === 'append-text') {
    return { ...current, text: `${current.text}${next.text}` };
  }
  if (current.kind === 'append-reasoning' && next.kind === 'append-reasoning') {
    return { ...current, text: `${current.text}${next.text}` };
  }
  return next;
}

/**
 * 创建 Assistant 实时增量与耐久快照合并器。
 * @param options - 投影器依赖
 * @returns 可由流执行器驱动的投影器
 */
export function createAssistantProjection(options: AssistantProjectionOptions): AssistantProjection {
  let currentRevision = options.initialRevision ?? 0;
  let liveBaseRevision = currentRevision;
  let liveRevision = currentRevision;
  let liveTextBytes = 0;
  let liveMutations: ChatRuntimeMessageMutation[] = [];
  let snapshotDirty = false;
  let persistFlight: Promise<void> | null = null;
  let persistError: unknown;
  let closed = false;

  /** 立即发送当前实时增量批次。 */
  function flushLive(): void {
    if (closed || liveMutations.length === 0) return;
    options.emitDelta({
      messageId: options.messageId,
      baseRevision: liveBaseRevision,
      revision: liveRevision,
      mutations: liveMutations
    });
    liveMutations = [];
    liveTextBytes = 0;
  }

  const scheduleLive = debounce(flushLive, LIVE_WAIT_MS, { maxWait: LIVE_MAX_WAIT_MS });

  /**
   * 执行一次已捕获快照的耐久写入。
   * @param snapshot - 写入开始时的安全消息
   * @param revision - 快照修订号
   */
  async function persistSnapshot(snapshot: ChatMessageRecord, revision: number): Promise<void> {
    const [error] = await asyncTo(Promise.resolve().then((): Promise<void> => options.persist(snapshot, revision)));
    if (error !== undefined) persistError ??= error;
  }

  /** 在没有活动写入时捕获并启动一次最新快照写入。 */
  function startPersist(): void {
    if (closed || persistFlight || !snapshotDirty || persistError !== undefined) return;
    snapshotDirty = false;
    const revision = currentRevision;
    const snapshot = options.createSnapshot();
    const flight = persistSnapshot(snapshot, revision);
    persistFlight = flight;
    flight.then((): void => {
      if (persistFlight !== flight) return;
      persistFlight = null;
      // 慢写期间积累的脏状态只追写最新快照，保持单飞并避免写入乱序。
      if (snapshotDirty && persistError === undefined && !closed) startPersist();
    });
  }

  const schedulePersist = debounce(startPersist, SNAPSHOT_WAIT_MS, { maxWait: SNAPSHOT_MAX_WAIT_MS });

  /** 排空耐久写入，并在慢写期间继续追赶最新脏状态。 */
  async function flushSnapshots(): Promise<void> {
    schedulePersist.cancel();
    while (snapshotDirty || persistFlight) {
      startPersist();
      const flight = persistFlight;
      // 每次只等待当前唯一写入，完成后再判断是否需要追写最新状态。
      // eslint-disable-next-line no-await-in-loop
      if (flight) await flight;
      if (persistError !== undefined) throw persistError;
    }
    if (persistError !== undefined) throw persistError;
  }

  /** 将 mutation 加入当前实时批次。 */
  function queueMutation(mutation: ChatRuntimeMessageMutation): void {
    const tail = liveMutations.at(-1);
    if (tail && canMergeMutation(tail, mutation)) {
      liveMutations.splice(liveMutations.length - 1, 1, mergeMutation(tail, mutation));
    } else {
      liveMutations.push(mutation);
    }
    liveTextBytes += Buffer.byteLength(mutation.text, 'utf8');
  }

  /** 推进并发布当前 Runtime 修订号。 */
  function advanceRevision(): void {
    currentRevision += 1;
    options.onRevision?.(currentRevision);
  }

  return {
    append(mutation: ChatRuntimeMessageMutation): void {
      if (closed) return;
      if (liveMutations.length === 0) liveBaseRevision = currentRevision;
      advanceRevision();
      liveRevision = currentRevision;
      queueMutation(mutation);
      snapshotDirty = true;
      scheduleLive();
      schedulePersist();
      if (liveTextBytes >= LIVE_TEXT_LIMIT_BYTES || liveMutations.length >= LIVE_MUTATION_LIMIT) {
        scheduleLive.cancel();
        flushLive();
      }
    },
    mark(): void {
      if (closed) return;
      scheduleLive.flush();
      advanceRevision();
      snapshotDirty = true;
      schedulePersist();
    },
    async checkpoint(): Promise<void> {
      if (closed) return;
      scheduleLive.flush();
      await flushSnapshots();
    },
    async flush(): Promise<void> {
      if (closed) return;
      scheduleLive.flush();
      await flushSnapshots();
    },
    async cancel(): Promise<void> {
      if (!closed) {
        closed = true;
        scheduleLive.cancel();
        schedulePersist.cancel();
        liveMutations = [];
        liveTextBytes = 0;
        snapshotDirty = false;
      }
      const activeFlight = persistFlight;
      if (activeFlight) await activeFlight;
    },
    revision(): number {
      return currentRevision;
    }
  };
}
