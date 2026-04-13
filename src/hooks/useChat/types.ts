import type { UserType } from './constant';
import type { AIRequestOptions } from 'types/ai';

export interface ChatMessageContent {
  text?: string;
  think?: string;
  thinkTitle?: string;
}

export interface ChatMessage extends ChatMessageContent {
  id: string;
  role: 'user' | 'assistant';
  state: 'wait' | 'output' | 'complete';
  error?: { message: string };
}

export interface ChatConversation {
  id: string;
  title?: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface UseChatOptions {
  providerId: string | undefined;
  onBeforeSend?: () => void;
  onReceive?: (chunk: string) => void;
  onComplete?: () => void;
  onError?: (error: { message: string }) => void;
}

export interface SendMessageOptions {
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export type ChatRole = 'user' | 'assistant';

export interface ChatMessageAction {
  id: string;
  userType: UserType;
  content: ChatMessageContent;
  state: 'wait' | 'output' | 'complete';
  error?: { message: string };
}

export interface StreamPayload extends AIRequestOptions {
  requestId?: string;
}
