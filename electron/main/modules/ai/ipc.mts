import type { AIRequest, ProviderConfig, StoredProviderConfig } from '../../types';
import { ipcMain } from 'electron';
import { getWindowFromWebContents } from '../../window.mjs';
import { getStore } from '../store/service.mjs';
import { aiService } from './service.mjs';

export function registerAIHandlers(): void {
  ipcMain.handle('ai:configure', async (_event, providerId: string): Promise<boolean> => {
    const providerConfig = getStore().get(`providers.${providerId}`) as StoredProviderConfig | undefined;

    if (!providerConfig || !providerConfig.apiKey) {
      return false;
    }

    aiService.setProvider(providerId, {
      type: providerConfig.type as ProviderConfig['type'],
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl
    });

    return true;
  });

  ipcMain.handle('ai:removeProvider', async (_event, providerId: string) => {
    aiService.removeProvider(providerId);
  });

  ipcMain.handle('ai:generate', async (_event, request: AIRequest) => {
    return aiService.generateText(request);
  });

  ipcMain.handle('ai:stream', async (event, request: AIRequest) => {
    const win = getWindowFromWebContents(event.sender);

    if (!win) {
      throw new Error('Window not found');
    }

    try {
      for await (const chunk of aiService.streamText(request)) {
        win.webContents.send('ai:chunk', chunk);
      }
      win.webContents.send('ai:complete');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      win.webContents.send('ai:error', errorMessage);
    }
  });

  ipcMain.handle('ai:abort', async () => {
    // TODO: 实现 AbortController 中止逻辑
  });
}
