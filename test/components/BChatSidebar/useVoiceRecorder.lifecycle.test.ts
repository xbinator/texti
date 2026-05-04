/* @vitest-environment jsdom */
/**
 * @file useVoiceRecorder.lifecycle.test.ts
 * @description 验证录音器在停止时会等待底层音频资源彻底释放。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceRecorder } from '@/components/BChatSidebar/hooks/useVoiceRecorder';

/**
 * 可手动释放的 Promise 控制器。
 */
interface Deferred<T> {
  /** Promise 实例。 */
  promise: Promise<T>;
  /** 完成 Promise。 */
  resolve: (value: T | PromiseLike<T>) => void;
}

/**
 * AudioContext.close 调用桩。
 */
const audioContextCloseMock = vi.fn<() => Promise<void>>();

/**
 * 创建可手动控制的 Promise。
 * @returns Promise 控制器
 */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

beforeEach(() => {
  audioContextCloseMock.mockReset();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1)
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useVoiceRecorder lifecycle', () => {
  it('waits for AudioContext.close before resolving stop', async () => {
    const closeDeferred = createDeferred<void>();
    const stream = {
      getTracks: () => [
        {
          stop: vi.fn()
        }
      ]
    } as unknown as MediaStream;

    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => stream)
      }
    });

    class FakeAudioContext {
      /** 采样率。 */
      public sampleRate = 48000;

      /**
       * 创建分析节点。
       * @returns 假分析节点
       */
      createAnalyser(): AnalyserNode {
        return {
          fftSize: 0,
          frequencyBinCount: 32,
          getByteFrequencyData: vi.fn(),
          disconnect: vi.fn()
        } as unknown as AnalyserNode;
      }

      /**
       * 创建媒体源节点。
       * @returns 假源节点
       */
      createMediaStreamSource(): MediaStreamAudioSourceNode {
        return {
          connect: vi.fn(),
          disconnect: vi.fn()
        } as unknown as MediaStreamAudioSourceNode;
      }

      /**
       * 创建脚本处理节点。
       * @returns 假处理节点
       */
      createScriptProcessor(): ScriptProcessorNode {
        return {
          connect: vi.fn(),
          disconnect: vi.fn(),
          onaudioprocess: null
        } as unknown as ScriptProcessorNode;
      }

      /**
       * 关闭音频上下文。
       * @returns 关闭 Promise
       */
      close(): Promise<void> {
        return audioContextCloseMock().then(() => undefined);
      }
    }

    audioContextCloseMock.mockImplementation(() => closeDeferred.promise);
    vi.stubGlobal('AudioContext', FakeAudioContext);

    const recorder = useVoiceRecorder();
    await recorder.start();

    let stopResolved = false;
    const stopPromise = recorder.stop().then(() => {
      stopResolved = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(audioContextCloseMock).toHaveBeenCalledTimes(1);
    expect(stopResolved).toBe(false);

    closeDeferred.resolve();
    await stopPromise;

    expect(stopResolved).toBe(true);
    expect(recorder.status.value).toBe('idle');
  });
});
