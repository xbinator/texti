/**
 * @file runtime-manager.test.ts
 * @description 验证语音运行时目录状态解析与路径查找。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const accessMock = vi.fn();
const readFileMock = vi.fn();
const rmMock = vi.fn();

vi.mock('node:fs/promises', () => ({
  access: accessMock,
  readFile: readFileMock,
  rm: rmMock
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock-user-data')
  }
}));

describe('speech runtime manager', () => {
  beforeEach(() => {
    accessMock.mockReset();
    readFileMock.mockReset();
    rmMock.mockReset();
  });

  it('returns missing when no manifest exists', async () => {
    readFileMock.mockRejectedValue(new Error('missing'));

    const { getSpeechRuntimeStatus } = await import('../../electron/main/modules/speech/runtime.mjs');
    const status = await getSpeechRuntimeStatus({
      userDataPath: '/tmp/runtime-test',
      platform: 'darwin',
      arch: 'arm64'
    });

    expect(status).toEqual({
      state: 'missing',
      platform: 'darwin',
      arch: 'arm64'
    });
  });

  it('returns ready when manifest and assets exist', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        version: '2026.05.04',
        modelName: 'ggml-base',
        platform: 'darwin',
        arch: 'arm64',
        currentDir: 'current'
      })
    );
    accessMock.mockResolvedValue(undefined);

    const { getSpeechRuntimeStatus } = await import('../../electron/main/modules/speech/runtime.mjs');
    const status = await getSpeechRuntimeStatus({
      userDataPath: '/tmp/runtime-test',
      platform: 'darwin',
      arch: 'arm64'
    });

    expect(status).toEqual({
      state: 'ready',
      platform: 'darwin',
      arch: 'arm64',
      version: '2026.05.04',
      modelName: 'ggml-base',
      installDir: '/tmp/runtime-test/speech-runtime/current'
    });
  });

  it('resolves installed runtime paths from manifest', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        version: '2026.05.04',
        modelName: 'ggml-base',
        platform: 'win32',
        arch: 'x64',
        currentDir: 'current'
      })
    );
    accessMock.mockResolvedValue(undefined);

    const { resolveInstalledSpeechRuntimePaths } = await import('../../electron/main/modules/speech/runtime.mjs');
    const paths = await resolveInstalledSpeechRuntimePaths({
      userDataPath: '/tmp/runtime-test',
      platform: 'win32'
    });

    expect(paths).toEqual({
      runtimeRoot: '/tmp/runtime-test/speech-runtime/current',
      whisperBinaryPath: '/tmp/runtime-test/speech-runtime/current/bin/whisper.exe',
      whisperModelPath: '/tmp/runtime-test/speech-runtime/current/models/ggml-base.bin'
    });
  });

  it('removes the managed speech runtime directory only', async () => {
    rmMock.mockResolvedValue(undefined);

    const { removeSpeechRuntime } = await import('../../electron/main/modules/speech/runtime.mjs');
    await removeSpeechRuntime({ userDataPath: '/tmp/runtime-test' });

    expect(rmMock).toHaveBeenCalledWith('/tmp/runtime-test/speech-runtime', { recursive: true, force: true });
  });
});
