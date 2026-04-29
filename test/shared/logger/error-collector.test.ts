/**
 * @file error-collector.test.ts
 * @description 渲染进程错误收集器测试
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock logger
const loggerErrorMock = vi.fn();

vi.mock('@/shared/logger/index', () => ({
  logger: {
    error: loggerErrorMock
  }
}));

/**
 * 重置测试状态
 */
function resetState(): void {
  loggerErrorMock.mockReset();
  global.window = {
    onerror: null,
    onunhandledrejection: null
  } as unknown as Window & typeof globalThis;
  vi.resetModules();
}

describe('error-collector', () => {
  beforeEach(() => {
    resetState();
    vi.useFakeTimers();
  });

  describe('initErrorCollector', () => {
    it('should register window.onerror handler', async () => {
      const { initErrorCollector } = await import('../../../src/shared/logger/error-collector');

      expect(window.onerror).toBeNull();
      initErrorCollector();
      expect(typeof window.onerror).toBe('function');
    });

    it('should register window.onunhandledrejection handler', async () => {
      const { initErrorCollector } = await import('../../../src/shared/logger/error-collector');

      expect(window.onunhandledrejection).toBeNull();
      initErrorCollector();
      expect(typeof window.onunhandledrejection).toBe('function');
    });

    it('should capture window.onerror and report to logger', async () => {
      const { initErrorCollector } = await import('../../../src/shared/logger/error-collector');
      initErrorCollector();

      const error = new Error('Test window error');
      window.onerror?.('Test window error', 'test.js', 10, 20, error);

      await vi.runAllTimersAsync();

      expect(loggerErrorMock).toHaveBeenCalledTimes(1);
      expect(loggerErrorMock).toHaveBeenCalledWith(expect.stringContaining('[renderer]'));
      expect(loggerErrorMock).toHaveBeenCalledWith(expect.stringContaining('Test window error'));
    });

    it('should return false from onerror to allow default behavior', async () => {
      const { initErrorCollector } = await import('../../../src/shared/logger/error-collector');
      initErrorCollector();

      const result = window.onerror?.('test', 'test.js', 1, 1, new Error('test'));

      expect(result).toBe(false);
    });
  });

  describe('captureError', () => {
    it('should report Error instance to logger', async () => {
      const { captureError } = await import('../../../src/shared/logger/error-collector');

      captureError(new Error('Manual error'));

      await vi.runAllTimersAsync();

      expect(loggerErrorMock).toHaveBeenCalledTimes(1);
      expect(loggerErrorMock).toHaveBeenCalledWith(expect.stringContaining('Manual error'));
    });

    it('should convert string error to Error instance', async () => {
      const { captureError } = await import('../../../src/shared/logger/error-collector');

      captureError('String error message');

      await vi.runAllTimersAsync();

      expect(loggerErrorMock).toHaveBeenCalledTimes(1);
      expect(loggerErrorMock).toHaveBeenCalledWith(expect.stringContaining('String error message'));
    });

    it('should include context in error message', async () => {
      const { captureError } = await import('../../../src/shared/logger/error-collector');

      captureError(new Error('With context'), { userId: '123', action: 'click' });

      await vi.runAllTimersAsync();

      expect(loggerErrorMock).toHaveBeenCalledWith(expect.stringContaining('"userId":"123"'));
      expect(loggerErrorMock).toHaveBeenCalledWith(expect.stringContaining('"action":"click"'));
    });
  });

  describe('rate limiting', () => {
    it('should limit reports to 10 per 10 seconds', async () => {
      const { captureError } = await import('../../../src/shared/logger/error-collector');

      // 发送 12 个错误
      for (let i = 0; i < 12; i++) {
        captureError(new Error(`Error ${i}`));
      }

      await vi.runAllTimersAsync();

      // 只有前 10 个被上报
      expect(loggerErrorMock).toHaveBeenCalledTimes(10);
    });

    it('should reset limit after window expires', async () => {
      const { captureError } = await import('../../../src/shared/logger/error-collector');

      // 发送 10 个错误，达到上限
      for (let i = 0; i < 10; i++) {
        captureError(new Error(`Error ${i}`));
      }

      await vi.runAllTimersAsync();
      expect(loggerErrorMock).toHaveBeenCalledTimes(10);

      // 时间前进 10 秒，窗口重置
      vi.advanceTimersByTime(10001);

      // 再发送一个错误
      captureError(new Error('After window reset'));
      await vi.runAllTimersAsync();

      expect(loggerErrorMock).toHaveBeenCalledTimes(11);
    });
  });

  describe('deduplication', () => {
    it('should deduplicate identical errors within 5 minutes', async () => {
      const { captureError } = await import('../../../src/shared/logger/error-collector');

      // 发送相同的错误 3 次
      for (let i = 0; i < 3; i++) {
        captureError(new Error('Duplicate error'));
      }

      await vi.runAllTimersAsync();

      // 只上报一次
      expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    });

    it('should allow same error after dedup window expires', async () => {
      const { captureError } = await import('../../../src/shared/logger/error-collector');

      captureError(new Error('Deduplicated error'));
      await vi.runAllTimersAsync();
      expect(loggerErrorMock).toHaveBeenCalledTimes(1);

      // 时间前进 5 分钟 + 1 毫秒
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      captureError(new Error('Deduplicated error'));
      await vi.runAllTimersAsync();

      expect(loggerErrorMock).toHaveBeenCalledTimes(2);
    });

    it('should deduplicate errors with dynamic IDs normalized', async () => {
      const { captureError } = await import('../../../src/shared/logger/error-collector');

      // 错误消息包含不同数字 ID，但应被规范化后去重
      captureError(new Error('User 1234 not found'));
      captureError(new Error('User 5678 not found'));
      captureError(new Error('User 9999 not found'));

      await vi.runAllTimersAsync();

      // 都被归一化为 "User <NUM> not found"，只上报一次
      expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('message normalization', () => {
    it('should normalize UUID in error messages', async () => {
      const { captureError } = await import('../../../src/shared/logger/error-collector');

      captureError(new Error('User 550e8400-e29b-41d4-a716-446655440000 not found'));
      captureError(new Error('User a1b2c3d4-e5f6-7890-abcd-ef1234567890 not found'));

      await vi.runAllTimersAsync();

      expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    });

    it('should normalize hex hash in error messages', async () => {
      const { captureError } = await import('../../../src/shared/logger/error-collector');

      captureError(new Error('Hash abcdef1234567890 failed'));
      captureError(new Error('Hash 0123456789abcdef failed'));

      await vi.runAllTimersAsync();

      expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('error formatting', () => {
    it('should include error stack trace', async () => {
      const { captureError } = await import('../../../src/shared/logger/error-collector');
      const error = new Error('Stack test');

      captureError(error);
      await vi.runAllTimersAsync();

      expect(loggerErrorMock).toHaveBeenCalledWith(expect.stringContaining('Stack:'));
      expect(loggerErrorMock).toHaveBeenCalledWith(expect.stringContaining('Error: Stack test'));
    });

    it('should truncate long stack traces', async () => {
      const { captureError } = await import('../../../src/shared/logger/error-collector');
      const error = new Error('Long stack');
      // 创建 60 行堆栈
      error.stack = `Error: Long stack\n${Array(60).fill('    at someFunction (file.js:1:1)').join('\n')}`;

      captureError(error);
      await vi.runAllTimersAsync();

      const callArg = loggerErrorMock.mock.calls[0][0] as string;
      const stackLines = callArg.split('\n').filter((line) => line.includes('at someFunction'));

      // 堆栈被截断到 50 行 + "..."
      expect(stackLines.length).toBeLessThanOrEqual(50);
      expect(callArg).toContain('...');
    });
  });
});
