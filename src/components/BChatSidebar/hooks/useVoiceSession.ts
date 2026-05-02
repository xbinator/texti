/**
 * @file useVoiceTranscriptionSession.ts
 * @description 管理语音转写会话中的分段队列、转写状态与最终拼接结果。
 */
import { computed, ref } from 'vue';
import { hasElectronAPI, getElectronAPI } from '@/shared/platform/electron-api';

/**
 * 语音段状态。
 */
export type VoiceSegmentStatus = 'pending' | 'transcribing' | 'partial' | 'final' | 'failed';

/**
 * 待转写的语音段输入。
 */
export interface PendingVoiceSegment {
  /** 段落唯一标识。 */
  id: string;
  /** 段落分隔符。 */
  separator: '' | '\n';
  /** 音频二进制数据。 */
  buffer: ArrayBuffer;
  /** 音频 MIME 类型。 */
  mimeType: string;
}

/**
 * 已登记的语音段。
 */
export interface VoiceSegment extends PendingVoiceSegment {
  /** 段序号。 */
  index: number;
  /** 当前状态。 */
  status: VoiceSegmentStatus;
  /** 当前文本。 */
  text: string;
}

/**
 * 单段转写函数。
 */
export type VoiceSegmentTranscriber = (segment: PendingVoiceSegment) => Promise<{ text: string }>;

/**
 * 默认单段转写执行器。
 * @param segment - 待转写语音段
 * @returns 转写文本
 */
async function defaultVoiceSegmentTranscriber(segment: PendingVoiceSegment): Promise<{ text: string }> {
  if (!hasElectronAPI()) {
    return { text: '' };
  }

  const result = await getElectronAPI().transcribeAudio({
    buffer: segment.buffer,
    mimeType: segment.mimeType,
    segmentId: segment.id
  });

  return {
    text: result.text
  };
}

/**
 * 管理语音转写分段会话。
 * @param transcribe - 单段转写执行器
 * @returns 段列表、最终拼接文本与入队方法
 */
export function useVoiceSession(transcribe: VoiceSegmentTranscriber = defaultVoiceSegmentTranscriber) {
  /**
   * 当前会话的全部段信息。
   */
  const segments = ref<VoiceSegment[]>([]);

  /**
   * 当前串行转写队列。
   */
  let transcriptionQueue: Promise<void> = Promise.resolve();

  /**
   * 已完成段的最终拼接文本。
   */
  const finalText = computed<string>(() => {
    return segments.value
      .filter((segment) => segment.status === 'final')
      .sort((left, right) => left.index - right.index)
      .map((segment) => `${segment.separator}${segment.text}`)
      .join('');
  });

  /**
   * 把新的语音段加入队列并立即串行转写。
   * @param input - 待转写语音段
   */
  async function enqueueSegment(input: PendingVoiceSegment): Promise<void> {
    const segment: VoiceSegment = {
      ...input,
      index: segments.value.length,
      status: 'pending',
      text: ''
    };

    segments.value.push(segment);
    transcriptionQueue = transcriptionQueue.then(async () => {
      segment.status = 'transcribing';

      const result = await transcribe(input);
      segment.text = result.text;
      segment.status = 'final';
    });

    await transcriptionQueue;
  }

  /**
   * 完成当前会话并返回最终文本。
   * @returns 会话最终文本
   */
  async function completeSession(): Promise<{ text: string }> {
    await transcriptionQueue;

    return {
      text: finalText.value
    };
  }

  /**
   * 重置当前会话状态，为下一次录音做准备。
   */
  function resetSession(): void {
    segments.value = [];
    transcriptionQueue = Promise.resolve();
  }

  return {
    segments,
    finalText,
    enqueueSegment,
    completeSession,
    resetSession
  };
}
