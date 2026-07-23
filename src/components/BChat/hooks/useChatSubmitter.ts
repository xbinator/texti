/**
 * @file useChatSubmitter.ts
 * @description BChat 消息级交互统一提交 hook。
 */
import type { BChatRuntimeSubmitMessagePartInput, BChatRuntimeSubmitUserChoiceInput } from './useChatRuntime';
import type { PreparedRuntimeRequest } from './useRuntimeRequestConfig';
import type { AdaptedUserMessageInput, MessagePartUpdateInput, SubmitAction } from '../utils/submitAction';
import type { Message } from '../utils/types';
import type { AIUserChoiceAnswerData } from 'types/chat';
import type { ChatRuntimeAddress, ChatRuntimeModelSelection, ChatRuntimeStartResult } from 'types/chat-runtime';
import type { Ref } from 'vue';
import { cloneDeep } from 'lodash-es';
import type { ChatRuntimeRequestConfig } from '@/ai/chat/policies/runtimeRequest';

/**
 * BChat 统一提交 hook 选项。
 */
interface UseChatSubmitterOptions {
  /** 当前消息列表。 */
  messages: Ref<Message[]>;
  /** 当前 Session workflow 是否拒绝新消息。 */
  isWorkflowBusy: () => boolean;
  /** 获取当前会话 ID。 */
  getSessionId: () => string | undefined;
  /** 获取当前活跃 runtime ID。 */
  getActiveRuntimeId: () => string | undefined;
  /** 解析 Runtime 请求配置。 */
  resolveRuntimeRequestConfig: () => Promise<ChatRuntimeRequestConfig | null>;
  /** 准备完整 Runtime 请求和 renderer capabilities。 */
  prepareRuntimeRequest?: () => Promise<PreparedRuntimeRequest | null>;
  /** 在 Runtime 启动前保证会话模型已持久化。 */
  ensureSessionModel: (sessionId: string, model: ChatRuntimeModelSelection) => Promise<void>;
  /** 用户选择开始续跑回调。 */
  onContinueStarted?: (answer: AIUserChoiceAnswerData) => void;
  /** 在 IPC 前注册 Runtime 并返回完整地址。 */
  startRuntime?: (prepared: PreparedRuntimeRequest) => ChatRuntimeAddress;
  /** Runtime IPC 返回后的收尾回调。 */
  finishRuntimeStart?: (result: ChatRuntimeStartResult, runtimeId: string) => void;
  /** 用户选择续跑准备失败回调。 */
  onContinueFailed?: (error: unknown, runtimeId?: string) => void;
  /** 提交用户选择并续跑。 */
  submitUserChoice: (input: BChatRuntimeSubmitUserChoiceInput) => Promise<ChatRuntimeStartResult>;
  /** 发送已创建的用户消息。 */
  sendRuntimeUserMessage: (input: AdaptedUserMessageInput) => Promise<void>;
  /** 提交 renderer 侧产生的消息片段更新。 */
  submitRuntimeMessagePart: (input: BChatRuntimeSubmitMessagePartInput) => Promise<void>;
  /** 持久化单条消息。 */
  updateSessionMessage: (sessionId: string | undefined, message: Message) => Promise<void>;
}

/**
 * BChat 统一提交 hook 返回值。
 */
interface UseChatSubmitterReturn {
  /**
   * 提交消息级交互动作。
   * @param action - 已由底层组件适配好的提交动作
   */
  submit: (action: SubmitAction) => Promise<void>;
}

/**
 * 创建 BChat 消息级交互统一提交器。
 * @param options - 提交器依赖
 * @returns 统一提交能力
 */
export function useChatSubmitter(options: UseChatSubmitterOptions): UseChatSubmitterReturn {
  let userChoiceSubmission: Promise<void> | null = null;

  /**
   * 执行一次等待中助手任务的续跑。
   * @param answer - 用户选择答案
   */
  async function performAssistantTurnContinuation(answer: AIUserChoiceAnswerData): Promise<void> {
    let runtimeId: string | undefined;
    try {
      const sessionId = options.getSessionId();
      if (!sessionId) {
        return;
      }

      options.onContinueStarted?.(answer);
      const prepared = options.prepareRuntimeRequest ? await options.prepareRuntimeRequest() : undefined;
      const runtimeConfig = options.prepareRuntimeRequest ? prepared?.config ?? null : await options.resolveRuntimeRequestConfig();
      if (!runtimeConfig) {
        options.onContinueFailed?.(new Error('Runtime request configuration is unavailable'));
        return;
      }
      if (!prepared || !options.startRuntime) {
        options.onContinueFailed?.(new Error('Prepared Runtime request is unavailable'));
        return;
      }

      await options.ensureSessionModel(sessionId, prepared.config.model);
      const runtimeAddress = options.startRuntime(prepared);
      runtimeId = runtimeAddress.runtimeId;

      const result = await options.submitUserChoice({
        ...runtimeAddress,
        answer,
        ...runtimeConfig
      });
      options.finishRuntimeStart?.(result, runtimeId);
    } catch (error) {
      options.onContinueFailed?.(error, runtimeId);
      throw error;
    }
  }

  /**
   * 续跑一个等待中的助手任务；并发调用共享同一个提交 Promise。
   * @param answer - 用户选择答案
   */
  async function continueAssistantTurn(answer: AIUserChoiceAnswerData): Promise<void> {
    if (userChoiceSubmission) {
      await userChoiceSubmission;
      return;
    }

    const submission = performAssistantTurnContinuation(answer);
    userChoiceSubmission = submission;
    try {
      await submission;
    } finally {
      if (userChoiceSubmission === submission) userChoiceSubmission = null;
    }
  }

  /**
   * 提交 renderer 已构造好的用户消息。
   * @param input - 运行态用户消息提交输入
   */
  async function sendAdaptedUserMessage(input: AdaptedUserMessageInput): Promise<void> {
    if (options.isWorkflowBusy()) return;

    await options.sendRuntimeUserMessage(input);
  }

  /**
   * 提交 renderer 已构造好的消息片段更新。
   * @param input - 消息片段更新输入
   */
  async function updateMessagePart(input: MessagePartUpdateInput): Promise<void> {
    const messageIndex = options.messages.value.findIndex((message: Message): boolean => message.id === input.messageId);
    if (messageIndex < 0) return;

    const nextMessage = cloneDeep(options.messages.value[messageIndex]);
    const partIndex = nextMessage.parts.findIndex((part): boolean => part.id === input.part.id);
    if (partIndex < 0) return;

    nextMessage.parts.splice(partIndex, 1, cloneDeep(input.part));

    const runtimeId = options.getActiveRuntimeId();
    if (runtimeId) {
      await options.submitRuntimeMessagePart({
        runtimeId,
        messageId: input.messageId,
        part: cloneDeep(input.part)
      });
      return;
    }

    options.messages.value.splice(messageIndex, 1, nextMessage);
    await options.updateSessionMessage(options.getSessionId(), nextMessage);
  }

  /**
   * 提交消息级交互动作。
   * @param action - 已由底层组件适配好的提交动作
   */
  async function submit(action: SubmitAction): Promise<void> {
    await action.run({
      continueAssistantTurn,
      sendAdaptedUserMessage,
      updateMessagePart
    });
  }

  return { submit };
}
