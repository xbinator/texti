/**
 * @file main-tools.test.ts
 * @description ChatRuntime 主进程工具入口测试。
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  MainToolBridgeRequest,
  MainToolConfirmationRequest,
  MainToolsDependencies
} from '../../../../../../electron/main/modules/chat/runtime/tools/types.mjs';
import type { ActiveChatRuntime } from '../../../../../../electron/main/modules/chat/runtime/types.mjs';
import type { AIToolActivityReporter } from 'types/ai';
import { describe, expect, it, vi } from 'vitest';
import { createMainToolExecutor } from '../../../../../../electron/main/modules/chat/runtime/tools/index.mjs';

/** 测试 runtime 状态。 */
const runtime: ActiveChatRuntime = {
  runtimeId: 'runtime-1',
  sessionId: 'session-1',
  turnId: 'turn-1',
  clientId: 'client-1',
  agentId: 'agent-1',
  rootRuntimeId: 'runtime-1',
  status: 'running',
  phase: 'streaming',
  abortController: new AbortController(),
  createdAt: 0
};

/**
 * 创建主进程工具测试依赖。
 * @param bridgeRequests - 收集 bridge 请求的数组
 * @returns 主进程工具依赖
 */
function createMainToolDependencies(bridgeRequests: MainToolBridgeRequest[]): MainToolsDependencies {
  return {
    now: () => '2026-06-19T00:00:00.000Z',
    async requestBridge(input: MainToolBridgeRequest) {
      bridgeRequests.push(input);
      return {
        status: 'success',
        data: {
          id: 'doc-1',
          title: 'Notes',
          path: null,
          content: 'hello selected text',
          selection: { from: 6, to: 19, text: 'selected text' }
        }
      };
    },
    async requestConfirmation() {
      return { approved: true };
    }
  };
}

describe('createMainToolExecutor', (): void => {
  it('returns the stable bridge artifact ID from read_file', async (): Promise<void> => {
    const executeMainTool = createMainToolExecutor({
      ...createMainToolDependencies([]),
      async requestBridge() {
        return {
          status: 'success',
          data: {
            artifactId: 'document-1',
            path: 'src/index.ts',
            content: 'export const value = 1;'
          }
        };
      }
    });

    const result = await executeMainTool({
      runtime,
      toolCallId: 'tool-call-artifact-1',
      toolName: 'read_file',
      input: { path: 'src/index.ts' }
    });

    expect(result).toMatchObject({
      toolName: 'read_file',
      status: 'success',
      data: { artifactId: 'document-1', path: 'src/index.ts' }
    });
  });

  it('routes local read tools without renderer bridge', async (): Promise<void> => {
    const bridgeRequests: MainToolBridgeRequest[] = [];
    const executeMainTool = createMainToolExecutor(createMainToolDependencies(bridgeRequests));

    const result = await executeMainTool({
      runtime,
      toolCallId: 'tool-call-1',
      toolName: 'get_current_time',
      input: {}
    });

    expect(result.status).toBe('success');
    expect(result.toolName).toBe('get_current_time');
    expect(result.data).toMatchObject({ iso: '2026-06-19T00:00:00.000Z' });
    expect(bridgeRequests).toEqual([]);
  });

  it('routes bridge-backed read tools through shared dependencies', async (): Promise<void> => {
    const bridgeRequests: MainToolBridgeRequest[] = [];
    const executeMainTool = createMainToolExecutor(createMainToolDependencies(bridgeRequests));

    const result = await executeMainTool({
      runtime,
      toolCallId: 'tool-call-2',
      toolName: 'read_current_document',
      input: { includeSelection: true }
    });

    expect(result.status).toBe('success');
    expect(result.toolName).toBe('read_current_document');
    expect(result.data).toMatchObject({
      id: 'doc-1',
      artifactId: 'doc-1',
      title: 'Notes',
      content: 'hello selected text',
      selected: { content: 'selected text' }
    });
    expect(bridgeRequests).toEqual([
      {
        runtimeId: 'runtime-1',
        toolCallId: 'tool-call-2',
        kind: 'document-snapshot',
        payload: { includeSelection: true }
      }
    ]);
  });

  it('routes read_current_widget through Widget editor bridge', async (): Promise<void> => {
    const bridgeRequests: MainToolBridgeRequest[] = [];
    const executeMainTool = createMainToolExecutor({
      ...createMainToolDependencies(bridgeRequests),
      async requestBridge(input: MainToolBridgeRequest) {
        bridgeRequests.push(input);
        return {
          status: 'success',
          data: {
            title: 'aether-weather',
            path: '/home/user/.tibis/widgets/aether-weather/widget.json',
            content: JSON.stringify({ name: 'aether-weather', elements: [] }, null, 2)
          }
        };
      }
    });

    const result = await executeMainTool({
      runtime,
      toolCallId: 'tool-call-widget-1',
      toolName: 'read_current_widget',
      input: {}
    });

    expect(result.status).toBe('success');
    expect(result.toolName).toBe('read_current_widget');
    expect(result.data).toMatchObject({
      title: 'aether-weather',
      path: '/home/user/.tibis/widgets/aether-weather/widget.json',
      content: expect.stringContaining('"name": "aether-weather"')
    });
    expect(bridgeRequests).toEqual([
      {
        runtimeId: 'runtime-1',
        toolCallId: 'tool-call-widget-1',
        kind: 'widget-snapshot',
        payload: {}
      }
    ]);
  });

  it('routes read_current_webpage through WebviewTool bridge', async (): Promise<void> => {
    const bridgeRequests: MainToolBridgeRequest[] = [];
    const executeMainTool = createMainToolExecutor({
      ...createMainToolDependencies(bridgeRequests),
      async requestBridge(input: MainToolBridgeRequest) {
        bridgeRequests.push(input);
        return {
          status: 'success',
          data: {
            url: 'https://example.com',
            title: 'Example',
            summary: [
              'Current Page: [Example](https://example.com)',
              'Page info: 800x600px [Start of page]',
              '[1]<button>Search</button>',
              '[End of page]'
            ].join('\n'),
            header: 'Page info: 800x600px [Start of page]',
            content: '[1]<button>Search</button>',
            footer: '[End of page]',
            text: 'Hello',
            selectedText: '',
            headings: [],
            links: [],
            capturedAt: 1,
            truncated: { content: false },
            snapshotId: 'snap-1',
            loading: false,
            scroll: {
              x: 0,
              y: 0,
              viewportWidth: 800,
              viewportHeight: 600,
              scrollWidth: 800,
              scrollHeight: 1200,
              atTop: true,
              atBottom: false
            },
            elements: []
          }
        };
      }
    });

    const result = await executeMainTool({
      runtime,
      toolCallId: 'tool-call-web-1',
      toolName: 'read_current_webpage',
      input: {}
    });

    expect(result.status).toBe('success');
    expect(result.toolName).toBe('read_current_webpage');
    expect(result.data).toMatchObject({
      snapshotId: 'snap-1',
      title: 'Example',
      summary: expect.stringContaining('Current Page: [Example](https://example.com)'),
      content: '[1]<button>Search</button>'
    });
    expect(bridgeRequests).toEqual([
      {
        runtimeId: 'runtime-1',
        toolCallId: 'tool-call-web-1',
        kind: 'webview-snapshot',
        payload: {}
      }
    ]);
  });

  it('rejects read_current_webpage payloads without simplified DOM content', async (): Promise<void> => {
    const bridgeRequests: MainToolBridgeRequest[] = [];
    const executeMainTool = createMainToolExecutor({
      ...createMainToolDependencies(bridgeRequests),
      async requestBridge(input: MainToolBridgeRequest) {
        bridgeRequests.push(input);
        return {
          status: 'success',
          data: {
            url: 'https://example.com',
            title: 'Example',
            text: 'Hello',
            selectedText: '',
            headings: [],
            links: [],
            capturedAt: 1,
            truncated: {}
          }
        };
      }
    });

    const result = await executeMainTool({
      runtime,
      toolCallId: 'tool-call-web-missing-content-1',
      toolName: 'read_current_webpage',
      input: {}
    });

    expect(result).toMatchObject({
      toolName: 'read_current_webpage',
      status: 'failure',
      error: { code: 'INVALID_INPUT', message: '当前网页快照格式无效' }
    });
  });

  it('rejects read_current_webpage payloads without a snapshot id', async (): Promise<void> => {
    const executeMainTool = createMainToolExecutor({
      ...createMainToolDependencies([]),
      async requestBridge() {
        return {
          status: 'success',
          data: {
            url: 'https://example.com',
            title: 'Example',
            summary: 'Current Page: Example',
            header: 'Page info: 800x600px',
            content: '[1]<button>Search</button>',
            footer: '[End of page]',
            text: 'Hello',
            selectedText: '',
            headings: [],
            links: [],
            capturedAt: 1,
            truncated: { content: false }
          }
        };
      }
    });

    const result = await executeMainTool({
      runtime,
      toolCallId: 'tool-call-web-missing-snapshot-1',
      toolName: 'read_current_webpage',
      input: {}
    });

    expect(result).toMatchObject({
      toolName: 'read_current_webpage',
      status: 'failure',
      error: { code: 'INVALID_INPUT', message: '当前网页快照格式无效' }
    });
  });

  it('rejects read_current_webpage payloads with a blank snapshot id', async (): Promise<void> => {
    const executeMainTool = createMainToolExecutor({
      ...createMainToolDependencies([]),
      async requestBridge() {
        return {
          status: 'success',
          data: {
            url: 'https://example.com',
            title: 'Example',
            summary: 'Current Page: Example',
            header: 'Page info: 800x600px',
            content: '[1]<button>Search</button>',
            footer: '[End of page]',
            text: 'Hello',
            selectedText: '',
            headings: [],
            links: [],
            capturedAt: 1,
            truncated: { content: false },
            snapshotId: '   '
          }
        };
      }
    });

    const result = await executeMainTool({
      runtime,
      toolCallId: 'tool-call-web-blank-snapshot-1',
      toolName: 'read_current_webpage',
      input: {}
    });

    expect(result).toMatchObject({ status: 'failure', error: { code: 'INVALID_INPUT', message: '当前网页快照格式无效' } });
  });

  it('rejects invalid read_current_webpage bridge payloads', async (): Promise<void> => {
    const bridgeRequests: MainToolBridgeRequest[] = [];
    const executeMainTool = createMainToolExecutor({
      ...createMainToolDependencies(bridgeRequests),
      async requestBridge(input: MainToolBridgeRequest) {
        bridgeRequests.push(input);
        return {
          status: 'success',
          data: { title: 'Missing required webpage fields' }
        };
      }
    });

    const result = await executeMainTool({
      runtime,
      toolCallId: 'tool-call-web-invalid-1',
      toolName: 'read_current_webpage',
      input: {}
    });

    expect(result).toMatchObject({
      toolName: 'read_current_webpage',
      status: 'failure',
      error: { code: 'INVALID_INPUT', message: '当前网页快照格式无效' }
    });
  });

  it('confirms operate_webpage before requesting renderer operation', async (): Promise<void> => {
    const bridgeRequests: MainToolBridgeRequest[] = [];
    const requestConfirmation = vi.fn(async () => ({ approved: true }));
    const executeMainTool = createMainToolExecutor({
      now: () => '2026-06-22T00:00:00.000Z',
      requestConfirmation,
      async requestBridge(input: MainToolBridgeRequest) {
        bridgeRequests.push(input);
        return {
          status: 'success',
          data: {
            ok: true,
            action: 'click',
            target: { index: 2, label: 'Search', tagName: 'BUTTON' },
            message: '已点击 Search',
            navigationStarted: false,
            pageChanged: true,
            shouldReadAgain: true
          }
        };
      }
    });
    const toolInput = {
      snapshotId: 'snap-1',
      step: {
        evaluation: '结果列表已经出现。',
        memory: '当前最低价格为 ¥820。',
        nextGoal: '打开下一页继续比较。'
      },
      action: { type: 'click', index: 2, rawDom: 'ACTION_INPUT_DOM_SENTINEL' }
    };

    const result = await executeMainTool({
      runtime,
      toolCallId: 'tool-call-web-2',
      toolName: 'operate_webpage',
      input: toolInput
    });

    expect(result.status).toBe('success');
    expect(result.toolName).toBe('operate_webpage');
    expect(requestConfirmation).toHaveBeenCalledTimes(1);
    expect(requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          toolName: 'operate_webpage',
          description: '点击当前网页元素 #2',
          allowRemember: true,
          rememberScopes: ['session', 'always']
        })
      })
    );
    expect(JSON.stringify(requestConfirmation.mock.calls)).not.toContain('当前最低价格');
    expect(JSON.stringify(bridgeRequests)).not.toContain('ACTION_INPUT_DOM_SENTINEL');
    expect(bridgeRequests).toEqual([
      {
        runtimeId: 'runtime-1',
        toolCallId: 'tool-call-web-2',
        kind: 'webview-operate',
        payload: { snapshotId: 'snap-1', action: { type: 'click', index: 2 } }
      }
    ]);
  });

  it('keeps legacy operate_webpage inputs compatible at the bridge boundary', async (): Promise<void> => {
    const bridgeRequests: MainToolBridgeRequest[] = [];
    const executeMainTool = createMainToolExecutor({
      now: () => '2026-06-22T00:00:00.000Z',
      async requestConfirmation() {
        return { approved: true };
      },
      async requestBridge(input: MainToolBridgeRequest) {
        bridgeRequests.push(input);
        return {
          status: 'success',
          data: {
            ok: true,
            action: 'click',
            target: { index: 2, label: 'Search', tagName: 'BUTTON' },
            message: '已点击 Search',
            navigationStarted: false,
            pageChanged: true,
            shouldReadAgain: true
          }
        };
      }
    });

    await executeMainTool({
      runtime,
      toolCallId: 'tool-call-web-legacy-1',
      toolName: 'operate_webpage',
      input: { snapshotId: 'snap-1', action: { type: 'click', index: 2 } }
    });

    expect(bridgeRequests).toEqual([
      {
        runtimeId: 'runtime-1',
        toolCallId: 'tool-call-web-legacy-1',
        kind: 'webview-operate',
        payload: { snapshotId: 'snap-1', action: { type: 'click', index: 2 } }
      }
    ]);
  });

  it('never forwards malformed operate_webpage input verbatim', async (): Promise<void> => {
    const bridgeRequests: MainToolBridgeRequest[] = [];
    const executeMainTool = createMainToolExecutor({
      now: () => '2026-06-22T00:00:00.000Z',
      async requestConfirmation() {
        return { approved: true };
      },
      async requestBridge(input: MainToolBridgeRequest) {
        bridgeRequests.push(input);
        return {
          status: 'failure',
          error: { code: 'INVALID_INPUT', message: '网页操作参数无效' }
        };
      }
    });

    const result = await executeMainTool({
      runtime,
      toolCallId: 'tool-call-web-malformed-1',
      toolName: 'operate_webpage',
      input: 'STEP_SENTINEL'
    });

    expect(result).toMatchObject({ status: 'failure', error: { code: 'INVALID_INPUT', message: '网页操作参数无效' } });
    expect(JSON.stringify(bridgeRequests)).not.toContain('STEP_SENTINEL');
    expect(bridgeRequests).toEqual([]);
  });

  it('rejects oversized operate_webpage input before confirmation', async (): Promise<void> => {
    const bridgeRequests: MainToolBridgeRequest[] = [];
    const requestConfirmation = vi.fn(async () => ({ approved: true }));
    const executeMainTool = createMainToolExecutor({
      now: () => '2026-06-22T00:00:00.000Z',
      requestConfirmation,
      async requestBridge(input: MainToolBridgeRequest) {
        bridgeRequests.push(input);
        return {
          status: 'failure',
          error: { code: 'INVALID_INPUT', message: '网页操作参数无效' }
        };
      }
    });

    const result = await executeMainTool({
      runtime,
      toolCallId: 'tool-call-web-oversized-1',
      toolName: 'operate_webpage',
      input: {
        snapshotId: 'snap-1',
        action: { type: 'input', index: 2, text: 'x'.repeat(4_001) }
      }
    });

    expect(result).toMatchObject({
      toolName: 'operate_webpage',
      status: 'failure',
      error: { code: 'INVALID_INPUT', message: '网页操作参数无效' }
    });
    expect(requestConfirmation).not.toHaveBeenCalled();
    expect(bridgeRequests).toEqual([]);
  });

  it('keeps operate_webpage bridge idle when permission is denied', async (): Promise<void> => {
    const bridgeRequests: MainToolBridgeRequest[] = [];
    const executeMainTool = createMainToolExecutor({
      now: () => '2026-06-22T00:00:00.000Z',
      async requestConfirmation(): Promise<{ approved: false }> {
        return { approved: false };
      },
      async requestBridge(input: MainToolBridgeRequest) {
        bridgeRequests.push(input);
        return {
          status: 'success',
          data: {
            ok: true,
            action: 'click',
            message: '已点击',
            navigationStarted: false,
            pageChanged: true,
            shouldReadAgain: true
          }
        };
      }
    });

    const result = await executeMainTool({
      runtime,
      toolCallId: 'tool-call-web-denied-1',
      toolName: 'operate_webpage',
      input: { snapshotId: 'snap-1', action: { type: 'click', index: 2 } }
    });

    expect(result).toMatchObject({ toolName: 'operate_webpage', status: 'failure', error: { code: 'USER_CANCELLED' } });
    expect(bridgeRequests).toEqual([]);
  });

  it('rejects invalid operate_webpage bridge payloads', async (): Promise<void> => {
    const bridgeRequests: MainToolBridgeRequest[] = [];
    const executeMainTool = createMainToolExecutor({
      now: () => '2026-06-22T00:00:00.000Z',
      async requestConfirmation() {
        return { approved: true };
      },
      async requestBridge(input: MainToolBridgeRequest) {
        bridgeRequests.push(input);
        return {
          status: 'success',
          data: { ok: true, action: 'click' }
        };
      }
    });

    const result = await executeMainTool({
      runtime,
      toolCallId: 'tool-call-web-invalid-2',
      toolName: 'operate_webpage',
      input: { snapshotId: 'snap-1', action: { type: 'click', index: 2 } }
    });

    expect(result).toMatchObject({
      toolName: 'operate_webpage',
      status: 'failure',
      error: { code: 'INVALID_INPUT', message: '网页操作结果格式无效' }
    });
    expect(bridgeRequests).toHaveLength(1);
  });

  it('rejects structurally complete operate_webpage results with an unknown action', async (): Promise<void> => {
    const executeMainTool = createMainToolExecutor({
      now: () => '2026-06-22T00:00:00.000Z',
      async requestConfirmation() {
        return { approved: true };
      },
      async requestBridge() {
        return {
          status: 'success',
          data: {
            ok: true,
            action: 'RESULT_ACTION_DOM_SENTINEL',
            target: null,
            message: 'executed',
            navigationStarted: false,
            pageChanged: true,
            shouldReadAgain: true
          }
        };
      }
    });

    const result = await executeMainTool({
      runtime,
      toolCallId: 'tool-call-web-invalid-action-1',
      toolName: 'operate_webpage',
      input: { snapshotId: 'snap-1', action: { type: 'click', index: 2 } }
    });

    expect(result).toMatchObject({
      toolName: 'operate_webpage',
      status: 'failure',
      error: { code: 'INVALID_INPUT', message: '网页操作结果格式无效' }
    });
    expect(JSON.stringify(result)).not.toContain('RESULT_ACTION_DOM_SENTINEL');
  });

  it('drops unknown fields from successful operate_webpage results', async (): Promise<void> => {
    const executeMainTool = createMainToolExecutor({
      now: () => '2026-06-22T00:00:00.000Z',
      async requestConfirmation() {
        return { approved: true };
      },
      async requestBridge() {
        return {
          status: 'success',
          data: {
            ok: true,
            action: 'click',
            target: { index: 2, label: 'Search', tagName: 'BUTTON', rawDom: 'TARGET_DOM_SENTINEL' },
            message: '已点击 Search',
            navigationStarted: false,
            pageChanged: true,
            shouldReadAgain: true,
            rawDom: 'RESULT_DOM_SENTINEL'
          }
        };
      }
    });

    const result = await executeMainTool({
      runtime,
      toolCallId: 'tool-call-web-result-fields-1',
      toolName: 'operate_webpage',
      input: { snapshotId: 'snap-1', action: { type: 'click', index: 2 } }
    });

    expect(result).toMatchObject({
      status: 'success',
      data: {
        ok: true,
        action: 'click',
        target: { index: 2, label: 'Search', tagName: 'BUTTON' },
        message: '已点击 Search'
      }
    });
    expect(JSON.stringify(result)).not.toContain('TARGET_DOM_SENTINEL');
    expect(JSON.stringify(result)).not.toContain('RESULT_DOM_SENTINEL');
  });

  it('returns a stable failure for unknown main tools', async (): Promise<void> => {
    const executeMainTool = createMainToolExecutor(createMainToolDependencies([]));

    const result = await executeMainTool({
      runtime,
      toolCallId: 'tool-call-3',
      toolName: 'unknown_tool',
      input: {}
    });

    expect(result).toMatchObject({
      toolName: 'unknown_tool',
      status: 'failure',
      error: { code: 'TOOL_NOT_FOUND' }
    });
  });

  it('blocks read_file relative paths that escape the workspace', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      await fs.mkdir(workspaceRoot);
      await fs.writeFile(path.join(tempRoot, 'outside.txt'), 'secret', 'utf8');
      const requestConfirmation = vi.fn(async () => ({ approved: true }));
      const executeMainTool = createMainToolExecutor({
        now: () => '2026-06-19T00:00:00.000Z',
        async requestBridge() {
          return { status: 'failure', error: { code: 'EDITOR_UNAVAILABLE', message: 'no editor' } };
        },
        requestConfirmation
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-4',
        toolName: 'read_file',
        input: { path: '../outside.txt' }
      });

      expect(result).toMatchObject({
        toolName: 'read_file',
        status: 'failure',
        error: { code: 'PERMISSION_DENIED' }
      });
      expect(requestConfirmation).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('confirms read_file absolute paths that normalize outside the workspace', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      await fs.mkdir(workspaceRoot);
      await fs.writeFile(path.join(tempRoot, 'outside.txt'), 'secret', 'utf8');
      const requestConfirmation = vi.fn(async () => ({ approved: true }));
      const executeMainTool = createMainToolExecutor({
        now: () => '2026-06-19T00:00:00.000Z',
        async requestBridge() {
          return { status: 'failure', error: { code: 'EDITOR_UNAVAILABLE', message: 'no editor' } };
        },
        requestConfirmation
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-7',
        toolName: 'read_file',
        input: { path: `${workspaceRoot}${path.sep}..${path.sep}outside.txt` }
      });

      expect(result).toMatchObject({
        toolName: 'read_file',
        status: 'success',
        data: { content: 'secret' }
      });
      expect(requestConfirmation).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('reads absolute paths under trusted home tool directories without confirmation', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const homeRoot = path.join(tempRoot, 'home');
      const trustedFiles = [path.join(homeRoot, '.agents', 'skills', 'demo', 'SKILL.md'), path.join(homeRoot, '.tibis', 'runtime', 'config.md')];
      await fs.mkdir(workspaceRoot);
      await Promise.all(
        trustedFiles.map(async (trustedFile: string): Promise<void> => {
          await fs.mkdir(path.dirname(trustedFile), { recursive: true });
          await fs.writeFile(trustedFile, `trusted:${path.basename(trustedFile)}`, 'utf8');
        })
      );
      process.env.HOME = homeRoot;
      process.env.USERPROFILE = homeRoot;

      const requestConfirmation = vi.fn(async () => ({ approved: true }));
      const executeMainTool = createMainToolExecutor({
        now: () => '2026-06-19T00:00:00.000Z',
        async requestBridge() {
          return { status: 'failure', error: { code: 'EDITOR_UNAVAILABLE', message: 'no editor' } };
        },
        requestConfirmation
      });

      await Promise.all(
        trustedFiles.map(async (trustedFile: string): Promise<void> => {
          const realTrustedFile = await fs.realpath(trustedFile);
          const result = await executeMainTool({
            runtime: { ...runtime, workspaceRoot },
            toolCallId: `tool-call-trusted-${path.basename(trustedFile)}`,
            toolName: 'read_file',
            input: { path: trustedFile }
          });

          expect(result).toMatchObject({
            toolName: 'read_file',
            status: 'success',
            data: { path: realTrustedFile }
          });
        })
      );
      expect(requestConfirmation).not.toHaveBeenCalled();
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('confirms read_file trusted home symlinks that resolve outside trusted directories', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const homeRoot = path.join(tempRoot, 'home');
      const outsideRoot = path.join(tempRoot, 'outside');
      const outsideFile = path.join(outsideRoot, 'secret.md');
      const trustedSkillRoot = path.join(homeRoot, '.agents', 'skills', 'demo');
      const trustedSymlinkFile = path.join(trustedSkillRoot, 'linked-secret.md');
      await fs.mkdir(workspaceRoot);
      await fs.mkdir(outsideRoot);
      await fs.mkdir(trustedSkillRoot, { recursive: true });
      await fs.writeFile(outsideFile, 'outside secret', 'utf8');
      await fs.symlink(outsideFile, trustedSymlinkFile);
      process.env.HOME = homeRoot;
      process.env.USERPROFILE = homeRoot;

      const requestConfirmation = vi.fn(async () => ({ approved: true }));
      const executeMainTool = createMainToolExecutor({
        now: () => '2026-06-19T00:00:00.000Z',
        async requestBridge() {
          return { status: 'failure', error: { code: 'EDITOR_UNAVAILABLE', message: 'no editor' } };
        },
        requestConfirmation
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-trusted-symlink-read-1',
        toolName: 'read_file',
        input: { path: trustedSymlinkFile }
      });

      expect(result).toMatchObject({
        toolName: 'read_file',
        status: 'success',
        data: { content: 'outside secret' }
      });
      expect(requestConfirmation).toHaveBeenCalledTimes(1);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('blocks read_directory relative paths that escape the workspace', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      await fs.mkdir(workspaceRoot);
      await fs.mkdir(path.join(tempRoot, 'outside'));
      const requestConfirmation = vi.fn(async () => ({ approved: true }));
      const executeMainTool = createMainToolExecutor({
        now: () => '2026-06-19T00:00:00.000Z',
        async requestBridge() {
          return { status: 'failure', error: { code: 'EDITOR_UNAVAILABLE', message: 'no editor' } };
        },
        requestConfirmation
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-5',
        toolName: 'read_directory',
        input: { path: '../outside' }
      });

      expect(result).toMatchObject({
        toolName: 'read_directory',
        status: 'failure',
        error: { code: 'PERMISSION_DENIED' }
      });
      expect(requestConfirmation).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('executes glob as a main-process file search tool', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
      await fs.writeFile(path.join(workspaceRoot, 'src', 'alpha.ts'), 'alpha', 'utf8');
      await fs.writeFile(path.join(workspaceRoot, 'src', 'beta.tsx'), 'beta', 'utf8');
      await fs.writeFile(path.join(workspaceRoot, 'src', 'gamma.js'), 'gamma', 'utf8');
      await fs.mkdir(path.join(workspaceRoot, '.git'), { recursive: true });
      await fs.writeFile(path.join(workspaceRoot, '.git', 'hidden.ts'), 'hidden', 'utf8');
      const executeMainTool = createMainToolExecutor(createMainToolDependencies([]));

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-glob-1',
        toolName: 'glob',
        input: { pattern: '**/*.{ts,tsx}' }
      });

      expect(result.status).toBe('success');
      expect(result.toolName).toBe('glob');
      expect(result.data).toMatchObject({
        path: workspaceRoot,
        count: 2,
        truncated: false
      });
      expect((result.data as { files: string[] }).files.map((filePath) => path.relative(workspaceRoot, filePath)).sort()).toEqual([
        'src/alpha.ts',
        'src/beta.tsx'
      ]);
      expect(result.data).toEqual(expect.objectContaining({ elapsedMs: expect.any(Number) }));
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('executes grep as a main-process file search tool with include filtering', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
      await fs.writeFile(path.join(workspaceRoot, 'src', 'alpha.ts'), 'const target = 1;\n', 'utf8');
      await fs.writeFile(path.join(workspaceRoot, 'src', 'beta.md'), 'target in markdown\n', 'utf8');
      await fs.mkdir(path.join(workspaceRoot, '.git'), { recursive: true });
      await fs.writeFile(path.join(workspaceRoot, '.git', 'ignored.ts'), 'const target = 2;\n', 'utf8');
      const executeMainTool = createMainToolExecutor(createMainToolDependencies([]));

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-grep-1',
        toolName: 'grep',
        input: { pattern: 'target', include: '**/*.ts' }
      });

      expect(result.status).toBe('success');
      expect(result.toolName).toBe('grep');
      expect(result.data).toMatchObject({
        path: workspaceRoot,
        count: 1,
        truncated: false,
        matches: [
          {
            path: path.join(workspaceRoot, 'src', 'alpha.ts'),
            line: 1,
            text: 'const target = 1;'
          }
        ]
      });
      expect(result.data).toEqual(expect.objectContaining({ elapsedMs: expect.any(Number) }));
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('searches absolute paths under trusted home tool directories without confirmation', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const homeRoot = path.join(tempRoot, 'home');
      const tibisRuntimeRoot = path.join(homeRoot, '.tibis', 'runtime');
      await fs.mkdir(workspaceRoot);
      await fs.mkdir(tibisRuntimeRoot, { recursive: true });
      await fs.writeFile(path.join(tibisRuntimeRoot, 'settings.ts'), 'export const trusted = true;\n', 'utf8');
      const realTibisRuntimeRoot = await fs.realpath(tibisRuntimeRoot);
      process.env.HOME = homeRoot;
      process.env.USERPROFILE = homeRoot;

      const requestConfirmation = vi.fn(async () => ({ approved: true }));
      const executeMainTool = createMainToolExecutor({
        ...createMainToolDependencies([]),
        requestConfirmation
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-glob-trusted-1',
        toolName: 'glob',
        input: { pattern: '**/*.ts', path: tibisRuntimeRoot }
      });

      expect(result).toMatchObject({
        toolName: 'glob',
        status: 'success',
        data: { path: realTibisRuntimeRoot, count: 1 }
      });
      expect(requestConfirmation).not.toHaveBeenCalled();
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('confirms glob trusted home symlinks that resolve outside trusted directories', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const homeRoot = path.join(tempRoot, 'home');
      const outsideRoot = path.join(tempRoot, 'outside');
      const tibisRuntimeRoot = path.join(homeRoot, '.tibis', 'runtime');
      const trustedSymlinkDir = path.join(tibisRuntimeRoot, 'linked-outside');
      await fs.mkdir(workspaceRoot);
      await fs.mkdir(outsideRoot);
      await fs.mkdir(tibisRuntimeRoot, { recursive: true });
      await fs.writeFile(path.join(outsideRoot, 'outside.ts'), 'outside', 'utf8');
      await fs.symlink(outsideRoot, trustedSymlinkDir, 'dir');
      process.env.HOME = homeRoot;
      process.env.USERPROFILE = homeRoot;

      const requestConfirmation = vi.fn(async () => ({ approved: true }));
      const executeMainTool = createMainToolExecutor({
        ...createMainToolDependencies([]),
        requestConfirmation
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-glob-trusted-symlink-1',
        toolName: 'glob',
        input: { pattern: '**/*.ts', path: trustedSymlinkDir }
      });

      expect(result).toMatchObject({
        toolName: 'glob',
        status: 'success',
        data: { count: 1 }
      });
      expect(requestConfirmation).toHaveBeenCalledTimes(1);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('blocks glob relative paths that escape the workspace without confirmation', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      await fs.mkdir(workspaceRoot);
      await fs.mkdir(path.join(tempRoot, 'outside'));
      const requestConfirmation = vi.fn(async () => ({ approved: true }));
      const executeMainTool = createMainToolExecutor({
        ...createMainToolDependencies([]),
        requestConfirmation
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-glob-escape-1',
        toolName: 'glob',
        input: { pattern: '**/*.ts', path: '../outside' }
      });

      expect(result).toMatchObject({
        toolName: 'glob',
        status: 'failure',
        error: { code: 'PERMISSION_DENIED' }
      });
      expect(requestConfirmation).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('confirms glob absolute paths outside the workspace', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const outsideRoot = path.join(tempRoot, 'outside');
      await fs.mkdir(workspaceRoot);
      await fs.mkdir(outsideRoot);
      await fs.writeFile(path.join(outsideRoot, 'outside.ts'), 'outside', 'utf8');
      const requestConfirmation = vi.fn(async () => ({ approved: true }));
      const executeMainTool = createMainToolExecutor({
        ...createMainToolDependencies([]),
        requestConfirmation
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-glob-outside-1',
        toolName: 'glob',
        input: { pattern: '**/*.ts', path: outsideRoot }
      });

      expect(result).toMatchObject({
        toolName: 'glob',
        status: 'success',
        data: { path: outsideRoot, count: 1 }
      });
      expect(requestConfirmation).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('confirms glob workspace symlinks that resolve outside the workspace', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const outsideRoot = path.join(tempRoot, 'outside');
      await fs.mkdir(workspaceRoot);
      await fs.mkdir(outsideRoot);
      await fs.writeFile(path.join(outsideRoot, 'outside.ts'), 'outside', 'utf8');
      await fs.symlink(outsideRoot, path.join(workspaceRoot, 'link-outside'), 'dir');
      const realOutsideRoot = await fs.realpath(outsideRoot);
      const requestConfirmation = vi.fn(async () => ({ approved: true }));
      const executeMainTool = createMainToolExecutor({
        ...createMainToolDependencies([]),
        requestConfirmation
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-glob-symlink-1',
        toolName: 'glob',
        input: { pattern: '**/*.ts', path: 'link-outside' }
      });

      expect(result).toMatchObject({
        toolName: 'glob',
        status: 'success',
        data: { path: realOutsideRoot, count: 1 }
      });
      expect(requestConfirmation).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('confirms grep workspace symlinks that resolve outside and preserves pattern whitespace', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const outsideRoot = path.join(tempRoot, 'outside');
      const outsideFile = path.join(outsideRoot, 'secret.txt');
      await fs.mkdir(workspaceRoot);
      await fs.mkdir(outsideRoot);
      await fs.writeFile(outsideFile, ' secret\nsecret\n', 'utf8');
      await fs.symlink(outsideFile, path.join(workspaceRoot, 'secret-link.txt'));
      const realOutsideFile = await fs.realpath(outsideFile);
      const requestConfirmation = vi.fn(async () => ({ approved: true }));
      const executeMainTool = createMainToolExecutor({
        ...createMainToolDependencies([]),
        requestConfirmation
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-grep-symlink-1',
        toolName: 'grep',
        input: { pattern: ' secret', path: 'secret-link.txt' }
      });

      expect(result).toMatchObject({
        toolName: 'grep',
        status: 'success',
        data: {
          path: realOutsideFile,
          count: 1,
          matches: [
            {
              path: realOutsideFile,
              line: 1,
              text: ' secret'
            }
          ]
        }
      });
      expect(requestConfirmation).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('creates nested real files directly on disk without renderer bridge', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const targetPath = path.join(workspaceRoot, 'reports', 'daily.md');
      await fs.mkdir(workspaceRoot);
      const confirmationRequests: MainToolConfirmationRequest[] = [];
      const requestBridge = vi.fn(async () => ({ status: 'success' as const, data: { path: targetPath, content: '# Daily' } }));
      const executeMainTool = createMainToolExecutor({
        now: () => '2026-07-14T00:00:00.000Z',
        requestBridge,
        async requestConfirmation(input: MainToolConfirmationRequest): Promise<{ approved: true }> {
          confirmationRequests.push(input);
          return { approved: true };
        }
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-write-nested-1',
        toolName: 'write_file',
        input: { path: 'reports/daily.md', content: '# Daily' }
      });

      expect(result).toMatchObject({ toolName: 'write_file', status: 'success', data: { path: targetPath, created: true } });
      await expect(fs.readFile(targetPath, 'utf8')).resolves.toBe('# Daily');
      expect(confirmationRequests[0]?.request.description).toContain('父目录');
      expect(requestBridge).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('overwrites existing real files directly on disk without renderer bridge', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const targetPath = path.join(workspaceRoot, 'report.md');
      await fs.mkdir(workspaceRoot);
      await fs.writeFile(targetPath, 'old content', 'utf8');
      const requestBridge = vi.fn(async () => ({ status: 'success' as const, data: { path: targetPath, content: 'new content' } }));
      const executeMainTool = createMainToolExecutor({
        now: () => '2026-07-14T00:00:00.000Z',
        requestBridge,
        async requestConfirmation() {
          return { approved: true };
        }
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-write-existing-1',
        toolName: 'write_file',
        input: { path: 'report.md', content: 'new content' }
      });

      expect(result).toMatchObject({ toolName: 'write_file', status: 'success', data: { path: targetPath, created: false } });
      await expect(fs.readFile(targetPath, 'utf8')).resolves.toBe('new content');
      expect(requestBridge).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('edits existing real files from disk without renderer bridge', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const targetPath = path.join(workspaceRoot, 'report.md');
      await fs.mkdir(workspaceRoot);
      await fs.writeFile(targetPath, 'before value', 'utf8');
      const requestBridge = vi.fn(async () => ({ status: 'success' as const, data: { path: targetPath, content: 'before value' } }));
      const executeMainTool = createMainToolExecutor({
        now: () => '2026-07-14T00:00:00.000Z',
        requestBridge,
        async requestConfirmation() {
          return { approved: true };
        }
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-edit-existing-1',
        toolName: 'edit_file',
        input: { path: 'report.md', oldString: 'before', newString: 'after' }
      });

      expect(result).toMatchObject({ toolName: 'edit_file', status: 'success', data: { path: targetPath, content: 'after value', replacedCount: 1 } });
      await expect(fs.readFile(targetPath, 'utf8')).resolves.toBe('after value');
      expect(requestBridge).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('classifies an existing file symlink by its real write destination', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const outsideRoot = path.join(tempRoot, 'outside');
      const outsideFile = path.join(outsideRoot, 'report.md');
      const linkedFile = path.join(workspaceRoot, 'linked-report.md');
      await fs.mkdir(workspaceRoot);
      await fs.mkdir(outsideRoot);
      await fs.writeFile(outsideFile, 'before value', 'utf8');
      await fs.symlink(outsideFile, linkedFile);
      const realOutsideFile = await fs.realpath(outsideFile);
      const confirmationRequests: MainToolConfirmationRequest[] = [];
      const requestBridge = vi.fn(async (): Promise<{ status: 'success'; data: Record<string, unknown> }> => ({ status: 'success', data: {} }));
      const executeMainTool = createMainToolExecutor({
        now: (): string => '2026-07-14T00:00:00.000Z',
        requestBridge,
        async requestConfirmation(input: MainToolConfirmationRequest): Promise<{ approved: true }> {
          confirmationRequests.push(input);
          return { approved: true };
        }
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-edit-file-symlink-1',
        toolName: 'edit_file',
        input: { path: 'linked-report.md', oldString: 'before', newString: 'after' }
      });

      expect(result).toMatchObject({ toolName: 'edit_file', status: 'success', data: { path: realOutsideFile, content: 'after value' } });
      expect(confirmationRequests).toHaveLength(1);
      expect(confirmationRequests[0]?.request).toMatchObject({ riskLevel: 'dangerous' });
      expect(confirmationRequests[0]?.request.description).toContain(realOutsideFile);
      await expect(fs.readFile(outsideFile, 'utf8')).resolves.toBe('after value');
      const linkedFileStats = await fs.lstat(linkedFile);
      expect(linkedFileStats.isSymbolicLink()).toBe(true);
      expect(requestBridge).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('does not write the old destination when a file symlink is retargeted during confirmation', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const outsideRoot = path.join(tempRoot, 'outside');
      const firstOutsideFile = path.join(outsideRoot, 'first.md');
      const secondOutsideFile = path.join(outsideRoot, 'second.md');
      const linkedFile = path.join(workspaceRoot, 'linked-report.md');
      await fs.mkdir(workspaceRoot);
      await fs.mkdir(outsideRoot);
      await fs.writeFile(firstOutsideFile, 'before first', 'utf8');
      await fs.writeFile(secondOutsideFile, 'before second', 'utf8');
      await fs.symlink(firstOutsideFile, linkedFile);
      const requestBridge = vi.fn(async (): Promise<{ status: 'success'; data: Record<string, unknown> }> => ({ status: 'success', data: {} }));
      const executeMainTool = createMainToolExecutor({
        now: (): string => '2026-07-14T00:00:00.000Z',
        requestBridge,
        async requestConfirmation(): Promise<{ approved: true }> {
          await fs.unlink(linkedFile);
          await fs.symlink(secondOutsideFile, linkedFile);
          return { approved: true };
        }
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-edit-retargeted-symlink-1',
        toolName: 'edit_file',
        input: { path: 'linked-report.md', oldString: 'before', newString: 'after' }
      });

      expect(result).toMatchObject({ toolName: 'edit_file', status: 'failure', error: { code: 'STALE_CONTEXT' } });
      await expect(fs.readFile(firstOutsideFile, 'utf8')).resolves.toBe('before first');
      await expect(fs.readFile(secondOutsideFile, 'utf8')).resolves.toBe('before second');
      await expect(fs.realpath(linkedFile)).resolves.toBe(await fs.realpath(secondOutsideFile));
      expect(requestBridge).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('classifies a new file below a directory symlink by its real destination', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const outsideRoot = path.join(tempRoot, 'outside');
      const linkedRoot = path.join(workspaceRoot, 'linked-outside');
      await fs.mkdir(workspaceRoot);
      await fs.mkdir(outsideRoot);
      await fs.symlink(outsideRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
      const realOutsideRoot = await fs.realpath(outsideRoot);
      const realOutsideFile = path.join(realOutsideRoot, 'nested', 'report.md');
      const confirmationRequests: MainToolConfirmationRequest[] = [];
      const requestBridge = vi.fn(async (): Promise<{ status: 'success'; data: Record<string, unknown> }> => ({ status: 'success', data: {} }));
      const executeMainTool = createMainToolExecutor({
        now: (): string => '2026-07-14T00:00:00.000Z',
        requestBridge,
        async requestConfirmation(input: MainToolConfirmationRequest): Promise<{ approved: true }> {
          confirmationRequests.push(input);
          return { approved: true };
        }
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-write-directory-symlink-1',
        toolName: 'write_file',
        input: { path: 'linked-outside/nested/report.md', content: 'outside content' }
      });

      expect(result).toMatchObject({ toolName: 'write_file', status: 'success', data: { path: realOutsideFile, content: 'outside content', created: true } });
      expect(confirmationRequests).toHaveLength(1);
      expect(confirmationRequests[0]?.request).toMatchObject({ riskLevel: 'dangerous' });
      expect(confirmationRequests[0]?.request.description).toContain(realOutsideFile);
      await expect(fs.readFile(realOutsideFile, 'utf8')).resolves.toBe('outside content');
      expect(requestBridge).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('does not create missing real files through edit_file', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const targetPath = path.join(workspaceRoot, 'missing.md');
      await fs.mkdir(workspaceRoot);
      const requestBridge = vi.fn(async () => ({ status: 'success' as const, data: { path: targetPath, content: 'before value' } }));
      const executeMainTool = createMainToolExecutor({
        now: () => '2026-07-14T00:00:00.000Z',
        requestBridge,
        async requestConfirmation() {
          return { approved: true };
        }
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-edit-missing-1',
        toolName: 'edit_file',
        input: { path: 'missing.md', oldString: 'before', newString: 'after' }
      });

      expect(result).toMatchObject({ toolName: 'edit_file', status: 'failure', error: { code: 'EXECUTION_FAILED' } });
      await expect(fs.stat(targetPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(requestBridge).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('does not create parent directories when real write permission is denied', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const parentPath = path.join(workspaceRoot, 'reports');
      await fs.mkdir(workspaceRoot);
      const requestBridge = vi.fn(async () => ({ status: 'failure' as const, error: { code: 'EDITOR_UNAVAILABLE' as const, message: 'no editor' } }));
      const executeMainTool = createMainToolExecutor({
        now: () => '2026-07-14T00:00:00.000Z',
        requestBridge,
        async requestConfirmation() {
          return { approved: false };
        }
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-write-cancelled-1',
        toolName: 'write_file',
        input: { path: 'reports/daily.md', content: '# Daily' }
      });

      expect(result).toMatchObject({ toolName: 'write_file', status: 'failure', error: { code: 'USER_CANCELLED' } });
      await expect(fs.stat(parentPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(requestBridge).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('reports waiting and resumed activity while write_file waits for confirmation', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const targetPath = path.join(workspaceRoot, 'reports', 'daily.md');
      const activity: AIToolActivityReporter = {
        heartbeat: vi.fn(),
        progress: vi.fn(),
        waitUser: vi.fn(),
        waitExternal: vi.fn(),
        resume: vi.fn()
      };
      await fs.mkdir(workspaceRoot);
      const executeMainTool = createMainToolExecutor({
        ...createMainToolDependencies([]),
        async requestConfirmation(): Promise<{ approved: true }> {
          expect(activity.waitUser).toHaveBeenCalledOnce();
          return { approved: true };
        }
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-write-confirmed-1',
        toolName: 'write_file',
        input: { path: 'reports/daily.md', content: '# Daily' },
        signal: new AbortController().signal,
        activity
      });

      expect(result).toMatchObject({ toolName: 'write_file', status: 'success', data: { path: targetPath, created: true } });
      expect(activity.waitUser).toHaveBeenCalledOnce();
      expect(activity.resume).toHaveBeenCalledOnce();
      await expect(fs.readFile(targetPath, 'utf8')).resolves.toBe('# Daily');
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('keeps real file content unchanged when edit permission is denied', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const targetPath = path.join(workspaceRoot, 'report.md');
      await fs.mkdir(workspaceRoot);
      await fs.writeFile(targetPath, 'before value', 'utf8');
      const requestBridge = vi.fn(async () => ({ status: 'failure' as const, error: { code: 'EDITOR_UNAVAILABLE' as const, message: 'no editor' } }));
      const executeMainTool = createMainToolExecutor({
        now: () => '2026-07-14T00:00:00.000Z',
        requestBridge,
        async requestConfirmation() {
          return { approved: false };
        }
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-edit-cancelled-1',
        toolName: 'edit_file',
        input: { path: 'report.md', oldString: 'before', newString: 'after' }
      });

      expect(result).toMatchObject({ toolName: 'edit_file', status: 'failure', error: { code: 'USER_CANCELLED' } });
      await expect(fs.readFile(targetPath, 'utf8')).resolves.toBe('before value');
      expect(requestBridge).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('does not overwrite a file created while write confirmation is pending', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const targetPath = path.join(workspaceRoot, 'report.md');
      await fs.mkdir(workspaceRoot);
      const requestBridge = vi.fn(async (): Promise<{ status: 'success'; data: Record<string, unknown> }> => ({ status: 'success', data: {} }));
      const executeMainTool = createMainToolExecutor({
        now: (): string => '2026-07-14T00:00:00.000Z',
        requestBridge,
        async requestConfirmation(): Promise<{ approved: true }> {
          await fs.writeFile(targetPath, 'created elsewhere', 'utf8');
          return { approved: true };
        }
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-write-created-during-confirmation-1',
        toolName: 'write_file',
        input: { path: 'report.md', content: 'tool content' }
      });

      expect(result).toMatchObject({ toolName: 'write_file', status: 'failure', error: { code: 'STALE_CONTEXT' } });
      await expect(fs.readFile(targetPath, 'utf8')).resolves.toBe('created elsewhere');
      expect(requestBridge).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('does not follow a parent symlink created while write confirmation is pending', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const outsideRoot = path.join(tempRoot, 'outside');
      const linkedParent = path.join(workspaceRoot, 'pending');
      const outsideFile = path.join(outsideRoot, 'report.md');
      await fs.mkdir(workspaceRoot);
      await fs.mkdir(outsideRoot);
      const requestBridge = vi.fn(async (): Promise<{ status: 'success'; data: Record<string, unknown> }> => ({ status: 'success', data: {} }));
      const executeMainTool = createMainToolExecutor({
        now: (): string => '2026-07-14T00:00:00.000Z',
        requestBridge,
        async requestConfirmation(): Promise<{ approved: true }> {
          await fs.symlink(outsideRoot, linkedParent, process.platform === 'win32' ? 'junction' : 'dir');
          return { approved: true };
        }
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-write-parent-symlink-during-confirmation-1',
        toolName: 'write_file',
        input: { path: 'pending/report.md', content: 'tool content' }
      });

      expect(result).toMatchObject({ toolName: 'write_file', status: 'failure', error: { code: 'STALE_CONTEXT' } });
      await expect(fs.stat(outsideFile)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(requestBridge).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('does not replace a broken symlink created while write confirmation is pending', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const targetPath = path.join(workspaceRoot, 'report.md');
      const missingTarget = path.join(tempRoot, 'missing-target.md');
      await fs.mkdir(workspaceRoot);
      const requestBridge = vi.fn(async (): Promise<{ status: 'success'; data: Record<string, unknown> }> => ({ status: 'success', data: {} }));
      const executeMainTool = createMainToolExecutor({
        now: (): string => '2026-07-14T00:00:00.000Z',
        requestBridge,
        async requestConfirmation(): Promise<{ approved: true }> {
          await fs.symlink(missingTarget, targetPath);
          return { approved: true };
        }
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-write-broken-symlink-during-confirmation-1',
        toolName: 'write_file',
        input: { path: 'report.md', content: 'tool content' }
      });

      expect(result).toMatchObject({ toolName: 'write_file', status: 'failure', error: { code: 'STALE_CONTEXT' } });
      const targetStats = await fs.lstat(targetPath);
      expect(targetStats.isSymbolicLink()).toBe(true);
      await expect(fs.readlink(targetPath)).resolves.toBe(missingTarget);
      expect(requestBridge).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('does not overwrite a file modified while write confirmation is pending', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const targetPath = path.join(workspaceRoot, 'report.md');
      await fs.mkdir(workspaceRoot);
      await fs.writeFile(targetPath, 'confirmed content', 'utf8');
      const requestBridge = vi.fn(async (): Promise<{ status: 'success'; data: Record<string, unknown> }> => ({ status: 'success', data: {} }));
      const executeMainTool = createMainToolExecutor({
        now: (): string => '2026-07-14T00:00:00.000Z',
        requestBridge,
        async requestConfirmation(): Promise<{ approved: true }> {
          await fs.writeFile(targetPath, 'modified elsewhere', 'utf8');
          return { approved: true };
        }
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-write-modified-during-confirmation-1',
        toolName: 'write_file',
        input: { path: 'report.md', content: 'tool content' }
      });

      expect(result).toMatchObject({ toolName: 'write_file', status: 'failure', error: { code: 'STALE_CONTEXT' } });
      await expect(fs.readFile(targetPath, 'utf8')).resolves.toBe('modified elsewhere');
      expect(requestBridge).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('does not overwrite a file modified while edit confirmation is pending', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const targetPath = path.join(workspaceRoot, 'report.md');
      await fs.mkdir(workspaceRoot);
      await fs.writeFile(targetPath, 'before value', 'utf8');
      const requestBridge = vi.fn(async (): Promise<{ status: 'success'; data: Record<string, unknown> }> => ({ status: 'success', data: {} }));
      const executeMainTool = createMainToolExecutor({
        now: (): string => '2026-07-14T00:00:00.000Z',
        requestBridge,
        async requestConfirmation(): Promise<{ approved: true }> {
          await fs.writeFile(targetPath, 'modified elsewhere', 'utf8');
          return { approved: true };
        }
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-edit-modified-during-confirmation-1',
        toolName: 'edit_file',
        input: { path: 'report.md', oldString: 'before', newString: 'after' }
      });

      expect(result).toMatchObject({ toolName: 'edit_file', status: 'failure', error: { code: 'STALE_CONTEXT' } });
      await expect(fs.readFile(targetPath, 'utf8')).resolves.toBe('modified elsewhere');
      expect(requestBridge).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('does not recreate a file deleted while edit confirmation is pending', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const targetPath = path.join(workspaceRoot, 'report.md');
      await fs.mkdir(workspaceRoot);
      await fs.writeFile(targetPath, 'before value', 'utf8');
      const requestBridge = vi.fn(async (): Promise<{ status: 'success'; data: Record<string, unknown> }> => ({ status: 'success', data: {} }));
      const executeMainTool = createMainToolExecutor({
        now: (): string => '2026-07-14T00:00:00.000Z',
        requestBridge,
        async requestConfirmation(): Promise<{ approved: true }> {
          await fs.unlink(targetPath);
          return { approved: true };
        }
      });

      const result = await executeMainTool({
        runtime: { ...runtime, workspaceRoot },
        toolCallId: 'tool-call-edit-deleted-during-confirmation-1',
        toolName: 'edit_file',
        input: { path: 'report.md', oldString: 'before', newString: 'after' }
      });

      expect(result).toMatchObject({ toolName: 'edit_file', status: 'failure', error: { code: 'STALE_CONTEXT' } });
      await expect(fs.stat(targetPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(requestBridge).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('serializes concurrent edits before revalidating the confirmed file version', async (): Promise<void> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-runtime-tools-'));
    try {
      const workspaceRoot = path.join(tempRoot, 'workspace');
      const targetPath = path.join(workspaceRoot, 'report.md');
      await fs.mkdir(workspaceRoot);
      await fs.writeFile(targetPath, 'first second', 'utf8');
      let confirmationCount = 0;
      let releaseConfirmations = (): void => undefined;
      const confirmationsReady = new Promise<void>((resolve): void => {
        releaseConfirmations = (): void => resolve();
      });
      const requestBridge = vi.fn(async (): Promise<{ status: 'success'; data: Record<string, unknown> }> => ({ status: 'success', data: {} }));
      const executeMainTool = createMainToolExecutor({
        now: (): string => '2026-07-14T00:00:00.000Z',
        requestBridge,
        async requestConfirmation(): Promise<{ approved: true }> {
          confirmationCount += 1;
          if (confirmationCount === 2) releaseConfirmations();
          await confirmationsReady;
          return { approved: true };
        }
      });

      const results = await Promise.all([
        executeMainTool({
          runtime: { ...runtime, workspaceRoot },
          toolCallId: 'tool-call-edit-concurrent-first-1',
          toolName: 'edit_file',
          input: { path: 'report.md', oldString: 'first', newString: 'FIRST' }
        }),
        executeMainTool({
          runtime: { ...runtime, workspaceRoot },
          toolCallId: 'tool-call-edit-concurrent-second-1',
          toolName: 'edit_file',
          input: { path: 'report.md', oldString: 'second', newString: 'SECOND' }
        })
      ]);

      expect(results.map((result): string => result.status).sort()).toEqual(['failure', 'success']);
      expect(results.find((result): boolean => result.status === 'failure')).toMatchObject({ error: { code: 'STALE_CONTEXT' } });
      await expect(fs.readFile(targetPath, 'utf8')).resolves.toSatisfy((content: string): boolean => content === 'FIRST second' || content === 'first SECOND');
      expect(requestBridge).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('keeps write_file unsaved targets on the renderer bridge', async (): Promise<void> => {
    const bridgeRequests: MainToolBridgeRequest[] = [];
    const unsavedPath = 'unsaved://draft-1/note.md';
    const executeMainTool = createMainToolExecutor({
      now: () => '2026-07-14T00:00:00.000Z',
      async requestBridge(input: MainToolBridgeRequest) {
        bridgeRequests.push(input);
        return {
          status: 'success',
          data: {
            path: unsavedPath,
            content: input.kind === 'file-content-snapshot' ? 'draft before' : 'draft after'
          }
        };
      },
      async requestConfirmation() {
        return { approved: true };
      }
    });

    const result = await executeMainTool({
      runtime,
      toolCallId: 'tool-call-write-unsaved-1',
      toolName: 'write_file',
      input: { path: unsavedPath, content: 'draft after' }
    });

    expect(result).toMatchObject({ toolName: 'write_file', status: 'success', data: { path: unsavedPath, content: 'draft after', created: false } });
    expect(bridgeRequests.map((request): string => request.kind)).toEqual(['file-content-snapshot', 'write-file-content']);
    expect(bridgeRequests[1]).toEqual({
      runtimeId: 'runtime-1',
      toolCallId: 'tool-call-write-unsaved-1',
      kind: 'write-file-content',
      payload: { path: unsavedPath, content: 'draft after' }
    });
  });

  it('keeps edit_file unsaved targets on the renderer bridge', async (): Promise<void> => {
    const bridgeRequests: MainToolBridgeRequest[] = [];
    const unsavedPath = 'unsaved://draft-1/note.md';
    const executeMainTool = createMainToolExecutor({
      now: () => '2026-07-14T00:00:00.000Z',
      async requestBridge(input: MainToolBridgeRequest) {
        bridgeRequests.push(input);
        return {
          status: 'success',
          data: {
            path: unsavedPath,
            content: input.kind === 'file-content-snapshot' ? 'before value' : 'after value'
          }
        };
      },
      async requestConfirmation() {
        return { approved: true };
      }
    });

    const result = await executeMainTool({
      runtime,
      toolCallId: 'tool-call-edit-unsaved-1',
      toolName: 'edit_file',
      input: { path: unsavedPath, oldString: 'before', newString: 'after' }
    });

    expect(result).toMatchObject({ toolName: 'edit_file', status: 'success', data: { path: unsavedPath, content: 'after value', replacedCount: 1 } });
    expect(bridgeRequests.map((request): string => request.kind)).toEqual(['file-content-snapshot', 'write-file-content']);
    expect(bridgeRequests[1]).toEqual({
      runtimeId: 'runtime-1',
      toolCallId: 'tool-call-edit-unsaved-1',
      kind: 'write-file-content',
      payload: { path: unsavedPath, content: 'after value' }
    });
  });

  it('keeps no-workspace relative writes as unsaved drafts', async (): Promise<void> => {
    const bridgeRequests: MainToolBridgeRequest[] = [];
    const unsavedPath = 'unsaved://draft-1/note.md';
    const executeMainTool = createMainToolExecutor({
      now: () => '2026-07-14T00:00:00.000Z',
      async requestBridge(input: MainToolBridgeRequest) {
        bridgeRequests.push(input);
        return {
          status: 'success',
          data: {
            file: { type: 'file', id: 'draft-1', path: null, name: 'note', ext: 'md', content: '# Note' },
            unsavedPath
          }
        };
      },
      async requestConfirmation() {
        return { approved: true };
      }
    });

    const result = await executeMainTool({
      runtime,
      toolCallId: 'tool-call-write-draft-1',
      toolName: 'write_file',
      input: { path: 'note.md', content: '# Note' }
    });

    expect(result).toMatchObject({ toolName: 'write_file', status: 'success', data: { path: unsavedPath, content: '# Note', created: true } });
    expect(bridgeRequests.map((request): string => request.kind)).toEqual(['open-draft']);
  });

  it('blocks open_resource relative file paths that escape the workspace before bridge dispatch', async (): Promise<void> => {
    const bridgeRequests: MainToolBridgeRequest[] = [];
    const requestConfirmation = vi.fn(async () => ({ approved: true }));
    const executeMainTool = createMainToolExecutor({
      now: () => '2026-06-19T00:00:00.000Z',
      async requestBridge(input: MainToolBridgeRequest) {
        bridgeRequests.push(input);
        return { status: 'success', data: { path: input.payload, resourceType: 'file', opened: true } };
      },
      requestConfirmation
    });

    const result = await executeMainTool({
      runtime: { ...runtime, workspaceRoot: '/workspace' },
      toolCallId: 'tool-call-6',
      toolName: 'open_resource',
      input: { path: '../outside.txt' }
    });

    expect(result).toMatchObject({
      toolName: 'open_resource',
      status: 'failure',
      error: { code: 'PERMISSION_DENIED' }
    });
    expect(bridgeRequests).toEqual([]);
    expect(requestConfirmation).not.toHaveBeenCalled();
  });
});
