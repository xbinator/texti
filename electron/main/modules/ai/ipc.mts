import type { AICreateOptions, AIRequestOptions } from 'types/ai';
import { ipcMain } from 'electron';
import { getWindowFromWebContents } from '../../window.mjs';
import { aiService } from './service.mjs';

export function registerAIHandlers(): void {
  ipcMain.handle('ai:invoke', async (_event, createOptions: AICreateOptions, request: AIRequestOptions) => {
    return aiService.generateText(createOptions, request);
  });

  ipcMain.handle('ai:stream', async (event, createOptions: AICreateOptions, request: AIRequestOptions) => {
    const win = getWindowFromWebContents(event.sender);

    if (!win) {
      throw new Error('Window not found');
    }

    try {
      const [error, result] = await aiService.streamText(createOptions, request);

      if (error) {
        win.webContents.send('ai:stream:error', error);
        return;
      }

      for await (const chunk of result.stream) {
        win.webContents.send('ai:stream:chunk', chunk);
      }

      win.webContents.send('ai:stream:complete');
    } catch (error) {
      // 在 aiService.streamText 抛出的错误已经被 normalizeError 转换成了 AIServiceError 格式（包含 code 和 message）
      // 我们直接将这个错误对象发送给前端，以便前端可以根据 code 进行差异化处理
      win.webContents.send('ai:stream:error', error);
    }
  });
}
