import type { AICreateOptions, AIRequestOptions } from 'types/ai';
import type { AIGenerateResult } from 'types/electron-api';
import { ipcMain } from 'electron';
import { getWindowFromWebContents } from '../../window.mjs';
import { aiService } from './service.mjs';

export function registerAIHandlers(): void {
  ipcMain.handle('ai:generate', async (_event, createOptions: AICreateOptions, request: AIRequestOptions) => {
    return (await aiService.generateText(createOptions, request)) satisfies AIGenerateResult;
  });

  ipcMain.handle('ai:stream', async (event, createOptions: AICreateOptions, request: AIRequestOptions) => {
    const win = getWindowFromWebContents(event.sender);

    if (!win) {
      throw new Error('Window not found');
    }

    try {
      const result = await aiService.streamText(createOptions, request);

      for await (const chunk of result.textStream) {
        win.webContents.send('ai:chunk', chunk);
      }

      win.webContents.send('ai:complete');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      win.webContents.send('ai:error', errorMessage);
    }
  });
}
