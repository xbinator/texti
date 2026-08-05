/**
 * @file runtime-bridge.test.ts
 * @description BChat ChatRuntime renderer bridge 快照处理测试。
 */
import type { AIToolContext } from 'types/ai';
import { describe, expect, it, vi } from 'vitest';
import { handleBChatRuntimeBridgeRequest } from '@/components/BChat/utils/runtimeBridge';

/**
 * 创建编辑器工具上下文测试夹具。
 * @returns 编辑器工具上下文
 */
function createEditorContext(): AIToolContext {
  return {
    document: {
      id: 'doc-1',
      title: 'index.ts',
      path: '/workspace/src/index.ts',
      locator: 'file:///workspace/src/index.ts',
      getContent: () => 'hello document'
    },
    editor: {
      getSelection: () => ({ from: 0, to: 5, text: 'hello' }),
      insertAtCursor: vi.fn(),
      replaceSelection: vi.fn(),
      replaceDocument: vi.fn()
    }
  };
}

describe('handleBChatRuntimeBridgeRequest', (): void => {
  it('returns the current editor document snapshot', async (): Promise<void> => {
    const result = await handleBChatRuntimeBridgeRequest(
      {
        runtimeId: 'runtime-1',
        sessionId: 'session-1',
        clientId: 'bchat',
        agentId: 'default',
        requestId: 'bridge-1',
        kind: 'document-snapshot'
      },
      {
        getEditorContext: createEditorContext,
        getWebviewContext: () => undefined
      }
    );

    expect(result).toEqual({
      id: 'doc-1',
      title: 'index.ts',
      path: '/workspace/src/index.ts',
      locator: 'file:///workspace/src/index.ts',
      content: 'hello document',
      selection: { from: 0, to: 5, text: 'hello' }
    });
  });

  it('returns the current webview snapshot', async (): Promise<void> => {
    const result = await handleBChatRuntimeBridgeRequest(
      {
        runtimeId: 'runtime-1',
        sessionId: 'session-1',
        clientId: 'bchat',
        agentId: 'default',
        requestId: 'bridge-1',
        kind: 'webview-snapshot'
      },
      {
        getEditorContext: () => undefined,
        getWebviewContext: () => ({
          readPageSnapshot: async () => ({
            url: 'https://example.com',
            title: 'Example',
            summary: 'Current Page: [Example](https://example.com)\nPage info: 800x600px [Start of page]\n[1]<button>Example</button>\n[End of page]',
            header: 'Page info: 800x600px [Start of page]',
            content: '[1]<button>Example</button>',
            footer: '[End of page]',
            text: 'page',
            selectedText: '',
            headings: [],
            links: [],
            capturedAt: 1,
            truncated: { text: false, content: false, headings: false, links: false, selectedText: false }
          }),
          operatePage: vi.fn()
        })
      }
    );

    expect(result).toEqual({
      url: 'https://example.com',
      title: 'Example',
      summary: 'Current Page: [Example](https://example.com)\nPage info: 800x600px [Start of page]\n[1]<button>Example</button>\n[End of page]',
      header: 'Page info: 800x600px [Start of page]',
      content: '[1]<button>Example</button>',
      footer: '[End of page]',
      text: 'page',
      selectedText: '',
      headings: [],
      links: [],
      capturedAt: 1,
      truncated: { text: false, content: false, headings: false, links: false, selectedText: false }
    });
  });

  it('returns the current Widget editor snapshot', async (): Promise<void> => {
    const result = await handleBChatRuntimeBridgeRequest(
      {
        runtimeId: 'runtime-1',
        sessionId: 'session-1',
        clientId: 'bchat',
        agentId: 'default',
        requestId: 'bridge-widget-1',
        kind: 'widget-snapshot'
      },
      {
        getEditorContext: () => undefined,
        getWebviewContext: () => undefined,
        getWidgetContext: () => ({
          widget: {
            title: 'aether-weather',
            path: '/home/user/.tibis/widgets/aether-weather/widget.json',
            getContent: () =>
              JSON.stringify(
                {
                  name: 'aether-weather',
                  description: 'Weather board',
                  inputSchema: { type: 'object', properties: {}, required: [] },
                  outputSchema: { type: 'object', properties: {}, required: [] },
                  dataSchema: { type: 'object', properties: {}, required: [] },
                  execute: { enabled: true, code: '' },
                  metadata: { width: 980, height: 990 },
                  elements: []
                },
                null,
                2
              )
          }
        })
      }
    );

    expect(result).toEqual({
      title: 'aether-weather',
      path: '/home/user/.tibis/widgets/aether-weather/widget.json',
      content: expect.stringContaining('"name": "aether-weather"')
    });
  });

  it('dispatches webview operation to the active WebView context', async (): Promise<void> => {
    const operatePage = vi.fn(async () => ({
      ok: true,
      action: 'click' as const,
      target: { index: 1, label: 'Search', tagName: 'BUTTON' },
      message: 'clicked',
      navigationStarted: false,
      pageChanged: true,
      shouldReadAgain: true
    }));
    const payload = { snapshotId: 'snap-1', action: { type: 'click' as const, index: 1 } };

    const result = await handleBChatRuntimeBridgeRequest(
      {
        runtimeId: 'runtime-1',
        sessionId: 'session-1',
        clientId: 'bchat',
        agentId: 'default',
        requestId: 'bridge-1',
        kind: 'webview-operate',
        payload
      },
      {
        getEditorContext: () => undefined,
        getWebviewContext: () => ({
          readPageSnapshot: async () => ({
            url: 'https://example.com',
            title: 'Example',
            summary: 'Current Page: [Example](https://example.com)\nPage info: 800x600px [Start of page]\n[1]<button>Example</button>\n[End of page]',
            header: 'Page info: 800x600px [Start of page]',
            content: '[1]<button>Example</button>',
            footer: '[End of page]',
            text: 'page',
            selectedText: '',
            headings: [],
            links: [],
            capturedAt: 1,
            truncated: { text: false, content: false, headings: false, links: false, selectedText: false }
          }),
          operatePage
        })
      }
    );

    expect(result).toMatchObject({ ok: true, action: 'click' });
    expect(operatePage).toHaveBeenCalledWith(payload);
  });

  it('accepts webview press operations through the bridge', async (): Promise<void> => {
    const operatePage = vi.fn(async () => ({
      ok: true,
      action: 'press' as const,
      target: { index: 1, label: '输入内容', tagName: 'INPUT' },
      message: 'executed',
      navigationStarted: false,
      pageChanged: true,
      shouldReadAgain: true
    }));
    const payload = { snapshotId: 'snap-1', action: { type: 'press' as const, index: 1, key: 'Enter' } };

    const result = await handleBChatRuntimeBridgeRequest(
      {
        runtimeId: 'runtime-1',
        sessionId: 'session-1',
        clientId: 'bchat',
        agentId: 'default',
        requestId: 'bridge-press-1',
        kind: 'webview-operate',
        payload
      },
      {
        getEditorContext: () => undefined,
        getWebviewContext: () => ({
          readPageSnapshot: vi.fn(),
          operatePage
        })
      }
    );

    expect(result).toMatchObject({ ok: true, action: 'press' });
    expect(operatePage).toHaveBeenCalledWith(payload);
  });

  it('rejects invalid webview operation payloads before dispatching to the WebView context', async (): Promise<void> => {
    const operatePage = vi.fn();

    await expect(
      handleBChatRuntimeBridgeRequest(
        {
          runtimeId: 'runtime-1',
          sessionId: 'session-1',
          clientId: 'bchat',
          agentId: 'default',
          requestId: 'bridge-1',
          kind: 'webview-operate',
          payload: { snapshotId: 123, action: { type: 'click', index: 1 } }
        },
        {
          getEditorContext: () => undefined,
          getWebviewContext: () => ({
            readPageSnapshot: vi.fn(),
            operatePage
          })
        }
      )
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(operatePage).not.toHaveBeenCalled();
  });

  it('returns an opened editor file content snapshot by path', async (): Promise<void> => {
    const result = await handleBChatRuntimeBridgeRequest(
      {
        runtimeId: 'runtime-1',
        sessionId: 'session-1',
        clientId: 'bchat',
        agentId: 'default',
        requestId: 'bridge-1',
        kind: 'file-content-snapshot',
        payload: { path: 'src/index.ts', workspaceRoot: '/workspace' }
      },
      {
        getEditorContext: createEditorContext,
        getEditorContextByDocumentId: (documentId) => (documentId === 'doc-1' ? createEditorContext() : undefined),
        findFileByPath: async (filePath) => (filePath === '/workspace/src/index.ts' ? { id: 'doc-1' } : null),
        getWebviewContext: () => undefined
      }
    );

    expect(result).toEqual({
      artifactId: 'doc-1',
      path: 'src/index.ts',
      content: 'hello document'
    });
  });

  it('returns an unsaved draft file content snapshot by virtual path', async (): Promise<void> => {
    const result = await handleBChatRuntimeBridgeRequest(
      {
        runtimeId: 'runtime-1',
        sessionId: 'session-1',
        clientId: 'bchat',
        agentId: 'default',
        requestId: 'bridge-1',
        kind: 'file-content-snapshot',
        payload: { path: 'unsaved://draft-1/note.md' }
      },
      {
        getEditorContext: () => undefined,
        getRecentFileById: async (fileId) =>
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
            : undefined,
        getWebviewContext: () => undefined
      }
    );

    expect(result).toEqual({
      artifactId: 'draft-1',
      path: 'unsaved://draft-1/note.md',
      content: 'draft content'
    });
  });

  it('writes an opened editor file content by path', async (): Promise<void> => {
    const replaceDocument = vi.fn();
    const context = createEditorContext();
    context.editor.replaceDocument = replaceDocument;
    const result = await handleBChatRuntimeBridgeRequest(
      {
        runtimeId: 'runtime-1',
        sessionId: 'session-1',
        clientId: 'bchat',
        agentId: 'default',
        requestId: 'bridge-1',
        kind: 'write-file-content',
        payload: { path: 'src/index.ts', content: 'next content', workspaceRoot: '/workspace' }
      },
      {
        getEditorContext: createEditorContext,
        getEditorContextByDocumentId: (documentId) => (documentId === 'doc-1' ? context : undefined),
        findFileByPath: async (filePath) => (filePath === '/workspace/src/index.ts' ? { id: 'doc-1' } : null),
        getWebviewContext: () => undefined
      }
    );

    expect(replaceDocument).toHaveBeenCalledWith('next content');
    expect(result).toEqual({
      artifactId: 'doc-1',
      path: 'src/index.ts',
      content: 'next content'
    });
  });

  it('writes an unsaved draft file content by virtual path', async (): Promise<void> => {
    const updateRecentFileById = vi.fn().mockResolvedValue({
      id: 'draft-1',
      type: 'file',
      name: 'note',
      ext: 'md',
      path: null,
      content: 'next draft'
    });
    const result = await handleBChatRuntimeBridgeRequest(
      {
        runtimeId: 'runtime-1',
        sessionId: 'session-1',
        clientId: 'bchat',
        agentId: 'default',
        requestId: 'bridge-1',
        kind: 'write-file-content',
        payload: { path: 'unsaved://draft-1/note.md', content: 'next draft' }
      },
      {
        getEditorContext: () => undefined,
        updateRecentFileById,
        getWebviewContext: () => undefined
      }
    );

    expect(updateRecentFileById).toHaveBeenCalledWith('draft-1', expect.objectContaining({ content: 'next draft' }));
    expect(result).toEqual({
      artifactId: 'draft-1',
      path: 'unsaved://draft-1/note.md',
      content: 'next draft'
    });
  });

  it('returns the current settings snapshot', async (): Promise<void> => {
    const result = await handleBChatRuntimeBridgeRequest(
      {
        runtimeId: 'runtime-1',
        sessionId: 'session-1',
        clientId: 'bchat',
        agentId: 'default',
        requestId: 'bridge-1',
        kind: 'settings-snapshot'
      },
      {
        getEditorContext: () => undefined,
        getWebviewContext: () => undefined,
        getSettingsSnapshot: () => ({
          settings: {
            theme: 'dark',
            themePreset: 'default',
            sourceMode: true,
            editorPageWidth: 'wide'
          }
        })
      }
    );

    expect(result).toEqual({
      settings: {
        theme: 'dark',
        themePreset: 'default',
        sourceMode: true,
        editorPageWidth: 'wide'
      }
    });
  });

  it('opens a file resource through the bridge', async (): Promise<void> => {
    const openFileByPath = vi.fn().mockResolvedValue({ id: 'file-1' });
    const result = await handleBChatRuntimeBridgeRequest(
      {
        runtimeId: 'runtime-1',
        sessionId: 'session-1',
        clientId: 'bchat',
        agentId: 'default',
        requestId: 'bridge-1',
        kind: 'open-resource',
        payload: { path: 'src/index.ts', resourceType: 'file' }
      },
      {
        getEditorContext: () => undefined,
        getWebviewContext: () => undefined,
        openFileByPath
      }
    );

    expect(openFileByPath).toHaveBeenCalledWith('src/index.ts');
    expect(result).toEqual({
      path: 'src/index.ts',
      resourceType: 'file',
      opened: true,
      fileId: 'file-1'
    });
  });

  it('opens a webview resource through the bridge', async (): Promise<void> => {
    const openInWebview = vi.fn();
    const result = await handleBChatRuntimeBridgeRequest(
      {
        runtimeId: 'runtime-1',
        sessionId: 'session-1',
        clientId: 'bchat',
        agentId: 'default',
        requestId: 'bridge-1',
        kind: 'open-resource',
        payload: { path: 'https://example.com', resourceType: 'webview' }
      },
      {
        getEditorContext: () => undefined,
        getWebviewContext: () => undefined,
        openInWebview
      }
    );

    expect(openInWebview).toHaveBeenCalledWith('https://example.com');
    expect(result).toEqual({
      path: 'https://example.com',
      resourceType: 'webview',
      opened: true
    });
  });

  it('applies a settings update through the bridge', async (): Promise<void> => {
    const applySetting = vi.fn().mockReturnValue({
      applied: true,
      key: 'theme',
      previousValue: 'light',
      currentValue: 'dark'
    });
    const result = await handleBChatRuntimeBridgeRequest(
      {
        runtimeId: 'runtime-1',
        sessionId: 'session-1',
        clientId: 'bchat',
        agentId: 'default',
        requestId: 'bridge-1',
        kind: 'apply-setting',
        payload: { key: 'theme', value: 'dark' }
      },
      {
        getEditorContext: () => undefined,
        getWebviewContext: () => undefined,
        applySetting
      }
    );

    expect(applySetting).toHaveBeenCalledWith({ key: 'theme', value: 'dark' });
    expect(result).toEqual({
      applied: true,
      key: 'theme',
      previousValue: 'light',
      currentValue: 'dark'
    });
  });

  it('opens a draft document through the bridge', async (): Promise<void> => {
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
    const result = await handleBChatRuntimeBridgeRequest(
      {
        runtimeId: 'runtime-1',
        sessionId: 'session-1',
        clientId: 'bchat',
        agentId: 'default',
        requestId: 'bridge-1',
        kind: 'open-draft',
        payload: { originalPath: 'Notes.md', content: '# Notes' }
      },
      {
        getEditorContext: () => undefined,
        getWebviewContext: () => undefined,
        openDraft
      }
    );

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

  it('throws a stable editor unavailable error when the requested context is missing', async (): Promise<void> => {
    await expect(
      handleBChatRuntimeBridgeRequest(
        {
          runtimeId: 'runtime-1',
          sessionId: 'session-1',
          clientId: 'bchat',
          agentId: 'default',
          requestId: 'bridge-1',
          kind: 'document-snapshot'
        },
        {
          getEditorContext: () => undefined,
          getWebviewContext: () => undefined
        }
      )
    ).rejects.toMatchObject({
      code: 'EDITOR_UNAVAILABLE',
      message: '当前没有可用的编辑器文档'
    });
  });
});
