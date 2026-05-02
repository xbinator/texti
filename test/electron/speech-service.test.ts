/**
 * @file speech-service.test.ts
 * @description 验证语音转写服务的最小返回结构与配置校验行为。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 文件存在性检查桩。
 */
const accessMock = vi.fn();

/**
 * 创建临时目录桩。
 */
const mkdtempMock = vi.fn();

/**
 * 写入文件桩。
 */
const writeFileMock = vi.fn();

/**
 * 读取文件桩。
 */
const readFileMock = vi.fn();

/**
 * 删除目录桩。
 */
const rmMock = vi.fn();

/**
 * 子进程执行桩。
 */
const execFileMock = vi.fn();

vi.mock('node:fs/promises', () => ({
  access: accessMock,
  mkdtemp: mkdtempMock,
  writeFile: writeFileMock,
  readFile: readFileMock,
  rm: rmMock
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock
}));

describe('speechService', () => {
  beforeEach(() => {
    accessMock.mockReset();
    mkdtempMock.mockReset();
    writeFileMock.mockReset();
    readFileMock.mockReset();
    rmMock.mockReset();
    execFileMock.mockReset();
  });

  it('builds a single-segment transcription result', async () => {
    accessMock.mockResolvedValue(undefined);
    mkdtempMock.mockResolvedValue('/tmp/tibis-speech-123');
    writeFileMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue('识别结果');
    rmMock.mockResolvedValue(undefined);
    execFileMock.mockImplementation((_file, _args, callback: (error: null, result: { stdout: string; stderr: string }) => void) => {
      callback(null, { stdout: '', stderr: '' });
    });

    const { transcribeAudioSegment } = await import('../../electron/main/modules/speech/service.mjs');
    const result = await transcribeAudioSegment({
      buffer: new ArrayBuffer(8),
      mimeType: 'audio/webm',
      segmentId: 'seg-1'
    }, {
      whisperBinaryPath: '/tmp/whisper',
      whisperModelPath: '/tmp/model.bin',
      tempDirectory: '/tmp'
    });

    expect(result.segmentId).toBe('seg-1');
    expect(result.text).toBe('识别结果');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(writeFileMock).toHaveBeenCalled();
    expect(execFileMock).toHaveBeenCalledWith(
      '/tmp/whisper',
      expect.arrayContaining(['-m', '/tmp/model.bin']),
      expect.any(Function)
    );
    expect(readFileMock).toHaveBeenCalledWith('/tmp/tibis-speech-123/output.txt', 'utf-8');
    expect(rmMock).toHaveBeenCalledWith('/tmp/tibis-speech-123', { force: true, recursive: true });
  });

  it('throws when whisper binary config is missing', async () => {
    const { transcribeAudioSegment } = await import('../../electron/main/modules/speech/service.mjs');

    await expect(
      transcribeAudioSegment({
        buffer: new ArrayBuffer(8),
        mimeType: 'audio/webm',
        segmentId: 'seg-1'
      }, {
        whisperBinaryPath: '',
        whisperModelPath: '/tmp/model.bin',
        tempDirectory: '/tmp'
      })
    ).rejects.toThrow('whisper binary path');
  });

  it('reads default runtime config from environment variables', async () => {
    vi.stubEnv('TIBIS_WHISPER_CPP_PATH', '/env/whisper');
    vi.stubEnv('TIBIS_WHISPER_MODEL_PATH', '/env/model.bin');
    vi.stubEnv('TIBIS_WHISPER_TEMP_DIR', '/env/tmp');
    vi.stubEnv('TIBIS_FFMPEG_PATH', '/env/ffmpeg');

    const { resolveSpeechRuntimeConfig } = await import('../../electron/main/modules/speech/service.mjs');
    const config = resolveSpeechRuntimeConfig();

    expect(config).toEqual({
      ffmpegBinaryPath: '/env/ffmpeg',
      whisperBinaryPath: '/env/whisper',
      whisperModelPath: '/env/model.bin',
      tempDirectory: '/env/tmp'
    });

    vi.unstubAllEnvs();
  });

  it('transcodes non-wav audio to wav before invoking whisper when ffmpeg is configured', async () => {
    accessMock.mockResolvedValue(undefined);
    mkdtempMock.mockResolvedValue('/tmp/tibis-speech-456');
    writeFileMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue('转码结果');
    rmMock.mockResolvedValue(undefined);
    execFileMock.mockImplementation((_file, _args, callback: (error: null, result: { stdout: string; stderr: string }) => void) => {
      callback(null, { stdout: '', stderr: '' });
    });

    const { transcribeAudioSegment } = await import('../../electron/main/modules/speech/service.mjs');
    const result = await transcribeAudioSegment({
      buffer: new ArrayBuffer(8),
      mimeType: 'audio/webm',
      segmentId: 'seg-2'
    }, {
      ffmpegBinaryPath: '/tmp/ffmpeg',
      whisperBinaryPath: '/tmp/whisper',
      whisperModelPath: '/tmp/model.bin',
      tempDirectory: '/tmp'
    });

    expect(result.text).toBe('转码结果');
    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      '/tmp/ffmpeg',
      expect.arrayContaining(['-i', '/tmp/tibis-speech-456/input.webm', '/tmp/tibis-speech-456/input.wav']),
      expect.any(Function)
    );
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      '/tmp/whisper',
      expect.arrayContaining(['-f', '/tmp/tibis-speech-456/input.wav']),
      expect.any(Function)
    );
  });
});
