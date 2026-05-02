/**
 * @file types.mts
 * @description 语音转写主进程模块的共享类型定义。
 */

/**
 * 单段音频转写请求。
 */
export interface SpeechTranscribeRequest {
  /** 音频二进制数据。 */
  buffer: ArrayBuffer;
  /** 音频 MIME 类型。 */
  mimeType: string;
  /** 段落唯一标识。 */
  segmentId: string;
  /** 指定语言。 */
  language?: string;
  /** 可选提示词。 */
  prompt?: string;
}

/**
 * 单段音频转写结果。
 */
export interface SpeechTranscribeResult {
  /** 段落唯一标识。 */
  segmentId: string;
  /** 转写文本。 */
  text: string;
  /** 识别语言。 */
  language?: string;
  /** 转写耗时，单位毫秒。 */
  durationMs: number;
}

/**
 * whisper.cpp 运行时配置。
 */
export interface SpeechRuntimeConfig {
  /** ffmpeg 可执行文件路径，可选。 */
  ffmpegBinaryPath?: string;
  /** whisper.cpp 可执行文件路径。 */
  whisperBinaryPath: string;
  /** whisper.cpp 模型文件路径。 */
  whisperModelPath: string;
  /** 临时目录根路径。 */
  tempDirectory: string;
}
