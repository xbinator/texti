/**
 * @file service.mts
 * @description 语音转写服务，负责校验 whisper.cpp 配置并返回单段转写结果。
 */
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpeechRuntimeConfig, SpeechTranscribeRequest, SpeechTranscribeResult } from './types.mjs';
import { resolveInstalledSpeechRuntimePaths } from './runtime.mjs';

/**
 * 解析语音转写运行时配置。
 * @returns 运行时配置
 */
export async function resolveSpeechRuntimeConfig(): Promise<SpeechRuntimeConfig> {
  try {
    const installedRuntime = await resolveInstalledSpeechRuntimePaths();
    return {
      whisperBinaryPath: installedRuntime.whisperBinaryPath,
      whisperModelPath: installedRuntime.whisperModelPath,
      tempDirectory: process.env.TIBIS_WHISPER_TEMP_DIR ?? '/tmp'
    };
  } catch {
    return {
      whisperBinaryPath: process.env.TIBIS_WHISPER_CPP_PATH ?? '',
      whisperModelPath: process.env.TIBIS_WHISPER_MODEL_PATH ?? '',
      tempDirectory: process.env.TIBIS_WHISPER_TEMP_DIR ?? '/tmp'
    };
  }
}

/**
 * 判断当前音频 MIME 是否受支持。
 * @param mimeType - 音频 MIME 类型
 * @returns 是否为受支持的 wav 音频
 */
function isSupportedSpeechMimeType(mimeType: string): boolean {
  return mimeType === 'audio/wav' || mimeType === 'audio/wave';
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
 * @param request - 转写请求
 * @param config - 运行时配置
 * @returns 转写结果
 */
export async function transcribeAudioSegment(request: SpeechTranscribeRequest, config?: SpeechRuntimeConfig): Promise<SpeechTranscribeResult> {
  if (!isSupportedSpeechMimeType(request.mimeType)) {
    throw new Error(`Unsupported speech mime type: ${request.mimeType}`);
  }

  const resolvedConfig = config ?? (await resolveSpeechRuntimeConfig());
  await assertSpeechConfig(resolvedConfig);

  const startedAt = Date.now();
  const workDirectory = await mkdtemp(join(resolvedConfig.tempDirectory, 'tibis-speech-'));
  const inputPath = join(workDirectory, 'input.wav');
  const outputBasePath = join(workDirectory, 'output');
  const outputTextPath = `${outputBasePath}.txt`;

  try {
    await writeFile(inputPath, Buffer.from(request.buffer));

    const args = ['-m', resolvedConfig.whisperModelPath, '-f', inputPath, '-of', outputBasePath, '-otxt'];
    if (request.language) {
      args.push('-l', request.language);
    }
    if (request.prompt) {
      args.push('--prompt', request.prompt);
    }

    await runExecFile(resolvedConfig.whisperBinaryPath, args);
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
