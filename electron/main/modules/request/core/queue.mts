/**
 * @file queue.mts
 * @description 平台托管 request 的主进程并发队列。
 */

/** 托管请求入队配置。 */
export interface RequestQueueAddOptions {
  /** 调用方取消信号。 */
  signal?: AbortSignal;
}

/**
 * 托管请求队列。
 */
export interface RequestQueue {
  /**
   * 添加一个异步任务到队列。
   * @param run - 异步任务
   * @returns 任务结果
   */
  add: <T>(run: () => Promise<T>, options?: RequestQueueAddOptions) => Promise<T>;
  /** 读取当前活动任务数。 */
  getActiveCount: () => number;
  /** 读取当前等待任务数。 */
  getPendingCount: () => number;
}

/**
 * 托管请求等待队列任务。
 */
interface RequestQueuedTask<T> {
  /** 执行函数。 */
  run: () => Promise<T>;
  /** 成功回调。 */
  resolve: (value: T) => void;
  /** 失败回调。 */
  reject: (reason: unknown) => void;
  /** 取消等待队列监听。 */
  removeAbortListener: () => void;
}

/**
 * 创建带固定等待上限的并发队列。
 * @param concurrency - 最大并发数
 * @param maxPending - 最大等待任务数
 * @returns 托管请求队列
 */
export function createRequestQueue(concurrency: number, maxPending: number): RequestQueue {
  const maxConcurrency = Math.max(1, concurrency);
  const maxPendingCount = Math.max(0, maxPending);
  let activeCount = 0;
  const queue: Array<RequestQueuedTask<unknown>> = [];
  /** 推进等待队列。 */
  let runNext = (): void => undefined;

  /**
   * 处理任务完成后的队列推进。
   */
  function handleTaskSettled(): void {
    activeCount -= 1;
    runNext();
  }

  /**
   * 推进等待队列。
   */
  runNext = (): void => {
    while (activeCount < maxConcurrency && queue.length > 0) {
      const task = queue.shift();
      if (!task) return;

      task.removeAbortListener();
      activeCount += 1;
      Promise.resolve()
        .then(task.run)
        .then(
          (value: unknown): void => {
            // 先释放并发槽位，确保调用方 Promise 完成时队列计数已经归零。
            handleTaskSettled();
            task.resolve(value);
          },
          (error: unknown): void => {
            handleTaskSettled();
            task.reject(error);
          }
        );
    }
  };

  return {
    add<T>(run: () => Promise<T>, options: RequestQueueAddOptions = {}): Promise<T> {
      if (options.signal?.aborted) {
        return Promise.reject(options.signal.reason instanceof Error ? options.signal.reason : new Error('请求已取消'));
      }
      if (activeCount >= maxConcurrency && queue.length >= maxPendingCount) {
        return Promise.reject(new Error('请求队列已满，请稍后重试'));
      }

      return new Promise<T>((resolve, reject): void => {
        let queuedTask: RequestQueuedTask<unknown>;
        const handleAbort = (): void => {
          const taskIndex = queue.indexOf(queuedTask);
          if (taskIndex < 0) return;
          queue.splice(taskIndex, 1);
          reject(options.signal?.reason instanceof Error ? options.signal.reason : new Error('请求已取消'));
        };
        const removeAbortListener = (): void => options.signal?.removeEventListener('abort', handleAbort);
        queuedTask = {
          run: run as () => Promise<unknown>,
          resolve: resolve as (value: unknown) => void,
          reject,
          removeAbortListener
        };
        options.signal?.addEventListener('abort', handleAbort, { once: true });
        queue.push(queuedTask);
        runNext();
      });
    },
    getActiveCount: (): number => activeCount,
    getPendingCount: (): number => queue.length
  };
}
