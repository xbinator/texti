/**
 * @file timeFormat.ts
 * @description 消息发送时间格式化工具
 */
import dayjs from 'dayjs';

/**
 * 格式化消息发送时间
 * 今天显示 HH:mm，昨天显示"昨天 HH:mm"，更早显示 MM-DD HH:mm
 * @param timestamp - ISO 时间字符串
 * @returns 格式化后的时间文本
 */
export function formatMessageTime(timestamp: string): string {
  const date = dayjs(timestamp);
  const now = dayjs();

  if (date.isSame(now, 'day')) return date.format('HH:mm');
  if (date.isSame(now.subtract(1, 'day'), 'day')) return `昨天 ${date.format('HH:mm')}`;
  return date.format('MM-DD HH:mm');
}
