/**
 * @file submitAction.ts
 * @description BChat 消息级交互统一提交动作类型。
 */
import type { Message } from './types';
import type { AIUserChoiceAnswerData, ChatMessagePart } from 'types/chat';
import type { ChatRuntimeControlToolInput, ChatRuntimeUserInputPart } from 'types/chat-runtime';

/**
 * 已由底层组件适配好的用户消息提交输入。
 */
export interface AdaptedUserMessageInput {
  /** Renderer 侧已创建的用户消息 */
  userMessage: Message;
  /** 发送给 ChatRuntime 的结构化输入片段 */
  parts: ChatRuntimeUserInputPart[];
  /** 是否清空主输入框草稿 */
  clearDraft?: boolean;
}

/**
 * 已由底层组件适配好的消息片段更新输入。
 */
export interface MessagePartUpdateInput {
  /** 持有该 part 的消息 ID */
  messageId: string;
  /** 更新后的完整消息片段 */
  part: ChatMessagePart;
}

/**
 * BChat 消息级交互统一提交上下文。
 */
export interface SubmitContext {
  /**
   * 续跑等待中的助手任务。
   * @param answer - 用户选择答案
   */
  continueAssistantTurn: (answer: AIUserChoiceAnswerData) => Promise<void>;
  /**
   * 控制一个明确的在途 Runtime 工具。
   * @param input - 单工具控制输入
   */
  controlRuntimeTool: (input: ChatRuntimeControlToolInput) => Promise<void>;
  /**
   * 发送底层组件已适配好的用户消息。
   * @param input - 用户消息提交输入
   */
  sendAdaptedUserMessage: (input: AdaptedUserMessageInput) => Promise<void>;
  /**
   * 提交底层组件产生的消息片段更新。
   * @param input - 消息片段更新输入
   */
  updateMessagePart: (input: MessagePartUpdateInput) => Promise<void>;
}

/**
 * BChat 消息级交互统一提交动作。
 */
export interface SubmitAction {
  /**
   * 运行已经由底层组件适配好的提交动作。
   * @param context - 统一提交上下文
   */
  run: (context: SubmitContext) => Promise<void>;
}

/**
 * 创建用户选择提交动作。
 * @param answer - 用户选择答案
 * @returns 统一提交动作
 */
export function createUserChoice(answer: AIUserChoiceAnswerData): SubmitAction {
  return {
    async run(context: SubmitContext): Promise<void> {
      await context.continueAssistantTurn(answer);
    }
  };
}

/**
 * 创建单个 Runtime 工具控制动作。
 * @param input - 精确到 runtime/toolCall 的控制输入
 * @returns 统一提交动作
 */
export function createToolControl(input: ChatRuntimeControlToolInput): SubmitAction {
  return {
    async run(context: SubmitContext): Promise<void> {
      await context.controlRuntimeTool(input);
    }
  };
}
