/**
 * @file runtime-bridge.test.ts
 * @description BChat ChatRuntime renderer bridge 通用页面分发与应用能力测试。
 */
import type { ChatRuntimeBridgeRequestEvent } from 'types/chat-runtime';
import { describe, expect, it, vi } from 'vitest';
import { handleBChatRuntimeBridgeRequest } from '@/components/BChat/utils/runtimeBridge';
import type { ChatBridgeDispatchResult } from '@/hooks/useChat/useContextRegistry';

/**
 * 创建完整 Runtime Bridge 请求事件。
 * @param kind - Bridge 请求类型
 * @param payload - 可选请求负载
 * @returns Runtime Bridge 请求事件
 */
function createEvent(kind: string, payload?: unknown): ChatRuntimeBridgeRequestEvent {
  return {
    runtimeId: 'runtime-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    clientId: 'bchat',
    agentId: 'primary',
    rootRuntimeId: 'runtime-1',
    requestId: `request-${kind}`,
    kind,
    ...(payload === undefined ? {} : { payload })
  };
}

describe('handleBChatRuntimeBridgeRequest', (): void => {
  it('dispatches page bridge requests through the registered context', async (): Promise<void> => {
    const event = createEvent('document-snapshot');
    const dispatchAppBridge = vi.fn(
      async (): Promise<ChatBridgeDispatchResult> => ({
        handled: true,
        data: { id: 'doc-1', content: 'hello document' }
      })
    );

    const result = await handleBChatRuntimeBridgeRequest(event, { dispatchAppBridge });

    expect(dispatchAppBridge).toHaveBeenCalledWith(event);
    expect(result).toEqual({ id: 'doc-1', content: 'hello document' });
  });

  it('returns a stable unsupported error when the bound page declines a request', async (): Promise<void> => {
    const dispatchAppBridge = vi.fn(async (): Promise<ChatBridgeDispatchResult> => ({ handled: false }));

    await expect(handleBChatRuntimeBridgeRequest(createEvent('future-page-snapshot'), { dispatchAppBridge })).rejects.toMatchObject({
      code: 'ACTION_NOT_SUPPORTED'
    });
  });

  it('returns a stable unavailable error when no page context is bound', async (): Promise<void> => {
    await expect(handleBChatRuntimeBridgeRequest(createEvent('document-snapshot'), {})).rejects.toMatchObject({
      code: 'EDITOR_UNAVAILABLE'
    });
  });

  it('preserves a stable page error through nested normalization causes', async (): Promise<void> => {
    const stableError = Object.assign(new Error('网页快照已过期'), { code: 'STALE_SNAPSHOT' as const });
    const nestedError = new Error('网页快照已过期', { cause: new Error('网页快照已过期', { cause: stableError }) });
    const dispatchAppBridge = vi.fn(async (): Promise<ChatBridgeDispatchResult> => Promise.reject(nestedError));

    await expect(handleBChatRuntimeBridgeRequest(createEvent('webview-snapshot'), { dispatchAppBridge })).rejects.toMatchObject({
      code: 'STALE_SNAPSHOT',
      message: '网页快照已过期'
    });
  });

  it('rejects real file content snapshots because the main process owns disk access', async (): Promise<void> => {
    await expect(
      handleBChatRuntimeBridgeRequest(createEvent('file-content-snapshot', { path: 'src/index.ts', workspaceRoot: '/workspace' }), {})
    ).rejects.toMatchObject({ code: 'EDITOR_UNAVAILABLE' });
  });

  it('returns an unsaved draft file content snapshot by virtual path', async (): Promise<void> => {
    const result = await handleBChatRuntimeBridgeRequest(createEvent('file-content-snapshot', { path: 'unsaved://draft-1/note.md' }), {
      getRecentFileById: async (fileId: string) =>
        fileId === 'draft-1'
          ? {
              id: 'draft-1',
              type: 'file',
              url: '/editor/draft-1',
              title: 'note.md',
              description: '未保存文件',
              name: 'note',
              ext: 'md',
              path: null,
              content: 'draft content'
            }
          : undefined
    });

    expect(result).toEqual({
      artifactId: 'draft-1',
      path: 'unsaved://draft-1/note.md',
      content: 'draft content'
    });
  });

  it('rejects real file content writes because the main process owns disk access', async (): Promise<void> => {
    await expect(
      handleBChatRuntimeBridgeRequest(createEvent('write-file-content', { path: 'src/index.ts', content: 'next content', workspaceRoot: '/workspace' }), {})
    ).rejects.toMatchObject({ code: 'EDITOR_UNAVAILABLE' });
  });

  it('lets the bound page handle an in-memory file write first', async (): Promise<void> => {
    const dispatchAppBridge = vi.fn(
      async (): Promise<ChatBridgeDispatchResult> => ({
        handled: true,
        data: { artifactId: 'draft-1', path: 'unsaved://draft-1/note.md', content: 'next draft' }
      })
    );
    const updateRecentFileById = vi.fn();
    const event = createEvent('write-file-content', { path: 'unsaved://draft-1/note.md', content: 'next draft' });

    const result = await handleBChatRuntimeBridgeRequest(event, { dispatchAppBridge, updateRecentFileById });

    expect(dispatchAppBridge).toHaveBeenCalledWith(event);
    expect(updateRecentFileById).not.toHaveBeenCalled();
    expect(result).toEqual({ artifactId: 'draft-1', path: 'unsaved://draft-1/note.md', content: 'next draft' });
  });

  it('falls back to the recent store when the bound page declines an unsaved write', async (): Promise<void> => {
    const dispatchAppBridge = vi.fn(async (): Promise<ChatBridgeDispatchResult> => ({ handled: false }));
    const updateRecentFileById = vi.fn().mockResolvedValue({
      id: 'draft-1',
      type: 'file',
      name: 'note',
      ext: 'md',
      path: null,
      content: 'next draft'
    });

    const result = await handleBChatRuntimeBridgeRequest(createEvent('write-file-content', { path: 'unsaved://draft-1/note.md', content: 'next draft' }), {
      dispatchAppBridge,
      updateRecentFileById
    });

    expect(updateRecentFileById).toHaveBeenCalledWith('draft-1', expect.objectContaining({ content: 'next draft' }));
    expect(result).toEqual({
      artifactId: 'draft-1',
      path: 'unsaved://draft-1/note.md',
      content: 'next draft'
    });
  });

  it('falls back to the recent store when the bound page was unregistered', async (): Promise<void> => {
    const unavailableError = Object.assign(new Error('page unavailable'), { code: 'EDITOR_UNAVAILABLE' as const });
    const dispatchAppBridge = vi.fn(async (): Promise<ChatBridgeDispatchResult> => Promise.reject(unavailableError));
    const updateRecentFileById = vi.fn().mockResolvedValue({
      id: 'draft-1',
      type: 'file',
      name: 'note',
      ext: 'md',
      path: null,
      content: 'recovered draft'
    });

    const result = await handleBChatRuntimeBridgeRequest(createEvent('write-file-content', { path: 'unsaved://draft-1/note.md', content: 'recovered draft' }), {
      dispatchAppBridge,
      updateRecentFileById
    });

    expect(updateRecentFileById).toHaveBeenCalledWith('draft-1', expect.objectContaining({ content: 'recovered draft' }));
    expect(result).toEqual({
      artifactId: 'draft-1',
      path: 'unsaved://draft-1/note.md',
      content: 'recovered draft'
    });
  });

  it('falls back through nested unavailable errors from a bound page', async (): Promise<void> => {
    const unavailableError = Object.assign(new Error('page unavailable'), { code: 'EDITOR_UNAVAILABLE' as const });
    const nestedError = new Error('page unavailable', { cause: new Error('page unavailable', { cause: unavailableError }) });
    const dispatchAppBridge = vi.fn(async (): Promise<ChatBridgeDispatchResult> => Promise.reject(nestedError));
    const updateRecentFileById = vi.fn().mockResolvedValue({
      id: 'draft-1',
      type: 'file',
      name: 'note',
      ext: 'md',
      path: null,
      content: 'recovered draft'
    });

    const result = await handleBChatRuntimeBridgeRequest(createEvent('write-file-content', { path: 'unsaved://draft-1/note.md', content: 'recovered draft' }), {
      dispatchAppBridge,
      updateRecentFileById
    });

    expect(updateRecentFileById).toHaveBeenCalledWith('draft-1', expect.objectContaining({ content: 'recovered draft' }));
    expect(result).toEqual({ artifactId: 'draft-1', path: 'unsaved://draft-1/note.md', content: 'recovered draft' });
  });

  it('returns the current settings snapshot', async (): Promise<void> => {
    const result = await handleBChatRuntimeBridgeRequest(createEvent('settings-snapshot'), {
      getSettingsSnapshot: () => ({
        settings: {
          theme: 'dark',
          themePreset: 'default',
          sourceMode: true,
          editorPageWidth: 'wide'
        },
        themePresetOptions: [
          { id: 'default', label: '默认「Graphite」', description: '白/浅灰/黑灰' },
          { id: 'custom-solarized', label: 'Solarized', description: 'Solarized custom palette' }
        ]
      })
    });

    expect(result).toEqual({
      settings: {
        theme: 'dark',
        themePreset: 'default',
        sourceMode: true,
        editorPageWidth: 'wide'
      },
      themePresetOptions: [
        { id: 'default', label: '默认「Graphite」', description: '白/浅灰/黑灰' },
        { id: 'custom-solarized', label: 'Solarized', description: 'Solarized custom palette' }
      ]
    });
  });

  it('opens a file resource through the application bridge', async (): Promise<void> => {
    const openFileByPath = vi.fn().mockResolvedValue({ id: 'file-1' });
    const result = await handleBChatRuntimeBridgeRequest(createEvent('open-resource', { path: 'src/index.ts', resourceType: 'file' }), {
      openFileByPath
    });

    expect(openFileByPath).toHaveBeenCalledWith('src/index.ts');
    expect(result).toEqual({ path: 'src/index.ts', resourceType: 'file', opened: true, fileId: 'file-1' });
  });

  it('opens a webview resource through the application bridge', async (): Promise<void> => {
    const openInWebview = vi.fn();
    const result = await handleBChatRuntimeBridgeRequest(createEvent('open-resource', { path: 'https://example.com', resourceType: 'webview' }), {
      openInWebview
    });

    expect(openInWebview).toHaveBeenCalledWith('https://example.com');
    expect(result).toEqual({ path: 'https://example.com', resourceType: 'webview', opened: true });
  });

  it('applies a settings update through the application bridge', async (): Promise<void> => {
    const applySetting = vi.fn().mockReturnValue({
      applied: true,
      key: 'theme',
      previousValue: 'light',
      currentValue: 'dark'
    });
    const result = await handleBChatRuntimeBridgeRequest(createEvent('apply-setting', { key: 'theme', value: 'dark' }), { applySetting });

    expect(applySetting).toHaveBeenCalledWith({ key: 'theme', value: 'dark' });
    expect(result).toEqual({ applied: true, key: 'theme', previousValue: 'light', currentValue: 'dark' });
  });

  it('opens a draft document through the application bridge', async (): Promise<void> => {
    const openDraft = vi.fn().mockResolvedValue({
      file: {
        id: 'draft-1',
        type: 'file',
        name: 'Notes',
        ext: 'md',
        path: null,
        content: '# Notes'
      },
      unsavedPath: 'unsaved://draft-1/Notes.md'
    });
    const result = await handleBChatRuntimeBridgeRequest(createEvent('open-draft', { originalPath: 'Notes.md', content: '# Notes' }), { openDraft });

    expect(openDraft).toHaveBeenCalledWith({ originalPath: 'Notes.md', content: '# Notes' });
    expect(result).toEqual({
      file: {
        id: 'draft-1',
        type: 'file',
        name: 'Notes',
        ext: 'md',
        path: null,
        content: '# Notes'
      },
      unsavedPath: 'unsaved://draft-1/Notes.md'
    });
  });
});
