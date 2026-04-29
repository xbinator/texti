/**
 * @file logger-file.test.ts
 * @description 日志文件收集系统核心功能测试。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LogLevel } from '../../electron/main/modules/logger/types.mjs';

/**
 * 测试用的临时日志目录
 */
const TEST_LOG_DIR = path.join(process.cwd(), 'test/', '.temp-logs');

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'logs') return TEST_LOG_DIR;
      return path.join(process.cwd(), 'test/', '.temp');
    }),
    getName: vi.fn(() => 'Tibis')
  }
}));

describe('logger-file', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_LOG_DIR)) {
      fs.rmSync(TEST_LOG_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_LOG_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_LOG_DIR)) {
      fs.rmSync(TEST_LOG_DIR, { recursive: true });
    }
  });

  it('should write log entry to file', async () => {
    const { writeLog } = await import('../../electron/main/modules/logger/service.mjs');

    writeLog({
      level: LogLevel.INFO,
      message: 'test message',
      scope: 'main'
    });

    const files = fs.readdirSync(TEST_LOG_DIR);
    expect(files.length).toBeGreaterThan(0);
    const content = fs.readFileSync(path.join(TEST_LOG_DIR, files[0]), 'utf-8');
    expect(content).toContain('[INFO]');
    expect(content).toContain('[main]');
    expect(content).toContain('test message');
  });

  it('should serialize newlines in messages', async () => {
    const { writeLog } = await import('../../electron/main/modules/logger/service.mjs');

    writeLog({
      level: LogLevel.ERROR,
      message: 'line1\nline2',
      scope: 'renderer'
    });

    const files = fs.readdirSync(TEST_LOG_DIR);
    const content = fs.readFileSync(path.join(TEST_LOG_DIR, files[0]), 'utf-8');
    expect(content).toContain('line1');
  });

  it('should read logs with filtering', async () => {
    const { writeLog, readLogs } = await import('../../electron/main/modules/logger/service.mjs');

    writeLog({ level: LogLevel.INFO, message: 'info msg', scope: 'main' });
    writeLog({ level: LogLevel.ERROR, message: 'error msg', scope: 'renderer' });

    const errorLogs = readLogs({ level: LogLevel.ERROR });
    expect(errorLogs.length).toBeGreaterThanOrEqual(1);
    expect(errorLogs[0].level).toBe(LogLevel.ERROR);
    expect(errorLogs[0].message).toBe('error msg');
  });

  it('should return newest-first order', async () => {
    const { writeLog, readLogs } = await import('../../electron/main/modules/logger/service.mjs');

    writeLog({ level: LogLevel.INFO, message: 'first', scope: 'main' });
    writeLog({ level: LogLevel.INFO, message: 'second', scope: 'main' });

    const logs = readLogs();
    expect(logs[0].message).toBe('second');
  });

  it('should respect limit and offset', async () => {
    const { writeLog, readLogs } = await import('../../electron/main/modules/logger/service.mjs');

    for (let i = 0; i < 5; i++) {
      writeLog({ level: LogLevel.INFO, message: `msg-${i}`, scope: 'main' });
    }

    const page1 = readLogs({ limit: 2, offset: 0 });
    expect(page1.length).toBe(2);

    const page2 = readLogs({ limit: 2, offset: 2 });
    expect(page2.length).toBe(2);
    expect(page1[0].message).not.toBe(page2[0].message);
  });
});
