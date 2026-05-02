/**
 * @file useVoiceRecorder.ts
 * @description 维护语音录音器的最小状态与波形采样输出。
 */
import { ref } from 'vue';
import { noop } from 'lodash-es';

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/** 录音器当前状态。 */
export type VoiceRecorderStatus = 'idle' | 'recording' | 'stopping';

/** 单段录音结果。 */
export interface VoiceRecorderSegment {
  /** 音频二进制数据。 */
  buffer: ArrayBuffer;
  /** 音频 MIME 类型。 */
  mimeType: string;
}

/** 录音器配置。 */
export interface VoiceRecorderOptions {
  /** 单段录音完成时的回调。 */
  onSegment?: (segment: VoiceRecorderSegment) => Promise<void> | void;
  /** 自动切片时长（毫秒），默认 4000。 */
  segmentDurationMs?: number;
}

// ─── 常量 ────────────────────────────────────────────────────────────────────

const PREFERRED_MIME = 'audio/webm;codecs=opus';
const FALLBACK_MIME = 'audio/webm';
const STOP_TIMEOUT_MS = 5000;
const FFT_SIZE = 64;
const WAVEFORM_BINS = 13;

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * 语音录音器 hook。
 * @returns 录音状态、波形采样与控制方法。
 */
export function useVoiceRecorder(options: VoiceRecorderOptions = {}) {
  const status = ref<VoiceRecorderStatus>('idle');
  const waveformSamples = ref<number[]>([]);

  // 内部状态，不对外暴露
  const mediaRecorder = ref<MediaRecorder | null>(null);
  const mediaStream = ref<MediaStream | null>(null);
  const audioContext = ref<AudioContext | null>(null);
  const analyserNode = ref<AnalyserNode | null>(null);
  const recordedChunks = ref<Blob[]>([]);
  const activeMimeType = ref<string>(FALLBACK_MIME);

  // 哨兵值 -1 表示「无动画帧」，避免 null 检查
  let waveformFrameId = -1;
  // 每个实例独立持有自己的 delivery queue，避免多实例共享
  let segmentDeliveryQueue = Promise.resolve();

  // ── 波形采样 ──────────────────────────────────────────────────────────────

  function stopWaveformLoop(): void {
    if (waveformFrameId !== -1) {
      cancelAnimationFrame(waveformFrameId);
      waveformFrameId = -1;
    }
    waveformSamples.value = [];
  }

  function startWaveformLoop(stream: MediaStream): void {
    if (typeof AudioContext === 'undefined') {
      waveformSamples.value = [1, 2, 1];
      return;
    }

    const ctx = new AudioContext();
    audioContext.value = ctx;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    ctx.createMediaStreamSource(stream).connect(analyser);
    analyserNode.value = analyser;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const tick = (): void => {
      analyser.getByteFrequencyData(dataArray);
      waveformSamples.value = Array.from(dataArray.subarray(0, WAVEFORM_BINS)).map((s) => Math.max(Math.round(s / 32), 1));
      waveformFrameId = requestAnimationFrame(tick);
    };

    waveformFrameId = requestAnimationFrame(tick);
  }

  // ── 资源清理 ──────────────────────────────────────────────────────────────

  /**
   * 统一清理所有录音资源。
   * @param preserveChunks - 为 true 时保留已录音片段（stop 流程用）。
   */
  function cleanupResources(preserveChunks = false): void {
    stopWaveformLoop();

    mediaStream.value?.getTracks().forEach((t) => t.stop());
    mediaStream.value = null;

    mediaRecorder.value = null;

    // 显式关闭 AudioContext，释放系统音频资源
    audioContext.value?.close().catch(noop);
    audioContext.value = null;
    analyserNode.value = null;

    if (!preserveChunks) {
      recordedChunks.value = [];
    }

    status.value = 'idle';
  }

  // ── 音频段投递 ────────────────────────────────────────────────────────────

  /**
   * 将一个 Blob 片段序列化后通过 onSegment 回调投递。
   * 投递操作串行排队，保证顺序且不阻塞录音主流程。
   */
  function enqueueSegment(blob: Blob): void {
    if (!options.onSegment) return;

    const { onSegment } = options;
    segmentDeliveryQueue = segmentDeliveryQueue.then(async () => {
      try {
        await onSegment({
          buffer: await blob.arrayBuffer(),
          mimeType: blob.type || activeMimeType.value
        });
      } catch (err) {
        //
      }
    });
  }

  // ── 对外接口 ──────────────────────────────────────────────────────────────

  /** 开始录音。 */
  async function start(): Promise<void> {
    // SSR / 测试环境降级
    if (typeof navigator === 'undefined' || typeof MediaRecorder === 'undefined') {
      status.value = 'recording';
      return;
    }

    recordedChunks.value = [];
    segmentDeliveryQueue = Promise.resolve();

    mediaStream.value = await navigator.mediaDevices.getUserMedia({ audio: true });
    startWaveformLoop(mediaStream.value);

    activeMimeType.value = MediaRecorder.isTypeSupported(PREFERRED_MIME) ? PREFERRED_MIME : FALLBACK_MIME;

    const recorder = new MediaRecorder(mediaStream.value, { mimeType: activeMimeType.value });
    recorder.ondataavailable = ({ data }: BlobEvent) => {
      if (data.size === 0) return;
      recordedChunks.value.push(data);
      enqueueSegment(data);
    };

    mediaRecorder.value = recorder;
    recorder.start(options.segmentDurationMs ?? 4000);
    status.value = 'recording';
  }

  /** 正常停止录音，等待所有音频段投递完毕后返回。 */
  async function stop(): Promise<void> {
    const recorder = mediaRecorder.value;
    if (!recorder) {
      cleanupResources();
      return;
    }

    status.value = 'stopping';

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanupResources();
        resolve();
      }, STOP_TIMEOUT_MS);

      recorder.onstop = async () => {
        clearTimeout(timer);
        try {
          // 等待最后一批音频段全部投递完成，再清理资源
          await segmentDeliveryQueue;
          cleanupResources(/* preserveChunks */ true);
          resolve();
        } catch (err) {
          cleanupResources();
          reject(err);
        }
      };

      recorder.stop();
    });
  }

  /** 取消录音，丢弃全部已录音数据。 */
  async function cancel(): Promise<void> {
    const recorder = mediaRecorder.value;
    if (!recorder) {
      cleanupResources();
      return;
    }

    // 先清除回调，再 stop，确保 ondataavailable 触发后不会再入队
    recorder.ondataavailable = null;
    recorder.onstop = noop;

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    cleanupResources();
  }

  return {
    status,
    waveformSamples,
    start,
    stop,
    cancel
  };
}
