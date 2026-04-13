import type { ChatMessage } from './types';

export class MessageAction {
  static appendText(message: ChatMessage, chunk: string): void {
    message.text = (message.text || '') + chunk;
  }

  static appendThink(message: ChatMessage, chunk: string, title?: string): void {
    message.think = (message.think || '') + chunk;
    if (title) {
      message.thinkTitle = title;
    }
  }

  static setError(message: ChatMessage, error: { message: string }): void {
    message.error = error;
  }

  static updateState(message: ChatMessage, state: ChatMessage['state']): void {
    message.state = state;
  }
}

export function createMessage(role: ChatMessage['role'], content?: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    state: role === 'assistant' ? 'wait' : 'complete',
    text: content || ''
  };
}

export function createUserMessage(content: string): ChatMessage {
  return createMessage('user', content);
}

export function createAssistantMessage(): ChatMessage {
  return createMessage('assistant');
}
