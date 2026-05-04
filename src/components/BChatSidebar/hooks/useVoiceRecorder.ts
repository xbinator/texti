/**
 * @file useVoiceRecorder.ts
 * @description 维护语音录音器的最小状态、PCM 采集、wav 编码与波形输出。
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

const STOP_TIMEOUT_MS = 5000;
const FFT_SIZE = 64;
const WAVEFORM_BINS = 13;
const TARGET_SAMPLE_RATE = 16000;
const TARGET_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const WAV_MIME_TYPE = 'audio/wav';

/**
 * 将浮点采样压缩到 Int16 范围。
 * @param sample - 原始浮点采样
 * @returns Int16 采样值
 */
function clampPcm16(sample: number): number {
  const normalized = Math.max(-1, Math.min(1, sample));
  return normalized < 0 ? normalized * 0x8000 : normalized * 0x7fff;
}

/**
 * 将单声道 Float32 PCM 编码为 16-bit PCM wav。
 * @param samples - 采样数组
 * @param sampleRate - 采样率
 * @returns wav ArrayBuffer
 */
export function encodeWavePcm16Mono(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  // 写入 RIFF 头
  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, 36 + dataLength, true);
  view.setUint32(8, 0x57415645, false);
  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, TARGET_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * TARGET_CHANNELS * (BITS_PER_SAMPLE / 8), true);
  view.setUint16(32, TARGET_CHANNELS * (BITS_PER_SAMPLE / 8), true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, dataLength, true);

  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(44 + index * 2, clampPcm16(samples[index]), true);
  }

  return buffer;
}

/**
 * 将输入采样率的单声道 PCM 重采样到目标采样率。
 * @param input - 原始 PCM
 * @param sourceRate - 原始采样率
 * @param targetRate - 目标采样率
 * @returns 重采样后的 PCM
 */
function resampleMonoPcm(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) {
    return input.slice();
  }

  const ratio = sourceRate / targetRate;
  const targetLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(targetLength);

  for (let index = 0; index < targetLength; index += 1) {
    const position = index * ratio;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.min(lowerIndex + 1, input.length - 1);
    const weight = position - lowerIndex;
    output[index] = input[lowerIndex] * (1 - weight) + input[upperIndex] * weight;
  }

  return output;
}

/**
 * 合并多段 PCM。
 * @param chunks - PCM 片段列表
 * @returns 合并后的 PCM
 */
function mergePcmChunks(chunks: Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * 语音录音器 hook。
 * @param options - 录音器配置
 * @returns 录音状态、波形采样与控制方法
 */
export function useVoiceRecorder(options: VoiceRecorderOptions = {}) {
  const status = ref<VoiceRecorderStatus>('idle');
  const waveformSamples = ref<number[]>([]);

  const mediaStream = ref<MediaStream | null>(null);
  const audioContext = ref<AudioContext | null>(null);
  const analyserNode = ref<AnalyserNode | null>(null);
  const processorNode = ref<ScriptProcessorNode | null>(null);
  const sourceNode = ref<MediaStreamAudioSourceNode | null>(null);

  let waveformFrameId = -1;
  let segmentTimerId: ReturnType<typeof setInterval> | null = null;
  let segmentDeliveryQueue = Promise.resolve();
  let pcmChunks: Float32Array[] = [];

  /**
   * 停止波形刷新循环。
   */
  function stopWaveformLoop(): void {
    if (waveformFrameId !== -1) {
      cancelAnimationFrame(waveformFrameId);
      waveformFrameId = -1;
    }
    waveformSamples.value = [];
  }

  /**
   * 启动波形刷新循环。
   * @param analyser - 频谱分析节点
   */
  function startWaveformLoop(analyser: AnalyserNode): void {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const tick = (): void => {
      analyser.getByteFrequencyData(dataArray);
      waveformSamples.value = Array.from(dataArray.subarray(0, WAVEFORM_BINS)).map((sample) => Math.max(Math.round(sample / 32), 1));
      waveformFrameId = requestAnimationFrame(tick);
    };

    waveformFrameId = requestAnimationFrame(tick);
  }

  /**
   * 释放录音与音频图资源。
   */
  async function cleanupResources(): Promise<void> {
    stopWaveformLoop();

    if (segmentTimerId !== null) {
      clearInterval(segmentTimerId);
      segmentTimerId = null;
    }

    mediaStream.value?.getTracks().forEach((track) => track.stop());
    mediaStream.value = null;

    sourceNode.value?.disconnect();
    sourceNode.value = null;

    processorNode.value?.disconnect();
    processorNode.value = null;

    analyserNode.value?.disconnect();
    analyserNode.value = null;

    const closingAudioContext = audioContext.value;
    audioContext.value = null;
    if (closingAudioContext) {
      await closingAudioContext.close().catch(noop);
    }

    pcmChunks = [];
    status.value = 'idle';
  }

  /**
   * 将当前缓存的 PCM 片段编码为 wav 并投递。
   */
  function enqueueCurrentSegment(): void {
    if (!options.onSegment || pcmChunks.length === 0 || !audioContext.value) {
      return;
    }

    const merged = mergePcmChunks(pcmChunks);
    pcmChunks = [];
    const wavBuffer = encodeWavePcm16Mono(resampleMonoPcm(merged, audioContext.value.sampleRate, TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE);

    const { onSegment } = options;
    segmentDeliveryQueue = segmentDeliveryQueue.then(async () => {
      try {
        await onSegment({
          buffer: wavBuffer,
          mimeType: WAV_MIME_TYPE
        });
      } catch {
        //
      }
    });
  }

  /**
   * 开始录音。
   */
  async function start(): Promise<void> {
    if (typeof navigator === 'undefined' || typeof AudioContext === 'undefined') {
      status.value = 'recording';
      return;
    }

    segmentDeliveryQueue = Promise.resolve();
    pcmChunks = [];

    mediaStream.value = await navigator.mediaDevices.getUserMedia({ audio: true });

    const context = new AudioContext();
    audioContext.value = context;

    const analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyserNode.value = analyser;

    const source = context.createMediaStreamSource(mediaStream.value);
    sourceNode.value = source;

    const processor = context.createScriptProcessor(4096, TARGET_CHANNELS, TARGET_CHANNELS);
    processorNode.value = processor;
    processor.onaudioprocess = (event: AudioProcessingEvent) => {
      const channelData = event.inputBuffer.getChannelData(0);
      pcmChunks.push(new Float32Array(channelData));
    };

    source.connect(analyser);
    source.connect(processor);
    processor.connect(context.destination);

    startWaveformLoop(analyser);

    segmentTimerId = setInterval(() => {
      enqueueCurrentSegment();
    }, options.segmentDurationMs ?? 4000);

    status.value = 'recording';
  }

  /**
   * 正常停止录音，等待最后一段投递完成。
   */
  async function stop(): Promise<void> {
    if (status.value !== 'recording') {
      await cleanupResources();
      return;
    }

    status.value = 'stopping';
    enqueueCurrentSegment();

    await Promise.race([
      segmentDeliveryQueue,
      new Promise<void>((resolve) => {
        setTimeout(resolve, STOP_TIMEOUT_MS);
      })
    ]);

    await cleanupResources();
  }

  /**
   * 取消录音并丢弃缓存音频。
   */
  async function cancel(): Promise<void> {
    pcmChunks = [];
    await cleanupResources();
  }

  return {
    status,
    waveformSamples,
    start,
    stop,
    cancel
  };
}
