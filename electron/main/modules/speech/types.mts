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
  /** whisper.cpp 可执行文件路径。 */
  whisperBinaryPath: string;
  /** whisper.cpp 模型文件路径。 */
  whisperModelPath: string;
  /** 临时目录根路径。 */
  tempDirectory: string;
}

/**
 * 语音运行时状态。
 */
export type SpeechRuntimeState = 'ready' | 'missing' | 'installing' | 'failed';

/**
 * 语音运行时状态快照。
 */
export interface SpeechRuntimeStatus {
  /** 当前状态。 */
  state: SpeechRuntimeState;
  /** 平台标识。 */
  platform: 'darwin' | 'win32';
  /** 架构标识。 */
  arch: 'arm64' | 'x64';
  /** 模型名称。 */
  modelName?: string;
  /** 当前安装目录。 */
  installDir?: string;
  /** 当前安装版本。 */
  version?: string;
  /** 失败时的人类可读错误。 */
  errorMessage?: string;
}

/**
 * 语音运行时资源。
 */
export interface SpeechRuntimeAsset {
  /** 资源名称。 */
  name: 'whisper' | 'model';
  /** 下载地址。 */
  url: string;
  /** sha256 校验值。 */
  sha256: string;
  /** 归档格式。 */
  archiveType: 'file' | 'zip';
  /** 安装目标相对路径。 */
  targetRelativePath: string;
}

/**
 * 语音运行时安装清单。
 */
export interface SpeechRuntimeManifestDefinition {
  /** 平台标识。 */
  platform: 'darwin' | 'win32';
  /** 架构标识。 */
  arch: 'arm64' | 'x64';
  /** 运行时版本。 */
  version: string;
  /** 默认模型名。 */
  modelName: string;
  /** 资源列表。 */
  assets: SpeechRuntimeAsset[];
}

/**
 * 安装进度阶段。
 */
export type SpeechInstallPhase = 'downloading' | 'extracting' | 'verifying' | 'completed';

/**
 * 安装进度事件。
 */
export interface SpeechInstallProgress {
  /** 当前阶段。 */
  phase: SpeechInstallPhase;
  /** 当前完成数。 */
  current: number;
  /** 总数。 */
  total: number;
  /** 进度说明。 */
  message: string;
}
