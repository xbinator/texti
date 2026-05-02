/**
 * @file service.mts
 * @description 语音转写服务，负责校验 whisper.cpp 配置并返回单段转写结果。
 */
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpeechRuntimeConfig, SpeechTranscribeRequest, SpeechTranscribeResult } from './types.mjs';

/**
 * 解析语音转写运行时配置。
 * @returns 运行时配置
 */
export function resolveSpeechRuntimeConfig(): SpeechRuntimeConfig {
  return {
    ffmpegBinaryPath: process.env.TIBIS_FFMPEG_PATH ?? '',
    whisperBinaryPath: process.env.TIBIS_WHISPER_CPP_PATH ?? '',
    whisperModelPath: process.env.TIBIS_WHISPER_MODEL_PATH ?? '',
    tempDirectory: process.env.TIBIS_WHISPER_TEMP_DIR ?? '/tmp'
  };
}

/**
 * 把 MIME 类型映射为临时音频文件扩展名。
 * @param mimeType - 音频 MIME 类型
 * @returns 适合落盘的扩展名
 */
function resolveAudioExtension(mimeType: string): string {
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

/**
 * 判断当前音频是否需要转成 wav 再交给 whisper.cpp。
 * @param mimeType - 音频 MIME 类型
 * @param config - 运行时配置
 * @returns 是否需要转码
 */
function shouldTranscodeToWav(mimeType: string, config: SpeechRuntimeConfig): boolean {
  return mimeType !== 'audio/wav' && mimeType !== 'audio/wave' && Boolean(config.ffmpegBinaryPath);
}

/**
 * 以 Promise 形式执行外部命令。
 * @param file - 可执行文件路径
 * @param args - 命令参数
 */
async function runExecFile(file: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(file, args, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

/**
 * 校验 whisper.cpp 运行时配置。
 * @param config - 待校验配置
 */
async function assertSpeechConfig(config: SpeechRuntimeConfig): Promise<void> {
  if (!config.whisperBinaryPath) {
    throw new Error('Missing whisper binary path');
  }

  if (!config.whisperModelPath) {
    throw new Error('Missing whisper model path');
  }

  await access(config.whisperBinaryPath);
  await access(config.whisperModelPath);
}

/**
 * 转写单段音频。
 * 当前为最小实现，只完成配置校验与返回结构，后续再补临时文件和真实 whisper.cpp 调用。
 * @param request - 转写请求
 * @param config - 运行时配置
 * @returns 转写结果
 */
export async function transcribeAudioSegment(
  request: SpeechTranscribeRequest,
  config: SpeechRuntimeConfig = resolveSpeechRuntimeConfig()
): Promise<SpeechTranscribeResult> {
  await assertSpeechConfig(config);

  const startedAt = Date.now();
  const workDirectory = await mkdtemp(join(config.tempDirectory, 'tibis-speech-'));
  const originalInputPath = join(workDirectory, `input.${resolveAudioExtension(request.mimeType)}`);
  const wavInputPath = join(workDirectory, 'input.wav');
  const outputBasePath = join(workDirectory, 'output');
  const outputTextPath = `${outputBasePath}.txt`;

  try {
    await writeFile(originalInputPath, Buffer.from(request.buffer));

    let whisperInputPath = originalInputPath;

    if (shouldTranscodeToWav(request.mimeType, config) && config.ffmpegBinaryPath) {
      await runExecFile(config.ffmpegBinaryPath, ['-i', originalInputPath, wavInputPath]);
      whisperInputPath = wavInputPath;
    }

    const args = ['-m', config.whisperModelPath, '-f', whisperInputPath, '-of', outputBasePath, '-otxt'];
    if (request.language) {
      args.push('-l', request.language);
    }
    if (request.prompt) {
      args.push('--prompt', request.prompt);
    }

    await runExecFile(config.whisperBinaryPath, args);
    const text = (await readFile(outputTextPath, 'utf-8')).trim();

    return {
      segmentId: request.segmentId,
      text,
      language: request.language,
      durationMs: Math.max(Date.now() - startedAt, 0)
    };
  } finally {
    await rm(workDirectory, { force: true, recursive: true });
  }
}
