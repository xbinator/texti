/**
 * @file manifest-tool.test.ts
 * @description 验证语音 manifest 工具的 hash 计算与结构校验行为。
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyDigestsToManifest,
  calculateFileSha256,
  runCli,
  runFillCommand,
  runValidateCommand,
  validateManifestDefinition
} from '../../../scripts/speech/manifest-tool.mjs';

/**
 * 当前测试过程中创建的临时目录列表。
 */
const temporaryDirectories: string[] = [];

/**
 * 创建一个可自动清理的临时目录。
 * @returns 临时目录绝对路径。
 */
async function createTemporaryDirectory(): Promise<string> {
  const directoryPath = await mkdtemp(join(tmpdir(), 'speech-manifest-tool-'));

  temporaryDirectories.push(directoryPath);

  return directoryPath;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true })));
});

describe('speech manifest tool', () => {
  it('calculates a stable sha256 digest for a file', async () => {
    const temporaryDirectory = await createTemporaryDirectory();
    const filePath = join(temporaryDirectory, 'sample.txt');

    await writeFile(filePath, 'hello speech runtime', 'utf8');

    await expect(calculateFileSha256(filePath)).resolves.toBe('6d426abc1f65b1c1db3e56dd42faadef1d165a7d6f3cf3eb9b1ddde75eae3339');
  });

  it('treats template placeholders as warnings instead of structural errors', () => {
    const validationResult = validateManifestDefinition({
      currentVersion: '2026.05.04',
      platforms: {
        'darwin-arm64': {
          platform: 'darwin',
          arch: 'arm64',
          version: '2026.05.04',
          modelName: 'ggml-base',
          assets: [
            {
              name: 'whisper',
              url: 'https://github.com/OWNER/REPO/releases/download/speech-runtime-2026.05.04/whisper-darwin-arm64',
              sha256: 'REPLACE_WITH_DARWIN_ARM64_WHISPER_SHA256',
              archiveType: 'file',
              targetRelativePath: 'bin/whisper'
            }
          ]
        }
      }
    });

    expect(validationResult.errors).toEqual([]);
    expect(validationResult.warnings).toEqual([
      'platforms.darwin-arm64.assets[0].url 仍包含模板占位符',
      'platforms.darwin-arm64.assets[0].sha256 仍包含模板占位符'
    ]);
  });

  it('reports structural errors for malformed manifests', () => {
    const validationResult = validateManifestDefinition({
      currentVersion: '',
      platforms: {
        broken: {
          platform: '',
          arch: '',
          version: '',
          modelName: '',
          assets: [
            {
              name: '',
              url: 'http://example.com/file',
              sha256: 'not-a-sha',
              archiveType: '',
              targetRelativePath: '/absolute/file'
            }
          ]
        }
      }
    });

    expect(validationResult.errors).toEqual([
      'currentVersion 必须是非空字符串',
      'platforms.broken.platform 必须是非空字符串',
      'platforms.broken.arch 必须是非空字符串',
      'platforms.broken.version 必须是非空字符串',
      'platforms.broken.modelName 必须是非空字符串',
      'platforms.broken.assets[0].name 必须是非空字符串',
      'platforms.broken.assets[0].url 必须使用 https://',
      'platforms.broken.assets[0].sha256 必须是 64 位十六进制字符串',
      'platforms.broken.assets[0].archiveType 必须是非空字符串',
      'platforms.broken.assets[0].targetRelativePath 必须是相对路径'
    ]);
  });

  it('validates a manifest file from disk', async () => {
    const temporaryDirectory = await createTemporaryDirectory();
    const manifestPath = join(temporaryDirectory, 'manifest.json');

    await writeFile(
      manifestPath,
      JSON.stringify({
        currentVersion: '2026.05.04',
        platforms: {
          'win32-x64': {
            platform: 'win32',
            arch: 'x64',
            version: '2026.05.04',
            modelName: 'ggml-base',
            assets: [
              {
                name: 'whisper',
                url: 'https://example.com/whisper-win32-x64.exe',
                sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
                archiveType: 'file',
                targetRelativePath: 'bin/whisper.exe'
              }
            ]
          }
        }
      }),
      'utf8'
    );

    await expect(runValidateCommand(manifestPath)).resolves.toBe(0);
  });

  it('applies digests to whisper and model assets', () => {
    const nextManifest = applyDigestsToManifest(
      {
        currentVersion: '2026.05.04',
        platforms: {
          'darwin-arm64': {
            platform: 'darwin',
            arch: 'arm64',
            version: '2026.05.04',
            modelName: 'ggml-base',
            assets: [
              {
                name: 'whisper',
                url: 'https://example.com/whisper-darwin-arm64',
                sha256: 'REPLACE_WITH_DARWIN_ARM64_WHISPER_SHA256',
                archiveType: 'file',
                targetRelativePath: 'bin/whisper'
              },
              {
                name: 'model',
                url: 'https://example.com/ggml-base.bin',
                sha256: 'REPLACE_WITH_GGML_BASE_SHA256',
                archiveType: 'file',
                targetRelativePath: 'models/ggml-base.bin'
              }
            ]
          },
          'darwin-x64': {
            platform: 'darwin',
            arch: 'x64',
            version: '2026.05.04',
            modelName: 'ggml-base',
            assets: [
              {
                name: 'whisper',
                url: 'https://example.com/whisper-darwin-x64',
                sha256: 'REPLACE_WITH_DARWIN_X64_WHISPER_SHA256',
                archiveType: 'file',
                targetRelativePath: 'bin/whisper'
              },
              {
                name: 'model',
                url: 'https://example.com/ggml-base.bin',
                sha256: 'REPLACE_WITH_GGML_BASE_SHA256',
                archiveType: 'file',
                targetRelativePath: 'models/ggml-base.bin'
              }
            ]
          },
          'win32-x64': {
            platform: 'win32',
            arch: 'x64',
            version: '2026.05.04',
            modelName: 'ggml-base',
            assets: [
              {
                name: 'whisper',
                url: 'https://example.com/whisper-win32-x64.exe',
                sha256: 'REPLACE_WITH_WIN32_X64_WHISPER_SHA256',
                archiveType: 'file',
                targetRelativePath: 'bin/whisper.exe'
              },
              {
                name: 'model',
                url: 'https://example.com/ggml-base.bin',
                sha256: 'REPLACE_WITH_GGML_BASE_SHA256',
                archiveType: 'file',
                targetRelativePath: 'models/ggml-base.bin'
              }
            ]
          }
        }
      },
      {
        darwinArm64: 'a'.repeat(64),
        darwinX64: 'b'.repeat(64),
        win32X64: 'c'.repeat(64),
        model: 'd'.repeat(64)
      }
    );

    expect(nextManifest.platforms['darwin-arm64'].assets[0].sha256).toBe('a'.repeat(64));
    expect(nextManifest.platforms['darwin-x64'].assets[0].sha256).toBe('b'.repeat(64));
    expect(nextManifest.platforms['win32-x64'].assets[0].sha256).toBe('c'.repeat(64));
    expect(nextManifest.platforms['darwin-arm64'].assets[1].sha256).toBe('d'.repeat(64));
    expect(nextManifest.platforms['darwin-x64'].assets[1].sha256).toBe('d'.repeat(64));
    expect(nextManifest.platforms['win32-x64'].assets[1].sha256).toBe('d'.repeat(64));
  });

  it('fills manifest sha256 fields from local files', async () => {
    const temporaryDirectory = await createTemporaryDirectory();
    const manifestPath = join(temporaryDirectory, 'manifest.json');
    const darwinArm64Path = join(temporaryDirectory, 'whisper-darwin-arm64');
    const darwinX64Path = join(temporaryDirectory, 'whisper-darwin-x64');
    const win32X64Path = join(temporaryDirectory, 'whisper-win32-x64.exe');
    const modelPath = join(temporaryDirectory, 'ggml-base.bin');

    await writeFile(
      manifestPath,
      JSON.stringify({
        currentVersion: '2026.05.04',
        platforms: {
          'darwin-arm64': {
            platform: 'darwin',
            arch: 'arm64',
            version: '2026.05.04',
            modelName: 'ggml-base',
            assets: [
              {
                name: 'whisper',
                url: 'https://example.com/whisper-darwin-arm64',
                sha256: 'REPLACE_WITH_DARWIN_ARM64_WHISPER_SHA256',
                archiveType: 'file',
                targetRelativePath: 'bin/whisper'
              },
              {
                name: 'model',
                url: 'https://example.com/ggml-base.bin',
                sha256: 'REPLACE_WITH_GGML_BASE_SHA256',
                archiveType: 'file',
                targetRelativePath: 'models/ggml-base.bin'
              }
            ]
          },
          'darwin-x64': {
            platform: 'darwin',
            arch: 'x64',
            version: '2026.05.04',
            modelName: 'ggml-base',
            assets: [
              {
                name: 'whisper',
                url: 'https://example.com/whisper-darwin-x64',
                sha256: 'REPLACE_WITH_DARWIN_X64_WHISPER_SHA256',
                archiveType: 'file',
                targetRelativePath: 'bin/whisper'
              },
              {
                name: 'model',
                url: 'https://example.com/ggml-base.bin',
                sha256: 'REPLACE_WITH_GGML_BASE_SHA256',
                archiveType: 'file',
                targetRelativePath: 'models/ggml-base.bin'
              }
            ]
          },
          'win32-x64': {
            platform: 'win32',
            arch: 'x64',
            version: '2026.05.04',
            modelName: 'ggml-base',
            assets: [
              {
                name: 'whisper',
                url: 'https://example.com/whisper-win32-x64.exe',
                sha256: 'REPLACE_WITH_WIN32_X64_WHISPER_SHA256',
                archiveType: 'file',
                targetRelativePath: 'bin/whisper.exe'
              },
              {
                name: 'model',
                url: 'https://example.com/ggml-base.bin',
                sha256: 'REPLACE_WITH_GGML_BASE_SHA256',
                archiveType: 'file',
                targetRelativePath: 'models/ggml-base.bin'
              }
            ]
          }
        }
      }),
      'utf8'
    );
    await writeFile(darwinArm64Path, 'darwin-arm64-whisper', 'utf8');
    await writeFile(darwinX64Path, 'darwin-x64-whisper', 'utf8');
    await writeFile(win32X64Path, 'win32-x64-whisper', 'utf8');
    await writeFile(modelPath, 'ggml-base-model', 'utf8');

    await expect(
      runFillCommand({
        manifestPath,
        darwinArm64Path,
        darwinX64Path,
        win32X64Path,
        modelPath
      })
    ).resolves.toBe(0);

    const savedManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      platforms: Record<string, { assets: Array<{ sha256: string }> }>;
    };

    expect(savedManifest.platforms['darwin-arm64'].assets[0].sha256).toBe(await calculateFileSha256(darwinArm64Path));
    expect(savedManifest.platforms['darwin-x64'].assets[0].sha256).toBe(await calculateFileSha256(darwinX64Path));
    expect(savedManifest.platforms['win32-x64'].assets[0].sha256).toBe(await calculateFileSha256(win32X64Path));
    expect(savedManifest.platforms['darwin-arm64'].assets[1].sha256).toBe(await calculateFileSha256(modelPath));
  });

  it('supports pnpm style argument forwarding with a leading double dash', async () => {
    const temporaryDirectory = await createTemporaryDirectory();
    const filePath = join(temporaryDirectory, 'sample.txt');

    await writeFile(filePath, 'hello speech runtime', 'utf8');

    await expect(runCli(['hash', '--', filePath])).resolves.toBe(0);
  });

  it('supports fill command through the cli', async () => {
    const temporaryDirectory = await createTemporaryDirectory();
    const manifestPath = join(temporaryDirectory, 'manifest.json');
    const darwinArm64Path = join(temporaryDirectory, 'whisper-darwin-arm64');
    const darwinX64Path = join(temporaryDirectory, 'whisper-darwin-x64');
    const win32X64Path = join(temporaryDirectory, 'whisper-win32-x64.exe');
    const modelPath = join(temporaryDirectory, 'ggml-base.bin');

    await writeFile(
      manifestPath,
      JSON.stringify({
        currentVersion: '2026.05.04',
        platforms: {
          'darwin-arm64': {
            platform: 'darwin',
            arch: 'arm64',
            version: '2026.05.04',
            modelName: 'ggml-base',
            assets: [
              {
                name: 'whisper',
                url: 'https://example.com/whisper-darwin-arm64',
                sha256: 'REPLACE_WITH_DARWIN_ARM64_WHISPER_SHA256',
                archiveType: 'file',
                targetRelativePath: 'bin/whisper'
              },
              {
                name: 'model',
                url: 'https://example.com/ggml-base.bin',
                sha256: 'REPLACE_WITH_GGML_BASE_SHA256',
                archiveType: 'file',
                targetRelativePath: 'models/ggml-base.bin'
              }
            ]
          },
          'darwin-x64': {
            platform: 'darwin',
            arch: 'x64',
            version: '2026.05.04',
            modelName: 'ggml-base',
            assets: [
              {
                name: 'whisper',
                url: 'https://example.com/whisper-darwin-x64',
                sha256: 'REPLACE_WITH_DARWIN_X64_WHISPER_SHA256',
                archiveType: 'file',
                targetRelativePath: 'bin/whisper'
              },
              {
                name: 'model',
                url: 'https://example.com/ggml-base.bin',
                sha256: 'REPLACE_WITH_GGML_BASE_SHA256',
                archiveType: 'file',
                targetRelativePath: 'models/ggml-base.bin'
              }
            ]
          },
          'win32-x64': {
            platform: 'win32',
            arch: 'x64',
            version: '2026.05.04',
            modelName: 'ggml-base',
            assets: [
              {
                name: 'whisper',
                url: 'https://example.com/whisper-win32-x64.exe',
                sha256: 'REPLACE_WITH_WIN32_X64_WHISPER_SHA256',
                archiveType: 'file',
                targetRelativePath: 'bin/whisper.exe'
              },
              {
                name: 'model',
                url: 'https://example.com/ggml-base.bin',
                sha256: 'REPLACE_WITH_GGML_BASE_SHA256',
                archiveType: 'file',
                targetRelativePath: 'models/ggml-base.bin'
              }
            ]
          }
        }
      }),
      'utf8'
    );
    await writeFile(darwinArm64Path, 'darwin-arm64-whisper', 'utf8');
    await writeFile(darwinX64Path, 'darwin-x64-whisper', 'utf8');
    await writeFile(win32X64Path, 'win32-x64-whisper', 'utf8');
    await writeFile(modelPath, 'ggml-base-model', 'utf8');

    await expect(
      runCli([
        'fill',
        '--',
        '--manifest',
        manifestPath,
        '--darwin-arm64',
        darwinArm64Path,
        '--darwin-x64',
        darwinX64Path,
        '--win32-x64',
        win32X64Path,
        '--model',
        modelPath
      ])
    ).resolves.toBe(0);
  });
});
