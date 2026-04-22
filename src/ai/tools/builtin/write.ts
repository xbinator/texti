/**
 * @file write.ts
 * @description 内置写入工具实现
 */
import type { AIToolConfirmationAdapter, AIToolConfirmationRequest } from '../confirmation';
import type { AIToolContext, AIToolExecutor } from 'types/ai';
import { createToolCancelledResult, createToolFailureResult, createToolSuccessResult } from '../results';

/**
 * 工具内容输入参数
 */
export interface ToolContentInput {
  /** 要写入的内容 */
  content: string;
}

/**
 * 写入工具应用结果
 */
export interface WriteToolAppliedResult {
  /** 是否已应用 */
  applied: true;
}

/**
 * 内置写入工具集合
 */
export interface BuiltinWriteTools {
  /** 在光标位置插入内容工具 */
  insertAtCursor: AIToolExecutor<ToolContentInput, WriteToolAppliedResult>;
  /** 替换选区内容工具 */
  replaceSelection: AIToolExecutor<ToolContentInput, WriteToolAppliedResult>;
  /** 替换整个文档工具 */
  replaceDocument: AIToolExecutor<ToolContentInput, WriteToolAppliedResult>;
}

/**
 * 验证并获取内容
 * @param toolName - 工具名称
 * @param input - 输入参数
 * @returns 验证后的内容或失败结果
 */
function getValidatedContent(toolName: string, input: ToolContentInput) {
  const content = typeof input.content === 'string' ? input.content : '';
  if (!content.trim()) {
    return createToolFailureResult(toolName, 'INVALID_INPUT', '写入内容不能为空');
  }

  return content;
}

/**
 * 规范化执行错误消息。
 * @param error - 捕获到的异常
 * @returns 可展示的错误说明
 */
function getExecutionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '写入操作执行失败';
}

/**
 * 请求用户确认或返回取消结果
 * @param adapter - 确认适配器
 * @param request - 确认请求
 * @param toolName - 工具名称
 * @returns null 表示已确认，否则返回取消结果
 */
async function confirmOrCancel(adapter: AIToolConfirmationAdapter, request: AIToolConfirmationRequest, toolName: string) {
  const confirmed = await adapter.confirm(request);

  return confirmed ? null : createToolCancelledResult(toolName);
}

/**
 * 执行写操作，并将执行状态同步给确认适配器。
 * @param adapter - 确认适配器
 * @param request - 确认请求
 * @param toolName - 工具名称
 * @param operation - 实际写操作
 * @returns 工具执行结果
 */
async function executeConfirmedWrite(adapter: AIToolConfirmationAdapter, request: AIToolConfirmationRequest, toolName: string, operation: () => Promise<void>) {
  await adapter.onExecutionStart?.(request);

  try {
    await operation();
    await adapter.onExecutionComplete?.(request, { status: 'success' });
    return createToolSuccessResult(toolName, { applied: true as const });
  } catch (error) {
    const errorMessage = getExecutionErrorMessage(error);
    await adapter.onExecutionComplete?.(request, { status: 'failure', errorMessage });
    return createToolFailureResult(toolName, 'EXECUTION_FAILED', errorMessage);
  }
}

/**
 * 创建内置写入工具
 * @param adapter - 确认适配器
 * @returns 写入工具执行器对象
 */
export function createBuiltinWriteTools(adapter: AIToolConfirmationAdapter): BuiltinWriteTools {
  return {
    insertAtCursor: {
      definition: {
        name: 'insert_at_cursor',
        description: '在当前光标位置插入内容。',
        source: 'builtin',
        permission: 'write',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '要插入的内容。' }
          },
          required: ['content'],
          additionalProperties: false
        }
      },
      async execute(input: ToolContentInput, context: AIToolContext) {
        // 验证内容
        const content = getValidatedContent('insert_at_cursor', input);
        if (typeof content !== 'string') {
          return content;
        }

        // 请求用户确认
        const request: AIToolConfirmationRequest = {
          toolName: 'insert_at_cursor',
          title: 'AI 想要插入内容',
          description: 'AI 请求在当前光标位置插入新内容。',
          permission: 'write',
          afterText: content
        };
        const cancelled = await confirmOrCancel(adapter, request, 'insert_at_cursor');
        if (cancelled) {
          return cancelled;
        }

        // 执行插入
        return executeConfirmedWrite(adapter, request, 'insert_at_cursor', async () => {
          await context.editor.insertAtCursor(content);
        });
      }
    },
    replaceSelection: {
      definition: {
        name: 'replace_selection',
        description: '替换当前编辑器选区内容。',
        source: 'builtin',
        permission: 'write',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '要替换为的新内容。' }
          },
          required: ['content'],
          additionalProperties: false
        }
      },
      async execute(input: ToolContentInput, context: AIToolContext) {
        // 验证内容
        const content = getValidatedContent('replace_selection', input);
        if (typeof content !== 'string') {
          return content;
        }

        // 检查是否有选区
        const selection = context.editor.getSelection();
        if (!selection) {
          return createToolFailureResult('replace_selection', 'NO_SELECTION', '当前没有选区');
        }

        // 请求用户确认
        const request: AIToolConfirmationRequest = {
          toolName: 'replace_selection',
          title: 'AI 想要替换当前选区',
          description: 'AI 请求用新内容替换当前选中的文本。',
          permission: 'write',
          beforeText: selection.text,
          afterText: content
        };
        const cancelled = await confirmOrCancel(adapter, request, 'replace_selection');
        if (cancelled) {
          return cancelled;
        }

        // 再次检查选区是否仍然有效
        const latestSelection = context.editor.getSelection();
        if (!latestSelection) {
          return createToolFailureResult('replace_selection', 'STALE_CONTEXT', '当前选区已失效，请重新选择文本');
        }

        // 执行替换
        return executeConfirmedWrite(adapter, request, 'replace_selection', async () => {
          await context.editor.replaceSelection(content);
        });
      }
    },
    replaceDocument: {
      definition: {
        name: 'replace_document',
        description: '替换当前整个文档内容。',
        source: 'builtin',
        permission: 'dangerous',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '新的完整文档内容。' }
          },
          required: ['content'],
          additionalProperties: false
        }
      },
      async execute(input: ToolContentInput, context: AIToolContext) {
        // 验证内容
        const content = getValidatedContent('replace_document', input);
        if (typeof content !== 'string') {
          return content;
        }

        // 请求用户确认（危险操作）
        const request: AIToolConfirmationRequest = {
          toolName: 'replace_document',
          title: 'AI 想要替换整篇文档',
          description: 'AI 请求使用新内容覆盖当前整篇文档。',
          permission: 'dangerous',
          beforeText: context.document.getContent(),
          afterText: content
        };
        const cancelled = await confirmOrCancel(adapter, request, 'replace_document');
        if (cancelled) {
          return cancelled;
        }

        // 执行替换
        return executeConfirmedWrite(adapter, request, 'replace_document', async () => {
          await context.editor.replaceDocument(content);
        });
      }
    }
  };
}
