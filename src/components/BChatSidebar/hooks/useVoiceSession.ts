/**
 * @file useVoiceTranscriptionSession.ts
 * @description 管理语音转写会话中的分段队列、转写状态与最终拼接结果。
 */
import { computed, ref } from 'vue';
import { hasElectronAPI, getElectronAPI } from '@/shared/platform/electron-api';

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/** 语音段状态。 */
export type VoiceSegmentStatus = 'pending' | 'transcribing' | 'partial' | 'final' | 'failed';

/** 待转写的语音段输入。 */
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

/** 已登记的语音段。 */
export interface VoiceSegment extends PendingVoiceSegment {
  /** 段序号（即入队顺序）。 */
  index: number;
  /** 当前状态。 */
  status: VoiceSegmentStatus;
  /** 当前文本。 */
  text: string;
}

/** 单段转写结果。 */
export interface TranscribeResult {
  text: string;
}

/** 会话完成结果。 */
export interface SessionResult {
  /** 最终拼接文本。 */
  text: string;
  /** 转写失败的段 ID 列表，为空则表示全部成功。 */
  failedSegmentIds: string[];
}

/** 单段转写函数签名。 */
export type VoiceSegmentTranscriber = (segment: PendingVoiceSegment) => Promise<TranscribeResult>;

// ─── 默认转写执行器 ──────────────────────────────────────────────────────────

/**
 * 默认单段转写执行器，调用 Electron IPC 完成转写。
 */
export async function defaultVoiceSegmentTranscriber(segment: PendingVoiceSegment): Promise<TranscribeResult> {
  if (!hasElectronAPI()) {
    return { text: '' };
  }

  const result = await getElectronAPI().transcribeAudio({
    buffer: segment.buffer,
    mimeType: 'audio/wav',
    segmentId: segment.id,
    language: 'zh'
  });

  return { text: result.text };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * 管理语音转写分段会话。
 *
 * - 保证转写串行执行，入队顺序即转写顺序。
 * - `finalText` 仅拼接状态为 `final` 的段。
 * - `completeSession` 返回失败段列表，供调用方决策。
 *
 * @param transcribe - 单段转写执行器，默认使用 Electron IPC。
 */
export function useVoiceSession(transcribe: VoiceSegmentTranscriber = defaultVoiceSegmentTranscriber) {
  /** 当前会话的全部段信息。 */
  const segments = ref<VoiceSegment[]>([]);

  /**
   * 串行转写队列尾部 Promise。
   * 每次入队都链在当前尾部，保证严格串行。
   */
  let queueTail: Promise<void> = Promise.resolve();

  // ── 计算属性 ───────────────────────────────────────────────────────────────

  /**
   * 已完成段按入队顺序拼接的最终文本。
   * index 即 push 顺序，无需额外排序。
   */
  const finalText = computed<string>(() =>
    segments.value
      .filter((s) => s.status === 'final')
      .map((s) => `${s.separator}${s.text}`)
      .join('')
  );

  // ── 内部工具 ───────────────────────────────────────────────────────────────

  /**
   * 通过索引更新段字段，触发 Vue 响应式。
   * 直接修改 `segment.xxx` 在某些场景下会绕过代理追踪。
   */
  function patchSegment(index: number, patch: Partial<Pick<VoiceSegment, 'status' | 'text'>>): void {
    segments.value[index] = { ...segments.value[index], ...patch };
  }

  // ── 对外接口 ───────────────────────────────────────────────────────────────

  /**
   * 把新的语音段加入队列并串行转写。
   *
   * 调用方无需 await 此方法；如需等待转写完成，await `completeSession()`。
   * 若确实需要等待单段完成，可 await 返回值，但注意并发调用仍保证串行。
   *
   * @param input - 待入队语音段
   */
  function enqueueSegment(input: PendingVoiceSegment): void {
    const index = segments.value.length;
    segments.value.push({ ...input, index, status: 'pending', text: '' });

    // 链在当前队列尾部，保证严格串行；不在此处 await，避免并发调用时的竞态
    queueTail = queueTail.then(async () => {
      patchSegment(index, { status: 'transcribing' });

      try {
        const { text } = await transcribe(input);
        patchSegment(index, { status: 'final', text });
      } catch (err) {
        patchSegment(index, { status: 'failed', text: '' });
      }
    });
  }

  /**
   * 等待所有已入队段转写完毕，返回最终结果。
   *
   * @returns 最终拼接文本与失败段 ID 列表
   */
  async function completeSession(): Promise<SessionResult> {
    await queueTail;

    const failedSegmentIds = segments.value.filter((s) => s.status === 'failed').map((s) => s.id);

    return { text: finalText.value, failedSegmentIds };
  }

  /**
   * 重置会话，清空所有段与队列，为下一次录音做准备。
   * 建议在 `completeSession` 完成后调用，避免重置正在转写中的段。
   */
  function resetSession(): void {
    segments.value = [];
    queueTail = Promise.resolve();
  }

  return {
    segments,
    finalText,
    enqueueSegment,
    completeSession,
    resetSession
  };
}
