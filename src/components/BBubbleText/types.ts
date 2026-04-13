import type { BBubbleProps } from '../BBubble/types';

export interface BBubbleTextTypingOption {
  step?: number;
  interval?: number;
}

export interface BBubbleTextProps extends BBubbleProps {
  typing?: BBubbleTextTypingOption | boolean;
  content?: string;
  think?: string;
  thinkTitle?: string;
  isMarkdown?: boolean;
}
