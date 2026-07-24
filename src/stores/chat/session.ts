/**
 * @file chat.ts
 * @description 聊天会话和消息持久化存储。
 */
import type { AIUsage } from 'types/ai';
import type {
  ChatMessageHistoryCursor,
  ChatMessageRecord,
  ChatSession,
  ChatSessionModelMetadata,
  ChatSessionType,
  PaginatedSessionsResult,
  SessionCursor,
  SessionPaginationParams
} from 'types/chat';
import { toRaw } from 'vue';
import { defineStore } from 'pinia';
import dayjs from 'dayjs';
import { orderBy, uniqBy } from 'lodash-es';
import { nanoid } from 'nanoid';
import { recoverInterruptedAssistantDrafts } from '@/components/BChat/utils/interruptedDraftRecovery';
import { is, type PersistableMessage } from '@/components/BChat/utils/messageHelper';
import type { Message } from '@/components/BChat/utils/types';
import { getElectronAPI, unwrap } from '@/shared/platform/electron-api';
import { createChatRecentId } from '@/shared/storage';
import { isDatabaseInitializationRaceError, retryDuringDatabaseInitialization } from '@/shared/storage/utils/database';
import { useRecentStore } from '@/stores/workspace/recent';
import { asyncTo } from '@/utils/asyncTo';
import { useTodoStore } from './todo';

/** 会话历史分页大小。 */
const SESSION_PAGE_SIZE = 20;

/** 同一会话按 ID 加载时共享的在途请求。 */
const sessionLoadPromises = new Map<string, Promise<ChatSession | undefined>>();

/**
 * 创建聊天会话时可选的初始字段。
 */
interface CreateSessionOptions {
  /** 初始标题。 */
  title?: string;
  /** 首次 Runtime 已冻结的模型。 */
  model?: ChatSessionModelMetadata;
}

/**
 * 聊天会话 Store 状态。
 */
interface ChatSessionState {
  /** 已加载和运行期间创建的会话集合。 */
  sessions: ChatSession[];
  /** 会话集合是否正在加载。 */
  sessionsLoading: boolean;
  /** 是否成功完成过首次加载。 */
  sessionsLoaded: boolean;
  /** 服务端是否还有下一页会话。 */
  sessionsHasMore: boolean;
  /** 下一页会话游标。 */
  sessionsNextCursor?: SessionCursor;
}

/**
 * 合并并按最近活动时间倒序排列会话。
 * @param primarySessions - 优先保留的会话集合
 * @param fallbackSessions - 用于补齐缺失 ID 的会话集合
 * @returns 去重并排序后的会话集合
 */
function mergeSessions(primarySessions: ChatSession[], fallbackSessions: ChatSession[]): ChatSession[] {
  const sessions = uniqBy([...primarySessions, ...fallbackSessions], 'id');
  return orderBy(sessions, [(session: ChatSession): string => session.lastMessageAt || session.updatedAt || session.createdAt], ['desc']);
}

/**
 * 从集合移除指定会话。
 * @param sessions - 当前会话集合
 * @param sessionId - 要移除的会话 ID
 * @returns 移除后的会话集合
 */
function removeSession(sessions: ChatSession[], sessionId: string): ChatSession[] {
  return sessions.filter((session: ChatSession): boolean => session.id !== sessionId);
}

/**
 * 更新会话最近活动时间并恢复排序。
 * @param sessions - 当前会话集合
 * @param sessionId - 目标会话 ID
 * @param lastMessageAt - 最新消息时间
 * @returns 更新后的会话集合
 */
function touchSession(sessions: ChatSession[], sessionId: string, lastMessageAt: string): ChatSession[] {
  const session = sessions.find((item: ChatSession): boolean => item.id === sessionId);
  if (!session) return sessions;

  return mergeSessions([{ ...session, updatedAt: lastMessageAt, lastMessageAt }], sessions);
}

/**
 * 将值转换为 Electron IPC 可克隆的纯数据。
 * @param value - 待转换值
 * @returns 去除 Vue Proxy 后的可克隆数据
 */
function toCloneableData<T>(value: T): T {
  if (value === undefined) return value;

  const rawValue = toRaw(value);
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(rawValue) as T;
    } catch {
      // 嵌套 Vue Proxy 无法 structuredClone 时，回退到 JSON 纯数据。
    }
  }

  return JSON.parse(JSON.stringify(rawValue)) as T;
}

/**
 * 按类型读取一页持久化会话。
 * @param type - 会话类型过滤器
 * @param pagination - 分页参数
 * @returns 分页会话结果
 */
async function fetchSessions(type: ChatSessionType, pagination?: SessionPaginationParams): Promise<PaginatedSessionsResult> {
  try {
    return await retryDuringDatabaseInitialization(async () => {
      const plainPagination = pagination ? toCloneableData(pagination) : undefined;
      const result = await getElectronAPI().chatSessionList(type, plainPagination);
      return unwrap(result);
    });
  } catch (error: unknown) {
    if (isDatabaseInitializationRaceError(error)) return { items: [], hasMore: false };
    throw error;
  }
}

/**
 * 将可持久化的侧边栏消息转换为存储记录。
 * @param sessionId - 目标聊天会话 ID。
 * @param message - 可持久化的消息数据。
 * @returns 可存储的聊天消息记录。
 */
function toRecordMessage(sessionId: string, message: PersistableMessage): ChatMessageRecord {
  const { id, role, content, parts, thinking, files, usage, createdAt = dayjs().toISOString(), loading, finished } = message;

  // Deep-clone to strip Vue reactive Proxy objects before passing through Electron IPC.
  return toCloneableData({ sessionId, id, role, content, parts, thinking, files, usage, createdAt, loading, finished });
}

/**
 * 将持久化记录恢复为侧边栏消息。
 * 旧记录没有 finished/loading 字段时按已完成历史消息处理。
 * @param record - 持久化聊天消息记录。
 * @returns 侧边栏消息。
 */
function fromRecordMessage(record: ChatMessageRecord): Message {
  return {
    ...record,
    loading: record.loading ?? false,
    finished: record.finished ?? true
  };
}

/**
 * 读取当前会话执行破坏性草稿恢复前的 Agent 门禁。
 * Renderer 重载期间仍存在活动委派 Checkpoint 时必须保留 Runtime A 草稿；
 * Agent IPC 可用但查询失败时按 fail-closed 处理。旧浏览器测试环境没有该 API
 * 时保持原有恢复行为。
 * @param sessionId - 待恢复消息所属会话
 * @returns legacy 表示保持旧行为，blocked 表示禁止恢复，clear 表示可重新读取
 */
async function readRecoveryGate(sessionId: string): Promise<'legacy' | 'blocked' | 'clear'> {
  const listActive = getElectronAPI().chatAgentListActive;
  if (typeof listActive !== 'function') return 'legacy';

  const [requestError, response] = await asyncTo(listActive());
  if (requestError) return 'blocked';
  const [unwrapError, checkpoints] = await asyncTo(Promise.resolve().then(() => unwrap(response)));
  if (unwrapError) return 'blocked';

  return checkpoints.some((checkpoint): boolean => checkpoint.sessionId === sessionId) ? 'blocked' : 'clear';
}

/**
 * 从主进程读取一次会话消息快照。
 * @param sessionId - 目标会话
 * @param cursor - 可选历史游标
 * @returns 持久化消息记录
 */
async function readMessageRecords(sessionId: string, cursor?: ChatMessageHistoryCursor): Promise<ChatMessageRecord[]> {
  return retryDuringDatabaseInitialization(async () => {
    const plainCursor = cursor ? toCloneableData(cursor) : undefined;
    const result = await getElectronAPI().chatMessageList(sessionId, plainCursor);
    return unwrap(result);
  });
}

export const useChatSessionStore = defineStore('chat', {
  state: (): ChatSessionState => ({
    sessions: [],
    sessionsLoading: false,
    sessionsLoaded: false,
    sessionsHasMore: true,
    sessionsNextCursor: undefined
  }),
  getters: {
    /**
     * 按 ID 查找已加载的会话。
     * @param state - 聊天会话 Store 状态
     * @returns 会话查询函数
     */
    findSession:
      (state: ChatSessionState): ((sessionId?: string | null) => ChatSession | undefined) =>
      (sessionId?: string | null): ChatSession | undefined =>
        state.sessions.find((session: ChatSession): boolean => session.id === sessionId)
  },
  actions: {
    /**
     * 加载指定游标对应的会话页并合并到唯一集合。
     * @param cursor - 下一页游标；空值表示第一页
     */
    async loadSessionPage(cursor?: SessionCursor): Promise<void> {
      if (this.sessionsLoading) return;

      this.sessionsLoading = true;
      const [error, result] = await asyncTo(
        fetchSessions('assistant', {
          limit: SESSION_PAGE_SIZE,
          cursor
        })
      );
      this.sessionsLoading = false;
      if (error) throw error;

      // 服务端结果优先覆盖同 ID 旧数据，同时保留请求期间刚创建的本地会话。
      this.sessions = mergeSessions(result.items, this.sessions);
      this.sessionsHasMore = result.hasMore;
      this.sessionsNextCursor = result.nextCursor;
      if (!cursor) this.sessionsLoaded = true;
    },

    /**
     * 确保会话集合已完成首次加载。
     */
    async ensureSessions(): Promise<void> {
      if (this.sessionsLoaded || this.sessionsLoading) return;
      await this.loadSessionPage();
    },

    /**
     * 加载会话集合下一页。
     */
    async loadMoreSessions(): Promise<void> {
      if (this.sessionsLoading) return;
      if (!this.sessionsLoaded) {
        await this.loadSessionPage();
        return;
      }
      if (!this.sessionsHasMore) return;

      await this.loadSessionPage(this.sessionsNextCursor);
    },

    /**
     * 按 ID 加载未出现在当前分页集合中的会话。
     * @param sessionId - 要加载的会话 ID
     * @returns 已加载会话；会话不存在或数据库仍在初始化时返回 undefined
     */
    async loadSessionById(sessionId: string): Promise<ChatSession | undefined> {
      const localSession = this.findSession(sessionId);
      if (localSession) return localSession;

      let request = sessionLoadPromises.get(sessionId);
      if (!request) {
        request = retryDuringDatabaseInitialization(async (): Promise<ChatSession | undefined> => {
          const result = await getElectronAPI().chatSessionGet(sessionId);
          return unwrap(result);
        });
        sessionLoadPromises.set(sessionId, request);
      }

      const [error, session] = await asyncTo(request);
      if (sessionLoadPromises.get(sessionId) === request) sessionLoadPromises.delete(sessionId);
      if (error) {
        if (isDatabaseInitializationRaceError(error)) return undefined;
        throw error;
      }

      if (session) this.sessions = mergeSessions([session], this.sessions);
      return session;
    },

    /**
     * 加载会话的聊天消息，可选择使用历史游标。
     * @param sessionId - 要加载的会话 ID。
     * @param cursor - 可选的历史游标。
     * @returns 已完成的聊天消息，可直接用于 UI 展示。
     */
    async getSessionMessages(sessionId: string, cursor?: ChatMessageHistoryCursor): Promise<Message[]> {
      try {
        const messages = await readMessageRecords(sessionId, cursor);
        const loadedMessages = messages.map(fromRecordMessage);
        const initialRecovery = recoverInterruptedAssistantDrafts(loadedMessages);
        // 绝大多数正常历史没有中断草稿，不触发额外 Agent IPC 或二次消息读取。
        if (!initialRecovery.recovered) return initialRecovery.messages;

        const recoveryGate = await readRecoveryGate(sessionId);
        if (recoveryGate === 'blocked') return loadedMessages;

        let recoveryResult = initialRecovery;
        if (recoveryGate === 'clear') {
          // Agent 状态确认与消息读取之间可能完成 Runtime B；必须用第二份新鲜快照恢复。
          const [freshReadError, freshRecords] = await asyncTo(readMessageRecords(sessionId, cursor));
          if (freshReadError) return loadedMessages;
          recoveryResult = recoverInterruptedAssistantDrafts(freshRecords.map(fromRecordMessage));
        }

        if (recoveryResult.recovered) {
          await Promise.all([
            ...recoveryResult.recoveredMessages.map((message) => this.updateSessionMessage(sessionId, message)),
            ...recoveryResult.createdMessages.map((message) => this.addSessionMessage(sessionId, message))
          ]);
        }

        return recoveryResult.messages;
      } catch (error: unknown) {
        if (isDatabaseInitializationRaceError(error)) {
          return [];
        }

        throw error;
      }
    },

    /**
     * 读取单个会话的已持久化使用量。
     * @param sessionId - 要查看的会话 ID。
     * @returns 已持久化的使用量总计，如果会话没有使用量则返回 undefined。
     */
    async getSessionUsage(sessionId: string): Promise<AIUsage | undefined> {
      try {
        return await retryDuringDatabaseInitialization(async () => {
          const result = await getElectronAPI().chatSessionUsageGet(sessionId);
          return unwrap(result);
        });
      } catch (error: unknown) {
        if (isDatabaseInitializationRaceError(error)) {
          return undefined;
        }

        throw error;
      }
    },

    /**
     * 创建新的聊天会话并立即持久化。
     * @param type - 要创建的会话类型。
     * @param options - 可选的会话元数据。
     * @returns 创建的会话记录。
     */
    async createSession(type: ChatSessionType, { title = '新会话', model }: CreateSessionOptions = {}): Promise<ChatSession> {
      const now = dayjs().toISOString();
      const session: ChatSession = {
        id: nanoid(),
        type,
        title,
        createdAt: now,
        updatedAt: now,
        lastMessageAt: now,
        metadata: model ? { model: toCloneableData(model) } : undefined
      };

      await retryDuringDatabaseInitialization(async () => {
        const result = await getElectronAPI().chatSessionCreate(session);
        unwrap(result);
      });

      this.sessions = mergeSessions([session], this.sessions);
      return session;
    },

    /**
     * 持久化会话模型，并以主进程返回的完整会话更新本地集合。
     * @param sessionId - 会话 ID
     * @param model - 新模型标识
     * @returns 已持久化的完整会话
     */
    async updateSessionModel(sessionId: string, model: ChatSessionModelMetadata): Promise<ChatSession> {
      await this.loadSessionById(sessionId);
      const [error, session] = await asyncTo(
        retryDuringDatabaseInitialization(async (): Promise<ChatSession> => {
          const result = await getElectronAPI().chatSessionUpdateModel(sessionId, toCloneableData(model));
          return unwrap(result);
        })
      );
      if (error) throw error;

      this.sessions = mergeSessions([session], this.sessions);
      return session;
    },

    /**
     * 保留已有会话模型，仅在旧会话缺少模型元数据时补写。
     * @param sessionId - 会话 ID
     * @param model - 缺少元数据时要写入的 Runtime 模型
     * @returns 已具备模型元数据的会话
     */
    async ensureSessionModel(sessionId: string, model: ChatSessionModelMetadata): Promise<ChatSession> {
      const session = await this.loadSessionById(sessionId);
      if (!session) throw new Error('找不到聊天会话');
      return session.metadata?.model ? session : this.updateSessionModel(sessionId, model);
    },

    /**
     * 从指定助手消息创建独立会话分支。
     * @param sourceSessionId - 源会话 ID
     * @param targetMessageId - 目标助手消息 ID
     * @returns 已持久化的新会话
     */
    async branchSession(sourceSessionId: string, targetMessageId: string): Promise<ChatSession> {
      const session = await retryDuringDatabaseInitialization(async (): Promise<ChatSession> => {
        const result = await getElectronAPI().chatSessionBranch(sourceSessionId, targetMessageId);
        return unwrap(result);
      });

      this.sessions = mergeSessions([session], this.sessions);
      return session;
    },

    /**
     * 持久化单条消息及其使用量元数据（如果可用）。
     * 级联更新（lastMessageAt + usage）在主进程事务内完成。
     * @param sessionId - 要更新的会话 ID。
     * @param message - 要持久化的消息。
     */
    async addSessionMessage(sessionId: string | null, message: Message): Promise<void> {
      if (!sessionId) return;
      if (!is.persistableMessage(message)) return;

      const record = toRecordMessage(sessionId, message);
      await retryDuringDatabaseInitialization(async () => {
        const result = await getElectronAPI().chatMessageAdd(record);
        unwrap(result);
      });
      this.sessions = touchSession(this.sessions, sessionId, record.createdAt);
    },

    /**
     * 更新或创建单条消息，不累计会话用量。
     * 用于流式 assistant 草稿持久化和硬中断恢复回写。
     * @param sessionId - 要更新的会话 ID。
     * @param message - 要更新的消息。
     */
    async updateSessionMessage(sessionId: string | null | undefined, message: Message): Promise<void> {
      if (!sessionId) return;
      if (!is.persistableMessage(message)) return;

      const record = toRecordMessage(sessionId, message);
      await retryDuringDatabaseInitialization(async () => {
        const result = await getElectronAPI().chatMessageUpdate(record);
        unwrap(result);
      });
    },

    /**
     * 替换会话的所有已持久化消息，并重新计算汇总使用量。
     * DELETE + INSERT + usage/lastMessageAt 在主进程事务内原子完成。
     * @param sessionId - 要更新的会话 ID。
     * @param messages - 要持久化的完整消息列表。
     */
    async setSessionMessages(sessionId: string | null | undefined, messages: Message[]): Promise<void> {
      if (!sessionId) return;

      const persistableMessages = messages.filter(is.persistableMessage);
      const records = persistableMessages.map((message) => toRecordMessage(sessionId, message));

      await retryDuringDatabaseInitialization(async () => {
        const result = await getElectronAPI().chatMessageSetAll(sessionId, records);
        unwrap(result);
      });
    },

    /**
     * 仅更新会话标题，保持排序和使用量元数据不变。
     * @param sessionId - 要更新的会话 ID。
     * @param title - 新的会话标题。
     */
    async updateSessionTitle(sessionId: string, title: string): Promise<void> {
      await retryDuringDatabaseInitialization(async () => {
        const result = await getElectronAPI().chatSessionUpdateTitle(sessionId, title);
        unwrap(result);
      });

      const session = this.findSession(sessionId);
      if (session) this.sessions = mergeSessions([{ ...session, title }], this.sessions);

      await asyncTo(useRecentStore().updateChatRecordTitle(sessionId, title));
    },

    /**
     * 删除会话及其已持久化的消息。
     * @param sessionId - 要删除的会话 ID。
     */
    async deleteSession(sessionId: string): Promise<void> {
      await retryDuringDatabaseInitialization(async () => {
        const result = await getElectronAPI().chatSessionDelete(sessionId);
        unwrap(result);
      });
      this.sessions = removeSession(this.sessions, sessionId);
      await asyncTo(useRecentStore().removeFile(createChatRecentId(sessionId)));

      // 级联清理该会话的 todo 数据（在 unwrap 成功后执行，try-catch 防止中断删除流程）
      try {
        useTodoStore().clearTodos(sessionId);
      } catch {
        // todo 清理失败不影响会话删除结果
      }
    }
  }
});
