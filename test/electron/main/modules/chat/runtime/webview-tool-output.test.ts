/**
 * @file webview-tool-output.test.ts
 * @description WebView 工具历史语义投影测试。
 */
import type { AIToolExecutionResult } from 'types/ai';
import type { ChatMessagePart, ChatMessageRecord, ChatMessageToolPart } from 'types/chat';
import { describe, expect, it } from 'vitest';
import { toRuntimeModelMessages } from '../../../../../../electron/main/modules/chat/runtime/context/model-message.mjs';
import { projectHistoricalWebviewPart, projectWebviewToolOutputs } from '../../../../../../electron/main/modules/chat/runtime/context/webview-tool-output.mjs';

/**
 * 创建投影测试消息。
 * @param id - 消息 ID
 * @param role - 消息角色
 * @param parts - 消息 Part
 * @returns 完整消息
 */
function createMessage(id: string, role: 'user' | 'assistant', parts: ChatMessagePart[]): ChatMessageRecord {
  return {
    id,
    sessionId: 'session-1',
    role,
    content: '',
    parts,
    createdAt: '2026-08-03T00:00:00.000Z',
    finished: true
  };
}

/**
 * 创建成功网页读取 Part。
 * @param id - Part ID
 * @param snapshotId - 快照 ID
 * @returns 网页读取 Part
 */
function createReadPart(id: string, snapshotId: string): ChatMessageToolPart {
  return {
    id,
    type: 'tool',
    toolCallId: `call-${id}`,
    toolName: 'read_current_webpage',
    status: 'done',
    input: {},
    result: {
      toolName: 'read_current_webpage',
      status: 'success',
      data: {
        url: 'https://example.com',
        title: 'Example',
        summary: 'DOM_SENTINEL',
        header: 'HEADER_SENTINEL',
        content: 'DOM_SENTINEL',
        footer: 'FOOTER_SENTINEL',
        text: 'TEXT_SENTINEL',
        selectedText: 'SELECTED_SENTINEL',
        headings: [{ text: 'Heading' }],
        links: [{ text: 'Link' }],
        elements: [{ index: 2 }],
        viewport: { width: 800 },
        selectedElement: { index: 2 },
        scroll: { y: 0 },
        truncated: { content: false },
        capturedAt: 1,
        snapshotId,
        unknownField: 'UNKNOWN_SENTINEL'
      }
    }
  };
}

/**
 * 创建网页操作 Part。
 * @param id - Part ID
 * @param snapshotId - 快照 ID
 * @param result - 操作结果
 * @returns 网页操作 Part
 */
function createOperatePart(id: string, snapshotId: string, result: AIToolExecutionResult): ChatMessageToolPart {
  return {
    id,
    type: 'tool',
    toolCallId: `call-${id}`,
    toolName: 'operate_webpage',
    status: 'done',
    input: {
      snapshotId,
      step: { evaluation: '', memory: '价格为 ¥820', nextGoal: '继续比较' },
      action: { type: 'click', index: 2 }
    },
    result
  };
}

/**
 * 查找指定工具 Part 的成功数据。
 * @param messages - 投影消息
 * @param id - Part ID
 * @returns 成功结果数据
 */
function readData(messages: ChatMessageRecord[], id: string): unknown {
  const part = messages.flatMap((message) => message.parts).find((candidate) => candidate.id === id);
  return part?.type === 'tool' && part.result?.status === 'success' ? part.result.data : undefined;
}

describe('WebView tool output projection', (): void => {
  it('keeps only the current successful read after the latest user message', (): void => {
    const success: AIToolExecutionResult = { toolName: 'operate_webpage', status: 'success', data: { ok: true } };
    const messages = [
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '比较价格' }]),
      createMessage('assistant-1', 'assistant', [
        createReadPart('read-1', 'snapshot-1'),
        createOperatePart('operate-1', 'snapshot-1', success),
        createReadPart('read-2', 'snapshot-2')
      ])
    ];
    const original = structuredClone(messages);

    const projected = projectWebviewToolOutputs(messages);

    expect(messages).toEqual(original);
    expect(readData(projected, 'read-1')).toMatchObject({ pruned: true, pruneReason: 'historical_webview_snapshot' });
    expect(readData(projected, 'read-2')).toMatchObject({ snapshotId: 'snapshot-2', content: 'DOM_SENTINEL' });
  });

  it('keeps only one current read when corrupted history reuses a part id', (): void => {
    const firstRead = createReadPart('duplicate-read', 'snapshot-1');
    const latestRead = createReadPart('duplicate-read', 'snapshot-2');
    const messages = [
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '继续' }]),
      createMessage('assistant-1', 'assistant', [
        firstRead,
        createOperatePart('operate-1', 'snapshot-1', { toolName: 'operate_webpage', status: 'success', data: { ok: true } }),
        latestRead
      ])
    ];

    const projected = projectWebviewToolOutputs(messages);
    const fullReads = projected
      .flatMap((message) => message.parts)
      .filter(
        (part): boolean =>
          part.type === 'tool' &&
          part.toolName === 'read_current_webpage' &&
          part.result?.status === 'success' &&
          !(part.result.data as { pruned?: boolean }).pruned
      );

    expect(fullReads).toHaveLength(1);
    expect(fullReads[0]).toMatchObject({ result: { data: { snapshotId: 'snapshot-2' } } });
  });

  it('normalizes the current read result tool name without pruning its snapshot', (): void => {
    const readPart = createReadPart('read-1', 'snapshot-1');
    if (!readPart.result) throw new Error('Expected a read result fixture');
    readPart.result.toolName = '<div>CURRENT_RESULT_TOOL_DOM_SENTINEL</div>';
    const messages = [
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '继续' }]),
      createMessage('assistant-1', 'assistant', [readPart])
    ];

    const projected = projectWebviewToolOutputs(messages);

    expect(JSON.stringify(projected)).not.toContain('CURRENT_RESULT_TOOL_DOM_SENTINEL');
    expect(readData(projected, 'read-1')).toMatchObject({ snapshotId: 'snapshot-1', content: 'DOM_SENTINEL' });
    expect(projected[1].parts[0]).toMatchObject({ result: { toolName: 'read_current_webpage' } });
  });

  it('does not keep a successful read without a usable snapshot id as current', (): void => {
    const readPart = createReadPart('read-1', 'snapshot-1');
    if (readPart.result?.status !== 'success') throw new Error('Expected a successful read fixture');
    const data = readPart.result.data as Record<string, unknown>;
    delete data.snapshotId;
    const messages = [
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '继续' }]),
      createMessage('assistant-1', 'assistant', [readPart])
    ];

    expect(readData(projectWebviewToolOutputs(messages), 'read-1')).toMatchObject({
      pruned: true,
      pruneReason: 'historical_webview_snapshot'
    });
  });

  it('does not keep an oversized snapshot id as current', (): void => {
    const readPart = createReadPart('read-1', `webview-snapshot-${'x'.repeat(300)}`);
    const messages = [
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '继续' }]),
      createMessage('assistant-1', 'assistant', [readPart])
    ];

    expect(readData(projectWebviewToolOutputs(messages), 'read-1')).toMatchObject({
      pruned: true,
      pruneReason: 'historical_webview_snapshot'
    });
  });

  it('does not keep a structurally incomplete snapshot as current', (): void => {
    const readPart = createReadPart('read-1', 'snapshot-1');
    if (readPart.result?.status !== 'success') throw new Error('Expected a successful read fixture');
    readPart.result.data = { snapshotId: 'snapshot-1', content: 'INCOMPLETE_DOM_SENTINEL' };
    const messages = [
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '继续' }]),
      createMessage('assistant-1', 'assistant', [readPart])
    ];

    const projected = projectWebviewToolOutputs(messages);

    expect(readData(projected, 'read-1')).toMatchObject({ pruned: true, pruneReason: 'historical_webview_snapshot' });
    expect(JSON.stringify(projected)).not.toContain('INCOMPLETE_DOM_SENTINEL');
  });

  const terminalResults: AIToolExecutionResult[] = [
    { toolName: 'operate_webpage', status: 'success', data: { ok: true } },
    { toolName: 'operate_webpage', status: 'failure', error: { code: 'USER_CANCELLED', message: 'denied' } },
    { toolName: 'operate_webpage', status: 'failure', error: { code: 'EXECUTION_FAILED', message: 'failed' } },
    { toolName: 'operate_webpage', status: 'cancelled', error: { code: 'USER_CANCELLED', message: 'cancelled' } }
  ];

  it.each(terminalResults)('consumes a read after a terminal operate result', (result: AIToolExecutionResult): void => {
    const messages = [
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '继续' }]),
      createMessage('assistant-1', 'assistant', [createReadPart('read-1', 'snapshot-1'), createOperatePart('operate-1', 'snapshot-1', result)])
    ];

    expect(readData(projectWebviewToolOutputs(messages), 'read-1')).toMatchObject({ pruned: true });
  });

  it('keeps the current read while an operate call awaits user input', (): void => {
    const messages = [
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '继续' }]),
      createMessage('assistant-1', 'assistant', [
        createReadPart('read-1', 'snapshot-1'),
        createOperatePart('operate-1', 'snapshot-1', {
          toolName: 'operate_webpage',
          status: 'awaiting_user_input',
          data: {
            questionId: 'question-1',
            toolCallId: 'call-operate-1',
            mode: 'single',
            question: '是否继续？',
            options: [{ label: '继续', value: 'yes' }]
          }
        })
      ])
    ];

    expect(readData(projectWebviewToolOutputs(messages), 'read-1')).toMatchObject({ content: 'DOM_SENTINEL' });
  });

  it('does not consume the current read after a non-WebView tool', (): void => {
    const readFilePart: ChatMessageToolPart = {
      id: 'read-file',
      type: 'tool',
      toolCallId: 'call-read-file',
      toolName: 'read_file',
      status: 'done',
      input: { path: 'README.md' },
      result: { toolName: 'read_file', status: 'success', data: { content: 'file' } }
    };
    const messages = [
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '继续' }]),
      createMessage('assistant-1', 'assistant', [createReadPart('read-1', 'snapshot-1'), readFilePart])
    ];

    expect(readData(projectWebviewToolOutputs(messages), 'read-1')).toMatchObject({ content: 'DOM_SENTINEL' });
  });

  it('prunes all reads before the latest user message', (): void => {
    const messages = [
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '第一轮' }]),
      createMessage('assistant-1', 'assistant', [createReadPart('read-1', 'snapshot-1')]),
      createMessage('user-2', 'user', [{ id: 'user-part-2', type: 'text', text: '第二轮' }])
    ];

    expect(readData(projectWebviewToolOutputs(messages), 'read-1')).toMatchObject({ pruned: true });
  });

  it('does not keep a full read when no user baseline exists', (): void => {
    const messages = [createMessage('assistant-1', 'assistant', [createReadPart('read-1', 'snapshot-1')])];

    expect(readData(projectWebviewToolOutputs(messages), 'read-1')).toMatchObject({ pruned: true });
  });

  it('does not consume the current read for an unfinished operate part', (): void => {
    const executingOperate: ChatMessageToolPart = {
      id: 'operate-executing',
      type: 'tool',
      toolCallId: 'call-operate-executing',
      toolName: 'operate_webpage',
      status: 'executing',
      input: {
        snapshotId: 'snapshot-1',
        step: { evaluation: '', memory: '', nextGoal: '点击按钮' },
        action: { type: 'click', index: 2 }
      }
    };
    const messages = [
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '继续' }]),
      createMessage('assistant-1', 'assistant', [createReadPart('read-1', 'snapshot-1'), executingOperate])
    ];

    expect(readData(projectWebviewToolOutputs(messages), 'read-1')).toMatchObject({ content: 'DOM_SENTINEL' });
  });

  it('consumes the current read for a done operate part with a missing result', (): void => {
    const doneOperate: ChatMessageToolPart = {
      id: 'operate-done-without-result',
      type: 'tool',
      toolCallId: 'call-operate-done-without-result',
      toolName: 'operate_webpage',
      status: 'done',
      input: {
        snapshotId: 'snapshot-1',
        step: { evaluation: '', memory: '', nextGoal: '点击按钮' },
        action: { type: 'click', index: 2 }
      }
    };
    const messages = [
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '继续' }]),
      createMessage('assistant-1', 'assistant', [createReadPart('read-1', 'snapshot-1'), doneOperate])
    ];

    expect(readData(projectWebviewToolOutputs(messages), 'read-1')).toMatchObject({ pruned: true });
  });

  it('clears an older observation for a done read part with a missing result', (): void => {
    const doneRead: ChatMessageToolPart = {
      id: 'read-done-without-result',
      type: 'tool',
      toolCallId: 'call-read-done-without-result',
      toolName: 'read_current_webpage',
      status: 'done',
      input: {}
    };
    const messages = [
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '继续' }]),
      createMessage('assistant-1', 'assistant', [createReadPart('read-1', 'snapshot-1'), doneRead])
    ];

    expect(readData(projectWebviewToolOutputs(messages), 'read-1')).toMatchObject({ pruned: true });
  });

  it('preserves WebView tool pairing in final model messages without historical DOM', (): void => {
    const messages = [
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '读取网页' }]),
      createMessage('assistant-1', 'assistant', [createReadPart('read-1', 'webview-snapshot-SNAPSHOT_SENTINEL')]),
      createMessage('user-2', 'user', [{ id: 'user-part-2', type: 'text', text: '继续' }])
    ];

    const modelMessages = toRuntimeModelMessages(projectWebviewToolOutputs(messages));
    const serialized = JSON.stringify(modelMessages);

    expect(serialized).not.toContain('DOM_SENTINEL');
    expect(serialized).not.toContain('SNAPSHOT_SENTINEL');
    expect(serialized).toContain('call-read-1');
    expect(serialized).toContain('historical_webview_snapshot');
    expect(modelMessages.some((message) => message.role === 'assistant')).toBe(true);
    expect(modelMessages.some((message) => message.role === 'tool')).toBe(true);
  });

  it('keeps a failed read error but does not restore an older observation', (): void => {
    const failedRead: ChatMessageToolPart = {
      ...createReadPart('read-failed', 'snapshot-failed'),
      result: {
        toolName: 'read_current_webpage',
        status: 'failure',
        error: {
          code: 'BRIDGE_TIMEOUT',
          message: 'timeout [7] <div>READ_ERROR_DOM_SENTINEL</div>',
          details: { snapshotId: 'webview-snapshot-READ_ERROR_SNAPSHOT_SENTINEL' }
        }
      }
    };
    const messages = [
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '继续' }]),
      createMessage('assistant-1', 'assistant', [createReadPart('read-1', 'snapshot-1'), failedRead])
    ];
    const projected = projectWebviewToolOutputs(messages);
    const projectedFailure = projected[1].parts[1];

    expect(readData(projected, 'read-1')).toMatchObject({ pruned: true });
    expect(projectedFailure).toMatchObject({
      type: 'tool',
      result: { status: 'failure', error: { code: 'BRIDGE_TIMEOUT', message: 'timeout READ_ERROR_DOM_SENTINEL' } }
    });
    expect(JSON.stringify(projectedFailure)).not.toContain('READ_ERROR_SNAPSHOT_SENTINEL');
    expect(JSON.stringify(projectedFailure)).not.toContain('<div>');
    expect(JSON.stringify(projectedFailure)).not.toContain('[7]');
  });

  it('removes raw snapshot fields from a historical read', (): void => {
    const projected = projectHistoricalWebviewPart(createReadPart('read-1', 'snapshot-1'));
    const serialized = JSON.stringify(projected);

    expect(projected).toMatchObject({
      type: 'tool',
      result: {
        data: {
          url: 'https://example.com',
          title: 'Example',
          capturedAt: 1,
          pruned: true,
          pruneReason: 'historical_webview_snapshot'
        }
      }
    });
    expect(serialized).not.toContain('DOM_SENTINEL');
    expect(serialized).not.toContain('snapshot-1');
    expect(serialized).not.toContain('UNKNOWN_SENTINEL');
  });

  it('removes handles, snapshot tokens, DOM lines, and unknown fields from historical operate memory', (): void => {
    const part = createOperatePart('operate-1', 'webview-snapshot-SNAPSHOT_SENTINEL', {
      toolName: 'operate_webpage',
      status: 'success',
      data: { ok: true }
    });
    part.input = {
      snapshotId: 'webview-snapshot-SNAPSHOT_SENTINEL',
      step: {
        evaluation: '[2] 已出现',
        memory: '[2]<button>购买</button>\n最低价 ¥820',
        nextGoal: '点击 *[3]'
      },
      action: {
        type: 'click',
        index: 3,
        rawDom: 'ACTION_DOM_SENTINEL',
        snapshotId: 'webview-snapshot-ACTION_SNAPSHOT_SENTINEL'
      },
      unknownField: 'UNKNOWN_SENTINEL'
    };
    part.inputText = '{"rawDom":"INPUT_TEXT_DOM_SENTINEL","snapshotId":"webview-snapshot-INPUT_TEXT_SENTINEL"}';
    part.providerMetadata = {
      rawRequest: '<button>PROVIDER_DOM_SENTINEL</button>',
      snapshotId: 'webview-snapshot-PROVIDER_SNAPSHOT_SENTINEL'
    };

    const projected = projectHistoricalWebviewPart(part);
    const serialized = JSON.stringify(projected);

    expect(serialized).not.toContain('SNAPSHOT_SENTINEL');
    expect(serialized).not.toContain('<button>');
    expect(serialized).not.toContain('[2]');
    expect(serialized).not.toContain('UNKNOWN_SENTINEL');
    expect(serialized).not.toContain('ACTION_DOM_SENTINEL');
    expect(serialized).not.toContain('ACTION_SNAPSHOT_SENTINEL');
    expect(serialized).not.toContain('INPUT_TEXT_DOM_SENTINEL');
    expect(serialized).not.toContain('INPUT_TEXT_SENTINEL');
    expect(serialized).not.toContain('PROVIDER_DOM_SENTINEL');
    expect(serialized).not.toContain('PROVIDER_SNAPSHOT_SENTINEL');
    expect(projected).toMatchObject({
      type: 'tool',
      input: {
        step: { evaluation: '已出现', memory: '最低价 ¥820', nextGoal: '点击' },
        action: { type: 'click', index: 3 }
      }
    });
  });

  it('sanitizes unfinished operate inputs defensively', (): void => {
    const part = createOperatePart('operate-executing', 'webview-snapshot-EXECUTING_SNAPSHOT_SENTINEL', {
      toolName: 'operate_webpage',
      status: 'success',
      data: { ok: true }
    });
    part.status = 'executing';
    delete part.result;
    part.input = {
      snapshotId: 'webview-snapshot-EXECUTING_SNAPSHOT_SENTINEL',
      step: {
        evaluation: '[4]<button>EXECUTING_DOM_SENTINEL</button>',
        memory: '稳定事实：已登录',
        nextGoal: '继续等待'
      },
      action: { type: 'wait', seconds: 1 }
    };

    const projected = projectWebviewToolOutputs([
      createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '继续' }]),
      createMessage('assistant-1', 'assistant', [part])
    ]);
    const serialized = JSON.stringify(projected);

    expect(serialized).not.toContain('EXECUTING_SNAPSHOT_SENTINEL');
    expect(serialized).not.toContain('EXECUTING_DOM_SENTINEL');
    expect(projected[1].parts[0]).toMatchObject({
      type: 'tool',
      status: 'executing',
      input: {
        step: { evaluation: '', memory: '稳定事实：已登录', nextGoal: '继续等待' },
        action: { type: 'wait', seconds: 1 }
      }
    });
  });

  it('drops unknown fields from persisted historical operate results', (): void => {
    const part = createOperatePart('operate-1', 'snapshot-1', {
      toolName: '<div>RESULT_TOOL_NAME_DOM_SENTINEL</div>',
      status: 'success',
      data: {
        ok: true,
        action: 'click',
        target: { index: 2, label: 'Search', tagName: 'BUTTON', rawDom: 'OLD_TARGET_DOM_SENTINEL' },
        message: 'executed',
        navigationStarted: false,
        pageChanged: true,
        shouldReadAgain: true,
        rawDom: 'OLD_RESULT_DOM_SENTINEL'
      }
    });

    const projected = projectHistoricalWebviewPart(part);
    const serialized = JSON.stringify(projected);

    expect(serialized).not.toContain('OLD_TARGET_DOM_SENTINEL');
    expect(serialized).not.toContain('OLD_RESULT_DOM_SENTINEL');
    expect(serialized).not.toContain('RESULT_TOOL_NAME_DOM_SENTINEL');
    expect(projected).toMatchObject({
      type: 'tool',
      result: {
        toolName: 'operate_webpage',
        data: {
          ok: true,
          action: 'click',
          target: { index: 2, label: 'Search', tagName: 'BUTTON' },
          message: 'executed'
        }
      }
    });
  });

  it('removes transient references from allowed operate result strings', (): void => {
    const part = createOperatePart('operate-1', 'snapshot-1', {
      toolName: 'operate_webpage',
      status: 'success',
      data: {
        ok: true,
        action: '<button>RESULT_ACTION_DOM_SENTINEL</button>',
        target: {
          index: 2,
          label: '<strong>购买</strong> [2] webview-snapshot-RESULT_TARGET_SENTINEL',
          tagName: '<BUTTON>RESULT_TAG_DOM_SENTINEL</BUTTON>'
        },
        message: '<div>RESULT_MESSAGE_DOM_SENTINEL</div> [2] webview-snapshot-RESULT_MESSAGE_SENTINEL',
        navigationStarted: false,
        pageChanged: true,
        shouldReadAgain: true
      }
    });

    const projected = projectHistoricalWebviewPart(part);
    const serialized = JSON.stringify(projected);

    expect(serialized).not.toContain('<strong>');
    expect(serialized).not.toContain('<BUTTON>');
    expect(serialized).not.toContain('<div>');
    expect(serialized).not.toContain('[2]');
    expect(serialized).not.toContain('RESULT_TARGET_SENTINEL');
    expect(serialized).not.toContain('RESULT_MESSAGE_SENTINEL');
    expect(serialized).not.toContain('RESULT_ACTION_DOM_SENTINEL');
    expect(projected).toMatchObject({
      type: 'tool',
      result: {
        data: {
          ok: true,
          target: { index: 2, label: '购买', tagName: 'RESULT_TAG_DOM_SENTINEL' },
          message: 'RESULT_MESSAGE_DOM_SENTINEL'
        }
      }
    });
  });

  it('drops transient details from persisted operate failures', (): void => {
    const part = createOperatePart('operate-1', 'snapshot-1', {
      toolName: 'operate_webpage',
      status: 'failure',
      error: {
        code: 'ELEMENT_NOT_FOUND',
        message: '无法操作 [2] <button>购买</button> webview-snapshot-ERROR_SENTINEL',
        details: {
          rawDom: '<button data-index="2">ERROR_DOM_SENTINEL</button>',
          snapshotId: 'webview-snapshot-ERROR_DETAILS_SENTINEL'
        }
      }
    });

    const projected = projectHistoricalWebviewPart(part);
    const serialized = JSON.stringify(projected);

    expect(serialized).not.toContain('ERROR_DOM_SENTINEL');
    expect(serialized).not.toContain('ERROR_DETAILS_SENTINEL');
    expect(serialized).not.toContain('ERROR_SENTINEL');
    expect(serialized).not.toContain('<button>');
    expect(serialized).not.toContain('[2]');
    expect(projected).toMatchObject({
      type: 'tool',
      result: {
        status: 'failure',
        error: { code: 'ELEMENT_NOT_FOUND', message: '无法操作 购买' }
      }
    });
  });

  it('normalizes malformed step memory and reapplies length limits', (): void => {
    const part = createOperatePart('operate-1', 'snapshot-1', {
      toolName: 'operate_webpage',
      status: 'success',
      data: { ok: true }
    });
    part.input = {
      step: { evaluation: 'e'.repeat(600), memory: 'm'.repeat(1_300), nextGoal: 42 },
      action: { type: 'wait' }
    };

    const projected = projectHistoricalWebviewPart(part);
    if (projected.type !== 'tool') throw new Error('Expected a tool part');
    const input = projected.input as { step: { evaluation: string; memory: string; nextGoal: string } };

    expect(input.step.evaluation).toHaveLength(500);
    expect(input.step.memory).toHaveLength(1_200);
    expect(input.step.nextGoal).toBe('');
  });

  it('removes alternate DOM, snapshot assignment, and selector forms from step memory', (): void => {
    const part = createOperatePart('operate-1', 'snapshot-1', {
      toolName: 'operate_webpage',
      status: 'success',
      data: { ok: true }
    });
    part.input = {
      step: {
        evaluation: '> [12]<button class="buy">DOM_LINE_SENTINEL</button>',
        memory: [
          '稳定事实：最低价 ¥820',
          '<div data-kind="card">RAW_HTML_TEXT</div>',
          `<section data-long="${'x'.repeat(700)}">LONG_HTML_TEXT</section>`,
          '&lt;span&gt;ENCODED_HTML_TEXT&lt;/span&gt;',
          'snapshotId = "legacy-snapshot-42"',
          'CSS selector: .card > button'
        ].join('\n'),
        nextGoal: '继续比较'
      },
      action: { type: 'wait' }
    };

    const projected = projectHistoricalWebviewPart(part);
    const serialized = JSON.stringify(projected);

    expect(serialized).not.toContain('DOM_LINE_SENTINEL');
    expect(serialized).not.toContain('<div');
    expect(serialized).not.toContain('<section');
    expect(serialized).not.toContain('&lt;span');
    expect(serialized).not.toContain('snapshotId');
    expect(serialized).not.toContain('legacy-snapshot-42');
    expect(serialized).not.toContain('CSS selector');
    expect(serialized).not.toContain('[12]');
    expect(serialized).toContain('稳定事实：最低价 ¥820');
  });

  it('bounds historical action strings and drops non-finite numbers', (): void => {
    const part = createOperatePart('operate-1', 'snapshot-1', {
      toolName: 'operate_webpage',
      status: 'success',
      data: { ok: true }
    });
    part.input = {
      step: { evaluation: '', memory: '', nextGoal: '' },
      action: { type: 'input', index: Number.POSITIVE_INFINITY, text: 'x'.repeat(5_000), clear: true }
    };

    const projected = projectHistoricalWebviewPart(part);
    if (projected.type !== 'tool') throw new Error('Expected a tool part');
    const input = projected.input as { action: { index?: number; text: string; clear: boolean } };

    expect(input.action.index).toBeUndefined();
    expect(input.action.text).toHaveLength(4_000);
    expect(input.action.clear).toBe(true);
  });

  it('reapplies action enums and numeric ranges to historical data', (): void => {
    const part = createOperatePart('operate-1', 'snapshot-1', {
      toolName: 'operate_webpage',
      status: 'success',
      data: { ok: true }
    });
    part.input = {
      step: { evaluation: '', memory: '', nextGoal: '' },
      action: { type: 'scroll', index: 2, direction: 'INVALID_DIRECTION_SENTINEL', pixels: 50_000 }
    };

    const projected = projectHistoricalWebviewPart(part);
    if (projected.type !== 'tool') throw new Error('Expected a tool part');
    const input = projected.input as { action: { index?: number; direction?: string; pixels?: number } };

    expect(input.action.index).toBe(2);
    expect(input.action.direction).toBeUndefined();
    expect(input.action.pixels).toBeUndefined();
    expect(JSON.stringify(projected)).not.toContain('INVALID_DIRECTION_SENTINEL');
  });
});
