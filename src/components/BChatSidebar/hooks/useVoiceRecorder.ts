/**
 * @file useVoiceRecorder.ts
 * @description 维护语音录音器的最小状态与波形采样输出。
 */
import { ref } from 'vue';

/**
 * 录音状态。
 */
export type VoiceRecorderStatus = 'idle' | 'recording' | 'stopping';

/**
 * 单段录音结果。
 */
export interface VoiceRecorderSegment {
  /** 音频二进制数据。 */
  buffer: ArrayBuffer;
  /** 音频 MIME 类型。 */
  mimeType: string;
}

/**
 * 录音器配置。
 */
export interface VoiceRecorderOptions {
  /** 单段录音完成时的回调。 */
  onSegment?: (segment: VoiceRecorderSegment) => Promise<void> | void;
  /** 自动切片时长，单位毫秒。 */
  segmentDurationMs?: number;
}

/**
 * 语音录音器 hook。
 * 当前为最小实现，后续再接入真实 MediaRecorder 与 AudioContext。
 * @returns 录音状态、波形采样与控制方法
 */
export function useVoiceRecorder(options: VoiceRecorderOptions = {}) {
  /**
   * 当前录音状态。
   */
  const status = ref<VoiceRecorderStatus>('idle');

  /**
   * 当前波形采样。
   */
  const waveformSamples = ref<number[]>([]);

  /**
   * 媒体录音器实例。
   */
  const mediaRecorder = ref<MediaRecorder | null>(null);

  /**
   * 当前媒体流。
   */
  const mediaStream = ref<MediaStream | null>(null);

  /**
   * 当前录音片段缓存。
   */
  const recordedChunks = ref<Blob[]>([]);

  /**
   * 录音 MIME 类型。
   */
  const mimeType = ref<string>('audio/webm');

  /**
   * 音频上下文实例。
   */
  const audioContext = ref<AudioContext | null>(null);

  /**
   * 波形分析节点。
   */
  const analyserNode = ref<AnalyserNode | null>(null);

  /**
   * 波形采样动画帧 ID。
   */
  const waveformFrameId = ref<number | null>(null);

  /**
   * 已投递的音频段回调串行队列。
   */
  let segmentDeliveryQueue: Promise<void> = Promise.resolve();

  /**
   * 停止当前波形采样循环。
   */
  function stopWaveformLoop(): void {
    if (waveformFrameId.value !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(waveformFrameId.value);
    }
    waveformFrameId.value = null;
    waveformSamples.value = [];
  }

  /**
   * 启动当前媒体流的波形采样。
   * @param stream - 当前录音媒体流
   */
  function startWaveformLoop(stream: MediaStream): void {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
      waveformSamples.value = [1, 2, 1];
      return;
    }

    audioContext.value = new AudioContext();
    const sourceNode = audioContext.value.createMediaStreamSource(stream);
    analyserNode.value = audioContext.value.createAnalyser();
    analyserNode.value.fftSize = 64;
    sourceNode.connect(analyserNode.value);

    const dataArray = new Uint8Array(analyserNode.value.frequencyBinCount);

    const tick = (): void => {
      if (!analyserNode.value) return;

      analyserNode.value.getByteFrequencyData(dataArray);
      waveformSamples.value = Array.from(dataArray.slice(0, 13)).map((sample) => Math.max(Math.round(sample / 32), 1));
      waveformFrameId.value = window.requestAnimationFrame(tick);
    };

    waveformFrameId.value = window.requestAnimationFrame(tick);
  }

  /**
   * 开始录音。
   */
  async function start(): Promise<void> {
    if (typeof navigator === 'undefined' || typeof MediaRecorder === 'undefined') {
      status.value = 'recording';
      return;
    }

    recordedChunks.value = [];
    mediaStream.value = await navigator.mediaDevices.getUserMedia({ audio: true });
    startWaveformLoop(mediaStream.value);
    mimeType.value = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    mediaRecorder.value = new MediaRecorder(mediaStream.value, { mimeType: mimeType.value });
    mediaRecorder.value.ondataavailable = (event: BlobEvent) => {
      if (event.data.size === 0) {
        return;
      }

      recordedChunks.value.push(event.data);
      const currentBlob = event.data;

      segmentDeliveryQueue = segmentDeliveryQueue.then(async () => {
        if (!options.onSegment) {
          return;
        }

        await options.onSegment({
          buffer: await currentBlob.arrayBuffer(),
          mimeType: currentBlob.type || mimeType.value
        });
      });
    };
    mediaRecorder.value.start(options.segmentDurationMs ?? 4000);
    status.value = 'recording';
  }

  /**
   * 停止录音。
   */
  async function stop(): Promise<void> {
    if (!mediaRecorder.value) {
      status.value = 'idle';
      return;
    }

    status.value = 'stopping';

    const recorder = mediaRecorder.value;
    await new Promise<void>((resolve) => {
      recorder.onstop = async () => {
        await segmentDeliveryQueue;
        recordedChunks.value = [];
        mediaRecorder.value = null;

        mediaStream.value?.getTracks().forEach((track) => {
          track.stop();
        });
        mediaStream.value = null;
        stopWaveformLoop();
        if (audioContext.value) {
          audioContext.value.close();
        }
        audioContext.value = null;
        analyserNode.value = null;
        status.value = 'idle';
        resolve();
      };
      recorder.stop();
    });
  }

  /**
   * 取消录音并清空当前缓存。
   */
  async function cancel(): Promise<void> {
    recordedChunks.value = [];
    mediaRecorder.value?.stop();
    mediaRecorder.value = null;
    mediaStream.value?.getTracks().forEach((track) => {
      track.stop();
    });
    mediaStream.value = null;
    stopWaveformLoop();
    if (audioContext.value) {
      audioContext.value.close();
    }
    audioContext.value = null;
    analyserNode.value = null;
    status.value = 'idle';
  }

  return {
    status,
    waveformSamples,
    start,
    stop,
    cancel
  };
}
