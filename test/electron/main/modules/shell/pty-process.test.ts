/**
 * @file pty-process.test.ts
 * @description PTY 进程适配器的 spawn、订阅、写入和释放测试。
 */
import { describe, expect, it, vi } from 'vitest';
import { createPtyFactory, type NativePtyLike } from '../../../../../electron/main/modules/shell/interaction/pty-process.mts';

describe('PtyProcessAdapter', (): void => {
  it('adapts native PTY lifecycle without prompt policy', (): void => {
    const dataListeners: Array<(data: string) => void> = [];
    const exitListeners: Array<(event: { exitCode: number; signal?: number }) => void> = [];
    const native: NativePtyLike = {
      pid: 123,
      write: vi.fn(),
      kill: vi.fn(),
      onData: (listener) => {
        dataListeners.push(listener);
        return { dispose: vi.fn() };
      },
      onExit: (listener) => {
        exitListeners.push(listener);
        return { dispose: vi.fn() };
      }
    };
    const spawn = vi.fn((): NativePtyLike => native);
    const process = createPtyFactory(spawn).spawn({ shell: 'bash', command: 'echo ok', cwd: '/workspace', columns: 80, rows: 24 });
    const onData = vi.fn();
    const onExit = vi.fn();
    process.onData(onData);
    process.onExit(onExit);

    dataListeners[0]?.('ok');
    exitListeners[0]?.({ exitCode: 0 });
    process.write('\r');
    process.kill('SIGTERM');

    expect(spawn).toHaveBeenCalledWith('bash', ['--noprofile', '--norc', '-c', 'echo ok'], expect.objectContaining({ cwd: '/workspace', cols: 80, rows: 24 }));
    expect(onData).toHaveBeenCalledWith('ok');
    expect(onExit).toHaveBeenCalledWith({ exitCode: 0, signal: undefined });
    expect(native.write).toHaveBeenCalledWith('\r');
    expect(native.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
