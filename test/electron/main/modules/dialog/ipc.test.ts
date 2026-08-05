/**
 * @file ipc.test.ts
 * @description 原生目录选择 IPC 的行为测试。
 */
import type { ElectronFileResult } from 'types/electron-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerDialogHandlers } from '../../../../../electron/main/modules/dialog/ipc.mts';

/** 原生 dialog 与文件系统依赖的测试替身。 */
const mocks = vi.hoisted(() => ({
  /** 按 channel 保存已注册的 IPC handler。 */
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  /** 原生打开对话框替身。 */
  showOpenDialog: vi.fn(),
  /** 原生保存对话框替身。 */
  showSaveDialog: vi.fn(),
  /** 路径规范化替身。 */
  realpath: vi.fn()
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown): void => {
      mocks.handlers.set(channel, handler);
    })
  }
}));

vi.mock('../../../../../electron/main/modules/dialog/utils.mjs', () => ({
  showOpenDialog: mocks.showOpenDialog,
  showSaveDialog: mocks.showSaveDialog
}));

vi.mock('node:fs/promises', () => ({
  realpath: mocks.realpath
}));

/**
 * 调用指定的目录选择 IPC handler。
 * @returns 原生目录选择结果。
 */
async function callOpenDirectory(): Promise<string | null> {
  const handler = mocks.handlers.get('dialog:openDirectory');
  if (!handler) throw new Error('dialog:openDirectory handler was not registered');
  return handler({}) as Promise<string | null>;
}

/**
 * 调用指定的文件选择 IPC handler。
 * @returns 原生文件选择结果
 */
async function callOpenFile(): Promise<ElectronFileResult> {
  const handler = mocks.handlers.get('dialog:openFile');
  if (!handler) throw new Error('dialog:openFile handler was not registered');
  return handler({}, {}) as Promise<ElectronFileResult>;
}

describe('dialog:openDirectory', (): void => {
  beforeEach((): void => {
    mocks.handlers.clear();
    mocks.showOpenDialog.mockReset();
    mocks.showSaveDialog.mockReset();
    mocks.realpath.mockReset();
    registerDialogHandlers();
  });

  it('returns null when the native directory dialog is cancelled', async (): Promise<void> => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    await expect(callOpenDirectory()).resolves.toBeNull();
    expect(mocks.realpath).not.toHaveBeenCalled();
  });

  it('returns the canonical directory selected by the native dialog', async (): Promise<void> => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/link-workspace'] });
    mocks.realpath.mockResolvedValue('/private/tmp/workspace');

    await expect(callOpenDirectory()).resolves.toBe('/private/tmp/workspace');
    expect(mocks.showOpenDialog).toHaveBeenCalledWith({ properties: ['openDirectory'] });
    expect(mocks.realpath).toHaveBeenCalledWith('/tmp/link-workspace');
  });

  it('rejects when the selected directory can no longer be canonicalized', async (): Promise<void> => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/missing-workspace'] });
    mocks.realpath.mockRejectedValue(new Error('ENOENT'));

    await expect(callOpenDirectory()).rejects.toThrow('ENOENT');
  });

  it('keeps a pending directory request independent from a file request', async (): Promise<void> => {
    let resolveDirectory: ((result: { canceled: boolean; filePaths: string[] }) => void) | undefined;
    const pendingDirectory = new Promise<{ canceled: boolean; filePaths: string[] }>(
      (resolve: (result: { canceled: boolean; filePaths: string[] }) => void): void => {
        resolveDirectory = resolve;
      }
    );
    mocks.showOpenDialog.mockReturnValueOnce(pendingDirectory).mockResolvedValueOnce({ canceled: true, filePaths: [] });
    mocks.realpath.mockResolvedValue('/private/tmp/workspace');

    const directoryRequest = callOpenDirectory();
    const fileRequest = callOpenFile();
    resolveDirectory?.({ canceled: false, filePaths: ['/tmp/link-workspace'] });

    await expect(directoryRequest).resolves.toBe('/private/tmp/workspace');
    await expect(fileRequest).resolves.toEqual({ canceled: true, filePath: null, content: '', fileName: '', ext: '' });
    expect(mocks.showOpenDialog).toHaveBeenCalledTimes(2);
  });
});
