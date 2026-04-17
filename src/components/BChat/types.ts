import type { AIUsage } from 'types/ai';
import type { ChatMessageFile, ChatMessageRole } from 'types/chat';

export interface Message {
  id: string;
  role: ChatMessageRole;
  content: string;
  files?: ChatMessageFile[];
  usage?: AIUsage;
  createdAt: string;
  loading?: boolean;
  finished?: boolean;
  error?: string;
}

export interface BChatProps {
  placeholder?: string;
  messages?: Message[];
  onBeforeSend?: (message: Message) => Message | Promise<Message | void> | void;
  onBeforeRegenerate?: (messages: Message[], triggerMessage: Message) => Promise<void> | void;
}
