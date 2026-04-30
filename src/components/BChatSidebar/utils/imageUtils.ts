/**
 * @file imageUtils.ts
 * @description 聊天侧边栏图片附件处理工具
 */
import type { ChatMessageFile } from 'types/chat';
import { nanoid } from 'nanoid';

/**
 * 将 File 对象转为 Base64 Data URL。
 * @param file - 浏览器 File 对象
 * @returns Base64 Data URL
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * 检查文件是否为图片。
 * @param file - 浏览器 File 对象
 * @returns 是否为图片
 */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/**
 * 获取文件扩展名。
 * @param filename - 文件名
 * @returns 小写扩展名，无扩展名时返回空字符串
 */
export function getFileExtension(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index >= 0 ? filename.slice(index + 1).toLowerCase() : '';
}

/**
 * 计算文本内容的 SHA-256 哈希。
 * @param value - 待计算哈希的文本
 * @returns 十六进制哈希字符串
 */
export async function sha256(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 从 File 创建聊天图片附件。
 * @param file - 浏览器 File 对象
 * @returns 聊天图片附件
 */
export async function createChatImageFile(file: File): Promise<ChatMessageFile> {
  const base64 = await fileToBase64(file);

  return {
    id: nanoid(),
    name: file.name,
    type: 'image',
    mimeType: file.type,
    size: file.size,
    extension: getFileExtension(file.name),
    url: base64,
    contentHash: await sha256(base64)
  };
}
