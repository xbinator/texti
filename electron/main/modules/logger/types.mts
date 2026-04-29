/**
 * @file types.mts
 * @description 日志收集系统的类型定义，供主进程 logger-core 和 IPC 模块共用。
 */

/**
 * 日志级别
 */
export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
}

/**
 * 进程来源标识
 */
export type LogScope = 'main' | 'renderer' | 'preload';

/**
 * 日志条目（写入时的原始数据）
 */
export interface LogEntryInput {
  /** 日志级别 */
  level: LogLevel;
  /** 日志消息内容 */
  message: string;
  /** 进程来源标识 */
  scope: LogScope;
  /** 原始时间戳字符串，不传则使用主进程当前时间 */
  timestamp?: string;
}

/**
 * 日志条目（读取时的数据格式）
 */
export interface LogEntry {
  /** 日志级别 */
  level: LogLevel;
  /** 日志消息内容 */
  message: string;
  /** 进程来源标识 */
  scope: LogScope;
  /** 格式化后的时间戳字符串 YYYY-MM-DD HH:mm:ss.SSS */
  timestamp: string;
}

/**
 * 日志查询参数
 */
export interface LogQueryOptions {
  /** 筛选日志级别 */
  level?: LogLevel;
  /** 筛选进程来源 */
  scope?: LogScope;
  /** 关键字搜索（匹配 message 字段） */
  keyword?: string;
  /** 查询日期（YYYY-MM-DD），不传则查当天 */
  date?: string;
  /** 返回条数上限，默认 500 */
  limit?: number;
  /**
   * 分页偏移量，默认 0
   * 语义：过滤后结果集的行偏移量，不是文件原始行号。
   * 每次 readLogs 都会全量读取并过滤文件，offset 只影响最终 slice 范围。
   */
  offset?: number;
}

/**
 * 日志文件信息
 */
export interface LogFileInfo {
  /** 日志文件相对名称 */
  name: string;
  /** 文件大小（字节） */
  size: number;
  /** 文件创建时间 ISO 字符串 */
  createdAt: string;
}
