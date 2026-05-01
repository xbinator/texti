/**
 * @file imageUtils.ts
 * @description 聊天侧边栏图片附件处理工具，含 sharp 压缩集成
 */
import type { ChatMessageFile } from 'types/chat';
import { nanoid } from 'nanoid';
import { logger } from '@/shared/logger';

/** 图片压缩体积阈值（字节），小于此阈值的图片跳过压缩 */
const COMPRESS_SIZE_THRESHOLD = 500 * 1024;

/**
 * 将 File 对象转为 Base64 Data URL（未经压缩，保留供其他模块使用）。
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
 * 将 ArrayBuffer 转为 Base64 Data URL。
 * @param buffer - 二进制图片数据
 * @param mimeType - MIME 类型（如 image/jpeg）
 * @returns Base64 Data URL
 */
function arrayBufferToBase64(buffer: ArrayBuffer, mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buffer], { type: mimeType });
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
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
 * 从 File 创建聊天图片附件（含 sharp 压缩）。
 * 文件读取失败直接向上抛；仅压缩失败时 fallback 到原始数据。
 * @param file - 浏览器 File 对象
 * @returns 聊天图片附件
 */
export async function createChatImageFile(file: File): Promise<ChatMessageFile> {
  // 文件读取失败直接向上抛，不做 fallback
  const originalBuffer = await file.arrayBuffer();
  let imageBuffer: ArrayBuffer = originalBuffer;
  let compressed = false;

  if (originalBuffer.byteLength > COMPRESS_SIZE_THRESHOLD && window.electronAPI?.compressImage) {
    try {
      const result = await window.electronAPI.compressImage(originalBuffer, file.type);
      imageBuffer = result.buffer;
      compressed = result.compressed;
    } catch {
      // 仅压缩失败时 fallback 到原始 buffer
      imageBuffer = originalBuffer;
    }
  }

  const base64 = await arrayBufferToBase64(imageBuffer, file.type);

  // 压缩结果接入日志系统，便于运行时排查
  if (compressed) {
    const compressedKB = (imageBuffer.byteLength / 1024).toFixed(0);
    const originalKB = (file.size / 1024).toFixed(0);
    const ratio = Math.max(0, (1 - imageBuffer.byteLength / file.size) * 100).toFixed(1);
    logger.info(
      `Image compressed: ${file.name} (${originalKB}KB → ${compressedKB}KB, -${ratio}%)`
    );
  }

  return {
    id: nanoid(),
    name: file.name,
    type: 'image',
    mimeType: file.type,
    size: imageBuffer.byteLength,
    extension: getFileExtension(file.name),
    url: base64,
    contentHash: await sha256(base64)
  };
}
