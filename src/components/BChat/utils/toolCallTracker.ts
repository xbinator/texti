/* eslint-disable no-await-in-loop */
/**
 * @file toolCallTracker.ts
 * @description BChat 工具调用异步任务跟踪器。
 */

/**
 * 工具调用异步任务跟踪器
 */
export interface ToolCallTracker {
  /**
   * 记录一个进行中的工具调用任务
   * @param task - 待跟踪的任务
   */
  track<T>(task: Promise<T>): Promise<T>;
  /**
   * 等待当前已登记的所有工具调用任务完成
   */
  waitForAll(): Promise<void>;
}

/**
 * 创建工具调用异步任务跟踪器
 */
export function createToolCallTracker(): ToolCallTracker {
  const inflightTasks = new Set<Promise<unknown>>();

  return {
    track<T>(task: Promise<T>): Promise<T> {
      inflightTasks.add(task);
      // eslint-disable-next-line no-void
      void task.finally(() => {
        inflightTasks.delete(task);
      });

      return task;
    },
    async waitForAll(): Promise<void> {
      while (inflightTasks.size) {
        await Promise.allSettled([...inflightTasks]);
      }
    }
  };
}
