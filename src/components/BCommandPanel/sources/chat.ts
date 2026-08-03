/**
 * @file chat.ts
 * @description BCommandPanel 聊天历史 source，负责会话搜索、日期分组与跳转。
 */
import type { CommandPanelActionItem, CommandPanelGroup, CommandPanelIconContext, CommandPanelSource } from '../types';
import type { ChatSession } from 'types/chat';
import type { VNodeChild } from 'vue';
import dayjs from 'dayjs';
import { groupBy, map } from 'lodash-es';

/**
 * 聊天 source 依赖。
 */
export interface ChatSourceDeps {
  /** 确保会话集合已完成首次加载。 */
  ensureLoaded: () => Promise<void> | void;
  /** 获取当前已加载的会话列表。 */
  getSessions: () => ChatSession[];
  /** 打开指定会话。 */
  openSession: (sessionId: string) => Promise<void> | void;
  /** 渲染会话图标。 */
  renderSessionIcon: (session: ChatSession, context: CommandPanelIconContext) => VNodeChild;
}

/**
 * 读取会话的可排序时间戳。
 * @param session - 聊天会话
 * @returns 优先使用 lastMessageAt，其次 updatedAt，最后 createdAt
 */
function getSessionTime(session: ChatSession): string {
  return session.lastMessageAt || session.updatedAt || session.createdAt;
}

/**
 * 将时间戳转换为日期键（YYYY-MM-DD 格式）。
 * @param timestamp - ISO 时间戳字符串
 * @returns 日期键
 */
function toDateKey(timestamp: string): string {
  return dayjs(timestamp).format('YYYY-MM-DD');
}

/**
 * 格式化会话日期为可读标签。
 * @param timestamp - ISO 时间戳字符串
 * @returns 格式化后的日期标签（今天/昨天/MM-DD）
 */
function formatSessionDay(timestamp: string): string {
  const date = dayjs(timestamp);
  const now = dayjs();

  if (date.isSame(now, 'day')) return '今天';

  const yesterday = now.subtract(1, 'day');
  if (date.isSame(yesterday, 'day')) return '昨天';

  return date.format('MM-DD');
}

/**
 * 判断会话是否匹配关键词。
 * @param session - 聊天会话
 * @param query - 小写关键词
 * @returns 是否匹配
 */
function isSessionMatched(session: ChatSession, query: string): boolean {
  return session.title.toLowerCase().includes(query);
}

/**
 * 将聊天会话转换为命令面板动作项。
 * @param session - 聊天会话
 * @param deps - source 依赖
 * @returns 命令面板动作项
 */
function createSessionItem(session: ChatSession, deps: ChatSourceDeps): CommandPanelActionItem {
  return {
    key: session.id,
    kind: 'chat',
    title: session.title.trim() || '未命名聊天',
    description: '',
    onSelect: async (): Promise<void> => {
      await deps.openSession(session.id);
    },
    renderIcon: (context) => deps.renderSessionIcon(session, context)
  };
}

/**
 * 创建聊天历史 source。
 * @param deps - source 依赖
 * @returns 聊天历史 source
 */
export function createChatSource(deps: ChatSourceDeps): CommandPanelSource {
  return {
    id: 'chat',
    load: deps.ensureLoaded,
    search: (keyword: string): CommandPanelGroup[] => {
      const query = keyword.trim().toLowerCase();
      const sessions = deps.getSessions().filter((session) => !query || isSessionMatched(session, query));

      if (!sessions.length) return [];

      const dateGroups = groupBy(sessions, (session: ChatSession) => toDateKey(getSessionTime(session)));

      return map(dateGroups, (groupSessions, key) => ({
        key,
        title: formatSessionDay(getSessionTime(groupSessions[0])),
        items: groupSessions.map((session) => createSessionItem(session, deps))
      }));
    }
  };
}
