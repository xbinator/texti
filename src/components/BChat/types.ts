import type { ServiceModelType } from '@/shared/storage/service-models';

export interface BChatProps {
  serviceType?: ServiceModelType;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  // 消息内容
  content: string;
  // 支持图片列表等多模态
  images?: string[];
  // 是否正在加载
  loading?: boolean;
  // 错误信息
  error?: Error | string;
}

export interface MessageActionProps {
  onCopy?: (message: Message) => void;
  onEdit?: (message: Message) => void;
  onDelete?: (message: Message) => void;
  onRegenerate?: (message: Message) => void;
}
