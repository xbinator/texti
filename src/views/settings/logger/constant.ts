/**
 * @file constant.ts
 * @description 日志查看器常量配置，包含日志级别和来源的中英文对应
 */

import type { LogLevel, LogScope } from '@/shared/logger/types';

/**
 * 日志级别配置项
 */
interface LogLevelConfig {
  /** 中文标签 */
  label: string;
  /** Ant Design Tag 颜色 */
  color: string;
}

/**
 * 日志级别配置映射表
 */
export const LOG_LEVEL_CONFIG: Record<LogLevel | 'ALL', LogLevelConfig> = {
  ALL: {
    label: '全部',
    color: 'default'
  },
  ERROR: {
    label: '错误',
    color: 'error'
  },
  WARN: {
    label: '警告',
    color: 'warning'
  },
  INFO: {
    label: '信息',
    color: 'processing'
  }
};

/**
 * 获取日志级别配置
 * @param level - 日志级别
 * @returns 日志级别配置，不存在时返回默认配置
 */
export function getLogLevelConfig(level: LogLevel | ''): LogLevelConfig {
  if (level === '') {
    return LOG_LEVEL_CONFIG.ALL;
  }
  return LOG_LEVEL_CONFIG[level] || LOG_LEVEL_CONFIG.ALL;
}

/**
 * 获取日志级别颜色
 * @param level - 日志级别
 * @returns Ant Design Tag 颜色值
 */
export function getLogLevelColor(level: LogLevel | ''): string {
  return getLogLevelConfig(level).color;
}

/**
 * 获取日志级别中文标签
 * @param level - 日志级别
 * @returns 中文标签
 */
export function getLogLevelLabel(level: LogLevel | ''): string {
  return getLogLevelConfig(level).label;
}

/**
 * 日志来源配置项
 */
interface LogScopeConfig {
  /** 中文标签 */
  label: string;
}

/**
 * 日志来源配置映射表
 */
export const LOG_SCOPE_CONFIG: Record<LogScope | 'ALL', LogScopeConfig> = {
  ALL: {
    label: '全部来源'
  },
  main: {
    label: '主进程'
  },
  renderer: {
    label: '渲染进程'
  },
  preload: {
    label: '预加载脚本'
  }
};

/**
 * 获取日志来源配置
 * @param scope - 日志来源
 * @returns 日志来源配置，不存在时返回默认配置
 */
export function getLogScopeConfig(scope: LogScope | ''): LogScopeConfig {
  if (scope === '') {
    return LOG_SCOPE_CONFIG.ALL;
  }
  return LOG_SCOPE_CONFIG[scope] || LOG_SCOPE_CONFIG.ALL;
}

/**
 * 获取日志来源中文标签
 * @param scope - 日志来源
 * @returns 中文标签
 */
export function getLogScopeLabel(scope: LogScope | ''): string {
  return getLogScopeConfig(scope).label;
}
