/**
 * @file environment.ts
 * @description 内置环境只读工具实现。
 */
import type { AIToolExecutor } from 'types/ai';
import { createToolSuccessResult } from '../results';

/**
 * 当前时间结果。
 */
export interface GetCurrentTimeResult {
  /** ISO 8601 时间字符串 */
  iso: string;
  /** Unix 毫秒时间戳 */
  timestamp: number;
  /** 本地格式化时间字符串 */
  locale: string;
}

/**
 * 内置环境工具集合。
 */
export interface BuiltinEnvironmentTools {
  /** 获取当前时间工具 */
  getCurrentTime: AIToolExecutor<Record<string, never>, GetCurrentTimeResult>;
}

/**
 * 创建内置环境工具。
 * @returns 环境工具执行器对象
 */
export function createBuiltinEnvironmentTools(): BuiltinEnvironmentTools {
  return {
    getCurrentTime: {
      definition: {
        name: 'get_current_time',
        description: '获取当前系统时间，返回 ISO、时间戳和本地格式化字符串。',
        source: 'builtin',
        permission: 'read',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      },
      async execute() {
        const now = new Date();

        return createToolSuccessResult('get_current_time', {
          iso: now.toISOString(),
          timestamp: now.getTime(),
          locale: now.toLocaleString()
        });
      }
    }
  };
}
