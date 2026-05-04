/**
 * @file confirmation.ts
 * @description AI 工具确认机制，用于危险操作的用户确认
 */
import type { AIToolGrantScope, AIToolRiskLevel } from 'types/ai';
import type { ChatMessageConfirmationCustomInputConfig } from 'types/chat';

/**
 * AI 工具确认决策。
 */
export type AIToolConfirmationDecision =
  | { approved: false }
  | {
      /** 是否批准执行 */
      approved: true;
      /** 可选授权范围 */
      grantScope?: AIToolGrantScope;
    };

/**
 * AI 工具确认请求
 * @description 描述需要用户确认的操作信息
 */
export interface AIToolConfirmationRequest {
  /** 工具名称 */
  toolName: string;
  /** 确认弹窗标题 */
  title: string;
  /** 确认弹窗描述 */
  description: string;
  /** 风险级别 */
  riskLevel: AIToolRiskLevel;
  /** 操作前的文本内容（用于预览） */
  beforeText?: string;
  /** 操作后的文本内容（用于预览） */
  afterText?: string;
  /** 是否允许记住本次授权 */
  allowRemember?: boolean;
  /** 可选的记忆授权范围 */
  rememberScopes?: AIToolGrantScope[];
  /** 与确认卡片关联的自定义输入配置 */
  customInput?: ChatMessageConfirmationCustomInputConfig;
}

/**
 * AI 工具确认适配器接口
 * @description 定义工具确认的实现方式
 */
export interface AIToolConfirmationAdapter {
  /**
   * 请求用户确认
   * @param request - 确认请求信息
   * @returns 用户确认决策
   */
  confirm: (request: AIToolConfirmationRequest) => Promise<AIToolConfirmationDecision | boolean>;
  /**
   * 通知确认项开始执行写入操作。
   * @param request - 确认请求信息
   */
  onExecutionStart?: (request: AIToolConfirmationRequest) => void | Promise<void>;
  /**
   * 通知确认项执行完成。
   * @param request - 确认请求信息
   * @param result - 执行结果
   */
  onExecutionComplete?: (request: AIToolConfirmationRequest, result: { status: 'success' | 'failure'; errorMessage?: string }) => void | Promise<void>;
}
