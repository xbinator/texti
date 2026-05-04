/**
 * @file ipc.mts
 * @description 注册语音转写相关的 IPC handlers。
 */
import type { SpeechRuntimeStatus, SpeechTranscribeRequest, SpeechTranscribeResult } from './types.mjs';
import { BrowserWindow, ipcMain } from 'electron';
import { installSpeechRuntime, resolveSpeechRuntimeManifest } from './installer.mjs';
import { getSpeechRuntimeStatus, removeSpeechRuntime } from './runtime.mjs';
import { transcribeAudioSegment } from './service.mjs';

/**
 * 注册语音转写 IPC handlers。
 */
export function registerSpeechHandlers(): void {
  ipcMain.handle('speech:transcribe', async (_event, request: SpeechTranscribeRequest): Promise<SpeechTranscribeResult> => {
    return transcribeAudioSegment(request);
  });

  ipcMain.handle('speech:getRuntimeStatus', async (): Promise<SpeechRuntimeStatus> => {
    return getSpeechRuntimeStatus();
  });

  ipcMain.handle('speech:installRuntime', async (): Promise<SpeechRuntimeStatus> => {
    const platform = process.platform as 'darwin' | 'win32';
    const arch = process.arch as 'arm64' | 'x64';
    const manifest = await resolveSpeechRuntimeManifest(platform, arch);

    await installSpeechRuntime({
      platform,
      arch,
      manifest,
      onProgress: (progress) => {
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send('speech:install-progress', progress);
        });
      }
    });

    return getSpeechRuntimeStatus();
  });

  ipcMain.handle('speech:removeRuntime', async (): Promise<SpeechRuntimeStatus> => {
    await removeSpeechRuntime();
    return getSpeechRuntimeStatus();
  });
}
