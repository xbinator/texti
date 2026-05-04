/**
 * @file runtime.mts
 * @description 管理语音运行时目录、manifest、状态检测与已安装路径解析。
 */
import { access, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpeechRuntimeStatus } from './types.mjs';
import { app } from 'electron';

/**
 * 运行时上下文。
 */
export interface SpeechRuntimeContext {
  /** 测试或调用方注入的 userData 根目录。 */
  userDataPath?: string;
  /** 测试或调用方注入的平台标识。 */
  platform?: NodeJS.Platform;
  /** 测试或调用方注入的架构标识。 */
  arch?: string;
}

/**
 * 语音运行时 manifest 文件。
 */
export interface SpeechRuntimeManifestFile {
  /** 运行时版本。 */
  version: string;
  /** 默认模型名。 */
  modelName: string;
  /** 平台标识。 */
  platform: 'darwin' | 'win32';
  /** 架构标识。 */
  arch: 'arm64' | 'x64';
  /** 当前生效目录。 */
  currentDir: string;
}

/**
 * 已安装运行时路径。
 */
export interface InstalledSpeechRuntimePaths {
  /** 当前运行时根目录。 */
  runtimeRoot: string;
  /** whisper 可执行文件路径。 */
  whisperBinaryPath: string;
  /** whisper 模型文件路径。 */
  whisperModelPath: string;
}

/**
 * 获取语音运行时根目录。
 * @param context - 可选测试上下文
 * @returns 运行时根目录
 */
export function getSpeechRuntimeRoot(context: SpeechRuntimeContext = {}): string {
  const userDataPath = context.userDataPath ?? app.getPath('userData');
  return join(userDataPath, 'speech-runtime');
}

/**
 * 获取 manifest 文件路径。
 * @param context - 可选测试上下文
 * @returns manifest 路径
 */
export function getSpeechRuntimeManifestPath(context: SpeechRuntimeContext = {}): string {
  return join(getSpeechRuntimeRoot(context), 'manifest.json');
}

/**
 * 读取语音运行时 manifest。
 * @param context - 可选测试上下文
 * @returns manifest，不存在时返回 null
 */
export async function readSpeechRuntimeManifest(context: SpeechRuntimeContext = {}): Promise<SpeechRuntimeManifestFile | null> {
  try {
    const content = await readFile(getSpeechRuntimeManifestPath(context), 'utf-8');
    return JSON.parse(content) as SpeechRuntimeManifestFile;
  } catch {
    return null;
  }
}

/**
 * 解析已安装运行时路径。
 * @param context - 可选测试上下文
 * @returns 已安装路径
 */
export async function resolveInstalledSpeechRuntimePaths(context: SpeechRuntimeContext = {}): Promise<InstalledSpeechRuntimePaths> {
  const manifest = await readSpeechRuntimeManifest(context);
  if (!manifest) {
    throw new Error('Speech runtime is not installed');
  }

  const currentRoot = join(getSpeechRuntimeRoot(context), manifest.currentDir);
  const whisperBinaryPath = join(currentRoot, 'bin', (context.platform ?? process.platform) === 'win32' ? 'whisper.exe' : 'whisper');
  const whisperModelPath = join(currentRoot, 'models', `${manifest.modelName}.bin`);

  await access(whisperBinaryPath);
  await access(whisperModelPath);

  return {
    runtimeRoot: currentRoot,
    whisperBinaryPath,
    whisperModelPath
  };
}

/**
 * 获取语音运行时状态。
 * @param context - 可选测试上下文
 * @returns 运行时状态
 */
export async function getSpeechRuntimeStatus(context: SpeechRuntimeContext = {}): Promise<SpeechRuntimeStatus> {
  const platform = (context.platform ?? process.platform) as 'darwin' | 'win32';
  const arch = (context.arch ?? process.arch) as 'arm64' | 'x64';

  try {
    const manifest = await readSpeechRuntimeManifest(context);
    if (!manifest) {
      return { state: 'missing', platform, arch };
    }

    const paths = await resolveInstalledSpeechRuntimePaths(context);
    return {
      state: 'ready',
      platform,
      arch,
      version: manifest.version,
      modelName: manifest.modelName,
      installDir: paths.runtimeRoot
    };
  } catch (error) {
    return {
      state: 'failed',
      platform,
      arch,
      errorMessage: error instanceof Error ? error.message : 'Unknown speech runtime error'
    };
  }
}

/**
 * 删除已安装语音运行时。
 * @param context - 可选测试上下文
 */
export async function removeSpeechRuntime(context: SpeechRuntimeContext = {}): Promise<void> {
  await rm(getSpeechRuntimeRoot(context), { recursive: true, force: true });
}
