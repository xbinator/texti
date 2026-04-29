/**
 * @file index.ts
 * @description 渲染进程日志 API 单例，封装 window.electronAPI.logger 调用。
 * 在非 Electron 环境（如浏览器开发）下自动降级为 no-op。
 */
import type { LogEntry, LogQueryOptions, LogFileInfo } from './types';

class Logger {
  /**
   * 获取当前可用的 logger API 实例
   * 非 Electron 环境下返回 undefined，调用方需自行处理空值
   */
  private get api() {
    return window.electronAPI?.logger;
  }

  /**
   * 写入 ERROR 级别日志
   * @param message - 日志消息
   */
  async error(message: string): Promise<void> {
    if (!this.api) return;
    try {
      await this.api.error(message);
    } catch {
      // 写入失败时静默处理
    }
  }

  /**
   * 写入 WARN 级别日志
   * @param message - 日志消息
   */
  async warn(message: string): Promise<void> {
    if (!this.api) return;
    try {
      await this.api.warn(message);
    } catch {
      // 写入失败时静默处理
    }
  }

  /**
   * 写入 INFO 级别日志
   * @param message - 日志消息
   */
  async info(message: string): Promise<void> {
    if (!this.api) return;
    try {
      await this.api.info(message);
    } catch {
      // 写入失败时静默处理
    }
  }

  /**
   * 读取日志文件内容
   * @param options - 查询参数
   * @returns 日志条目数组
   */
  async getLogs(options: LogQueryOptions = {}): Promise<LogEntry[]> {
    if (!this.api) return [];
    return this.api.getLogs(options);
  }

  /**
   * 获取日志文件列表
   * @returns 日志文件信息数组
   */
  async getLogFiles(): Promise<LogFileInfo[]> {
    if (!this.api) return [];
    return this.api.getLogFiles();
  }

  /**
   * 在系统文件管理器中打开日志目录
   */
  async openLogFolder(): Promise<void> {
    if (!this.api) return;
    return this.api.openLogFolder();
  }
}

/** 全局日志单例 */
export const logger = new Logger();
