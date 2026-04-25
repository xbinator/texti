/* eslint-disable no-use-before-define */
/**
 * @file confirmationController.ts
 * @description 聊天侧边栏会话级确认控制器，负责卡片状态与 Promise 桥接。
 */
import type { ChatMessageConfirmationPart, ChatMessageConfirmationStatus } from 'types/chat';
import { nanoid } from 'nanoid';
import type { AIToolConfirmationAdapter, AIToolConfirmationDecision, AIToolConfirmationRequest } from '@/ai/tools/confirmation';
import type { Message } from '@/components/BChatSidebar/utils/types';

/**
 * 确认控制器依赖。
 */
interface ChatConfirmationControllerOptions {
  /** 读取当前会话消息列表 */
  getMessages: () => Message[];
}

/**
 * 挂起中的确认项。
 */
interface PendingConfirmation {
  /** 确认项 ID */
  id: string;
  /** 原始请求 */
  request: AIToolConfirmationRequest;
  /** Promise 完成回调 */
  resolve: (decision: AIToolConfirmationDecision) => void;
}

/**
 * 查找最后一条 assistant 消息。
 * @param messages - 当前消息列表
 * @returns assistant 消息，不存在时返回 undefined
 */
function findLastAssistantMessage(messages: Message[]): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant') {
      return messages[index];
    }
  }

  return undefined;
}

/**
 * 创建确认卡片片段。
 * @param confirmationId - 确认项 ID
 * @param request - 确认请求
 * @returns 确认卡片片段
 */
function createConfirmationPart(confirmationId: string, request: AIToolConfirmationRequest): ChatMessageConfirmationPart {
  return {
    type: 'confirmation',
    confirmationId,
    toolName: request.toolName,
    title: request.title,
    description: request.description,
    riskLevel: request.riskLevel === 'dangerous' ? 'dangerous' : 'write',
    beforeText: request.beforeText,
    afterText: request.afterText,
    allowRemember: request.allowRemember,
    rememberScopes: request.rememberScopes,
    confirmationStatus: 'pending',
    executionStatus: 'idle'
  };
}

/**
 * 创建会话级确认控制器。
 * @param options - 控制器依赖
 * @returns 确认控制器
 */
export function createChatConfirmationController(options: ChatConfirmationControllerOptions) {
  let pendingConfirmation: PendingConfirmation | null = null;
  let activeConfirmationId: string | null = null;

  /**
   * 根据确认项 ID 查找确认卡片片段。
   * @param confirmationId - 确认项 ID
   * @returns 对应的确认卡片片段
   */
  function findConfirmationPart(confirmationId: string): ChatMessageConfirmationPart | undefined {
    const messages = options.getMessages();

    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const message = messages[messageIndex];
      const part = message.parts.find((item): item is ChatMessageConfirmationPart => item.type === 'confirmation' && item.confirmationId === confirmationId);

      if (part) {
        return part;
      }
    }

    return undefined;
  }

  /**
   * 将确认项更新为指定状态。
   * @param confirmationId - 确认项 ID
   * @param status - 确认状态
   */
  function updateConfirmationStatus(confirmationId: string, status: ChatMessageConfirmationStatus): void {
    const part = findConfirmationPart(confirmationId);
    if (!part) {
      return;
    }

    part.confirmationStatus = status;
  }

  /**
   * 更新确认项执行状态。
   * @param confirmationId - 确认项 ID
   * @param executionStatus - 执行状态
   * @param executionError - 执行失败说明
   */
  function updateExecutionStatus(confirmationId: string, executionStatus: ChatMessageConfirmationPart['executionStatus'], executionError?: string): void {
    const part = findConfirmationPart(confirmationId);
    if (!part) {
      return;
    }

    part.executionStatus = executionStatus;
    part.executionError = executionError;
  }

  /**
   * 结束当前挂起确认项。
   * @param status - 最终确认状态
   * @param decision - Promise 返回值
   */
  function settlePendingConfirmation(status: ChatMessageConfirmationStatus, decision: AIToolConfirmationDecision): void {
    if (!pendingConfirmation) {
      return;
    }

    const current = pendingConfirmation;
    pendingConfirmation = null;
    updateConfirmationStatus(current.id, status);
    current.resolve(decision);
  }

  /**
   * 请求用户确认。
   * @param request - 确认请求
   * @returns 用户是否确认
   */
  async function requestConfirmation(request: AIToolConfirmationRequest): Promise<AIToolConfirmationDecision> {
    expirePendingConfirmation();

    const message = findLastAssistantMessage(options.getMessages());
    if (!message) {
      return { approved: false };
    }

    const confirmationId = nanoid();
    message.parts.push(createConfirmationPart(confirmationId, request));

    return new Promise<AIToolConfirmationDecision>((resolve) => {
      pendingConfirmation = { id: confirmationId, request, resolve };
    });
  }

  /**
   * 同意当前确认项。
   * @param confirmationId - 确认项 ID
   * @param grantScope - 可选授权范围
   */
  function approveConfirmation(confirmationId: string, grantScope?: 'session' | 'always'): void {
    if (!pendingConfirmation || pendingConfirmation.id !== confirmationId) {
      return;
    }

    activeConfirmationId = confirmationId;
    settlePendingConfirmation('approved', grantScope ? { approved: true, grantScope } : { approved: true });
  }

  /**
   * 取消当前确认项。
   * @param confirmationId - 确认项 ID
   */
  function cancelConfirmation(confirmationId: string): void {
    if (!pendingConfirmation || pendingConfirmation.id !== confirmationId) {
      return;
    }

    settlePendingConfirmation('cancelled', { approved: false });
  }

  /**
   * 让当前挂起确认项过期。
   */
  function expirePendingConfirmation(): void {
    if (!pendingConfirmation) {
      return;
    }

    settlePendingConfirmation('expired', { approved: false });
  }

  /**
   * 标记已确认项开始执行。
   */
  function markExecutionStart(): void {
    if (!activeConfirmationId) {
      return;
    }

    updateExecutionStatus(activeConfirmationId, 'running');
  }

  /**
   * 标记已确认项执行完成。
   * @param result - 执行结果
   */
  function markExecutionComplete(result: { status: 'success' | 'failure'; errorMessage?: string }): void {
    if (!activeConfirmationId) {
      return;
    }

    updateExecutionStatus(activeConfirmationId, result.status, result.errorMessage);
    activeConfirmationId = null;
  }

  /**
   * 释放当前控制器持有的挂起确认。
   */
  function dispose(): void {
    expirePendingConfirmation();
    activeConfirmationId = null;
  }

  /**
   * 创建适配写工具的确认适配器。
   * @returns 工具确认适配器
   */
  function createAdapter(): AIToolConfirmationAdapter {
    return {
      confirm: requestConfirmation,
      onExecutionStart: markExecutionStart,
      onExecutionComplete: (_request, result) => {
        markExecutionComplete(result);
      }
    };
  }

  return {
    requestConfirmation,
    approveConfirmation,
    cancelConfirmation,
    expirePendingConfirmation,
    markExecutionStart,
    markExecutionComplete,
    dispose,
    createAdapter
  };
}
