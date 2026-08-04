/**
 * @file ipc.mts
 * @description AI 服务 IPC 处理器，负责处理渲染进程与主进程之间的 AI 相关通信
 */
import type { WebContents } from 'electron';
import type { AICreateOptions, AIRequestOptions, AIStreamToolResultChunk, AIToolExecutionResult, AIUsage } from 'types/ai';
import { ipcMain } from 'electron';
import { getWindowFromWebContents } from '../../window.mjs';
import { AI_ERROR_CODE, createAIServiceError } from './errors/codes.mjs';
import { aiService } from './service.mjs';
import { normalizeAIUsage } from './usage.mjs';

function emitTextDelta(text: string, isThinking: { value: boolean }, webContents: WebContents): void {
  let remaining = text;

  while (remaining.length > 0) {
    const tag = isThinking.value ? '</think>' : '<think>';
    const channel = isThinking.value ? 'ai:stream:thinking' : 'ai:stream:text';
    const tagIndex = remaining.indexOf(tag);

    if (tagIndex === -1) {
      webContents.send(channel, remaining);
      break;
    }

    if (tagIndex > 0) {
      webContents.send(channel, remaining.slice(0, tagIndex));
    }

    isThinking.value = !isThinking.value;
    remaining = remaining.slice(tagIndex + tag.length);
  }
}

/**
 * 规范化 AI SDK 的工具结果事件。
 * @param chunk - SDK 原始工具结果片段
 * @returns 渲染进程可直接消费的工具结果载荷
 */
function normalizeToolResultChunk(chunk: { toolCallId: string; toolName: string; output: unknown }): AIStreamToolResultChunk {
  const normalizedResult: AIToolExecutionResult =
    chunk.output && typeof chunk.output === 'object' && 'status' in chunk.output && 'toolName' in chunk.output
      ? (chunk.output as AIToolExecutionResult)
      : {
          toolName: chunk.toolName,
          status: 'success',
          data: chunk.output
        };

  return {
    toolCallId: chunk.toolCallId,
    toolName: chunk.toolName,
    result: normalizedResult
  };
}

/**
 * 提取可安全展示的工具异常消息。
 * @param error - SDK 工具异常
 * @returns 稳定错误消息
 */
function readToolErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '工具执行失败';
}

/**
 * 将 SDK 工具异常转换为渲染进程可消费的失败结果。
 * @param chunk - SDK 工具异常事件
 * @returns 渲染进程工具结果载荷
 */
function normalizeToolErrorChunk(chunk: { toolCallId: string; toolName: string; error: unknown }): AIStreamToolResultChunk {
  const message = readToolErrorMessage(chunk.error);
  return {
    toolCallId: chunk.toolCallId,
    toolName: chunk.toolName,
    result: {
      toolName: chunk.toolName,
      status: 'failure',
      error: { code: 'EXECUTION_FAILED', message }
    }
  };
}

/**
 * 将 SDK 工具拒绝事件转换为渲染进程可消费的失败结果。
 * @param toolCallId - 工具调用 ID
 * @param toolName - 工具名称
 * @param reason - 可选拒绝原因
 * @returns 渲染进程工具结果载荷
 */
function normalizeToolDeniedChunk(toolCallId: string, toolName: string, reason?: string): AIStreamToolResultChunk {
  return {
    toolCallId,
    toolName,
    result: {
      toolName,
      status: 'failure',
      error: { code: 'PERMISSION_DENIED', message: reason?.trim() || `工具 ${toolName} 的执行未获批准` }
    }
  };
}
/**
 * 注册 AI 相关的 IPC 处理器
 * @description 注册 ai:stream:abort、ai:invoke、ai:stream 三个 IPC 通道
 */
export function registerAIHandlers(): void {
  /**
   * 中止流式请求
   * @param requestId - 请求 ID
   */
  ipcMain.handle('ai:stream:abort', (_event, requestId: string) => {
    aiService.abortStream(requestId);
  });

  /**
   * 同步调用 AI 服务（非流式）
   * @param createOptions - 创建选项（包含服务商配置）
   * @param request - 请求选项（包含模型 ID、消息等）
   * @returns AI 调用结果
   */
  ipcMain.handle('ai:invoke', async (_event, createOptions: AICreateOptions, request: AIRequestOptions) => {
    return aiService.generateText(createOptions, request);
  });

  /**
   * 流式调用 AI 服务
   * @param createOptions - 创建选项（包含服务商配置）
   * @param request - 请求选项（包含模型 ID、消息、请求 ID 等）
   * @description 通过 webContents.send 向渲染进程推送流式事件
   */
  ipcMain.handle('ai:stream', async (event, createOptions: AICreateOptions, request: AIRequestOptions) => {
    const win = getWindowFromWebContents(event.sender);
    if (!win) return;

    let stepUsage: AIUsage | undefined;

    try {
      const [error, result] = await aiService.streamText(createOptions, request);
      if (error) {
        win.webContents.send('ai:stream:error', error);
        return;
      }

      // 遍历流式响应，根据类型分发不同事件
      const thinkingState = { value: false };
      for await (const chunk of result.stream) {
        if (chunk.type === 'text-delta') {
          // 检测 <think> 标签来识别思考内容
          emitTextDelta(chunk.text, thinkingState, win.webContents);
        } else if (chunk.type === 'reasoning-delta') {
          // 思考状态更新
          win.webContents.send('ai:stream:thinking', chunk.text);
        } else if (chunk.type === 'tool-call') {
          // 工具调用
          win.webContents.send('ai:stream:tool-call', { toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: chunk.input });
        } else if (chunk.type === 'tool-input-start') {
          // 工具输入开始
          win.webContents.send('ai:stream:tool-input-start', { toolCallId: chunk.id, toolName: chunk.toolName });
        } else if (chunk.type === 'tool-input-delta') {
          // 工具输入增量
          win.webContents.send('ai:stream:tool-input-delta', { toolCallId: chunk.id, inputTextDelta: chunk.delta });
        } else if (chunk.type === 'tool-input-end') {
          // 工具输入结束
          win.webContents.send('ai:stream:tool-input-end', { toolCallId: chunk.id });
        } else if (chunk.type === 'tool-result') {
          // 工具结果
          win.webContents.send('ai:stream:tool-result', normalizeToolResultChunk(chunk));
        } else if (chunk.type === 'tool-error') {
          // 工具异常必须作为终态结果透传，避免 UI 长期停留在执行中。
          win.webContents.send('ai:stream:tool-result', normalizeToolErrorChunk(chunk));
        } else if (chunk.type === 'tool-output-denied') {
          // SDK 或供应商拒绝工具输出时保留权限拒绝语义。
          win.webContents.send('ai:stream:tool-result', normalizeToolDeniedChunk(chunk.toolCallId, chunk.toolName));
        } else if (chunk.type === 'tool-approval-request' && !chunk.isAutomatic) {
          // 当前直接流通道没有 SDK 审批交互，显式失败而不是静默挂起。
          win.webContents.send(
            'ai:stream:error',
            createAIServiceError(AI_ERROR_CODE.REQUEST_FAILED, `工具 ${chunk.toolCall.toolName} 请求 SDK 审批，但当前流通道未启用该审批能力`)
          );
        } else if (chunk.type === 'tool-approval-response' && !chunk.approved) {
          // 自动或供应商审批拒绝统一映射为工具失败结果。
          win.webContents.send('ai:stream:tool-result', normalizeToolDeniedChunk(chunk.toolCall.toolCallId, chunk.toolCall.toolName, chunk.reason));
        } else if (chunk.type === 'abort') {
          // 手动中止的 renderer 已清理监听；其他中止原因需要显式告知仍在监听的调用方。
          win.webContents.send('ai:stream:error', createAIServiceError(AI_ERROR_CODE.REQUEST_FAILED, chunk.reason?.trim() || '模型流已中止'));
          break;
        } else if (chunk.type === 'file' || chunk.type === 'reasoning-file') {
          // 旧直接流接口没有生成文件载荷，明确报告能力缺失，避免静默丢失模型输出。
          win.webContents.send('ai:stream:error', createAIServiceError(AI_ERROR_CODE.REQUEST_FAILED, `当前流通道尚不支持 ${chunk.type} 事件`));
        } else if (chunk.type === 'error') {
          // 流式错误
          win.webContents.send('ai:stream:error', chunk.error);
        } else if (chunk.type === 'finish-step') {
          // 每个步骤结束时覆盖为最新一步 usage，最终与累计 usage 一起发送。
          stepUsage = normalizeAIUsage(chunk.usage);
        } else if (chunk.type === 'finish') {
          // 流式完成，同时携带末步与累计 token 使用量。
          win.webContents.send('ai:stream:finish', {
            finishReason: chunk.finishReason,
            ...(stepUsage ? { stepUsage } : {}),
            totalUsage: normalizeAIUsage(chunk.totalUsage)
          });
        }
      }

      win.webContents.send('ai:stream:complete');
    } catch (error: unknown) {
      // 处理中止错误
      if (error instanceof Error && error.name === 'AbortError') {
        win.webContents.send('ai:stream:complete');
        return;
      }
      // 在 aiService.streamText 抛出的错误已经被 normalizeError 转换成了 AIServiceError 格式（包含 code 和 message）
      // 我们直接将这个错误对象发送给前端，以便前端可以根据 code 进行差异化处理
      win.webContents.send('ai:stream:error', error);
    }
  });
}
