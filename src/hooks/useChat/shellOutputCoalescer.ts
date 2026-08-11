/**
 * @file shellOutputCoalescer.ts
 * @description 合并 Shell 高频管道输出，同时保持 stdout 与 stderr 到达顺序。
 */
import type { ElectronShellCommandOutputChunk } from 'types/electron-api';
import { debounce } from 'lodash-es';

/** 单个同步 Shell 输出批次允许的最大分段数。 */
const SHELL_CHUNK_LIMIT = 512;
/** 单个同步 Shell 输出批次允许的最大 UTF-16 字符数。 */
const SHELL_TEXT_LIMIT = 64 * 1024;

/** Shell 输出合并器。 */
export interface ShellOutputCoalescer {
  /** 加入一个有序输出片段。 */
  push: (chunk: ElectronShellCommandOutputChunk) => void;
  /** 立即发布当前批次。 */
  flush: () => void;
  /** 丢弃当前批次并取消计时器。 */
  cancel: () => void;
}

/**
 * 创建单个 Shell 命令的 16/50ms 输出合并器。
 * @param emit - 发布有序安全批次
 * @returns Shell 输出合并器
 */
export function createShellOutputCoalescer(emit: (chunks: ElectronShellCommandOutputChunk[]) => void): ShellOutputCoalescer {
  let pendingChunks: ElectronShellCommandOutputChunk[] = [];
  let pendingTextLength = 0;

  /** 发布并清空当前批次。 */
  function emitPendingChunks(): void {
    if (pendingChunks.length === 0) return;
    const chunks = pendingChunks;
    pendingChunks = [];
    pendingTextLength = 0;
    emit(chunks);
  }

  const scheduleEmit = debounce(emitPendingChunks, 16, { maxWait: 50 });

  return {
    push(chunk: ElectronShellCommandOutputChunk): void {
      const tail = pendingChunks.at(-1);
      if (tail && tail.commandId === chunk.commandId && tail.stream === chunk.stream) {
        pendingChunks.splice(pendingChunks.length - 1, 1, { ...chunk, text: `${tail.text}${chunk.text}` });
      } else {
        pendingChunks.push(chunk);
      }
      pendingTextLength += chunk.text.length;
      scheduleEmit();
      if (pendingChunks.length >= SHELL_CHUNK_LIMIT || pendingTextLength >= SHELL_TEXT_LIMIT) {
        scheduleEmit.cancel();
        emitPendingChunks();
      }
    },
    flush(): void {
      scheduleEmit.cancel();
      emitPendingChunks();
    },
    cancel(): void {
      scheduleEmit.cancel();
      pendingChunks = [];
      pendingTextLength = 0;
    }
  };
}
