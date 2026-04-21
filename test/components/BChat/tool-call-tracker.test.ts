/**
 * @file tool-call-tracker.test.ts
 * @description BChat 工具调用跟踪器测试
 */
import { describe, expect, it } from 'vitest';
import { createToolCallTracker } from '@/components/BChat/utils/tool-call-tracker';

/**
 * 创建可手动控制完成时机的 Promise
 */
function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;

  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

describe('BChat tool call tracker', () => {
  it('waits for tracked tool calls to finish before resolving', async () => {
    const tracker = createToolCallTracker();
    const deferred = createDeferred();
    let resolved = false;

    tracker.track(deferred.promise);
    const waitTask = tracker.waitForAll().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    deferred.resolve();
    await waitTask;

    expect(resolved).toBe(true);
  });
});
