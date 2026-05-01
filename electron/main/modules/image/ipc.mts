/**
 * @file ipc.mts
 * @description 图片压缩 IPC handler，使用 sharp 在主进程执行图片压缩
 */
import { ipcMain } from 'electron';
import sharp from 'sharp';

/** 压缩参数 */
interface ImageCompressRequest {
  /** 原始图片二进制数据（IPC 传输后为普通对象，需 Buffer.from 转换） */
  buffer: Buffer;
  /** 图片 MIME 类型（如 image/jpeg, image/png, image/webp） */
  mimeType: string;
}

/** 压缩结果 */
interface ImageCompressResult {
  /** 压缩后的二进制数据 */
  buffer: Buffer;
  /** 是否实际执行了压缩（未触发 skip 或 fallback 时为 true） */
  compressed: boolean;
}

/** 输出图片宽高上限 */
const MAX_DIMENSION = 2048;
/** JPEG 输出质量（0-100） */
const JPEG_QUALITY = 80;
/** PNG 压缩级别（0-9，6 为 libvips 默认值，性价比最优） */
const PNG_COMPRESSION_LEVEL = 6;
/** WebP 输出质量（0-100） */
const WEBP_QUALITY = 80;
/** 不支持压缩的 MIME 类型（动图、HEIC 等 sharp resize 会丢帧或依赖可选库） */
const SKIP_FORMATS = new Set(['image/gif', 'image/heic', 'image/heif']);

/**
 * 解析 MIME 类型到 sharp 输出格式。
 * @param mimeType - 图片 MIME 类型
 * @returns sharp 输出格式 key，若格式不支持压缩则返回 undefined
 */
function mimeTypeToFormat(mimeType: string): keyof sharp.FormatEnum | undefined {
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpeg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/avif') return 'avif';
  if (mimeType === 'image/tiff') return 'tiff';
  // GIF、HEIC 等不支持的格式在主流程中跳过
  return undefined;
}

/**
 * 注册图片压缩相关的 IPC handlers。
 */
export function registerImageHandlers(): void {
  ipcMain.handle('image:compress', async (_event, request: ImageCompressRequest): Promise<ImageCompressResult> => {
    // 动图、HEIC 等不支持的格式直接跳过压缩
    if (SKIP_FORMATS.has(request.mimeType)) {
      return { buffer: request.buffer, compressed: false };
    }

    // ⚠️ IPC 传输后 ArrayBuffer 变为普通对象，必须显式转为 Buffer
    // Buffer.from() 本身也可能失败（数据损坏等），失败时降级返回原始数据
    let inputBuffer: Buffer;
    try {
      inputBuffer = Buffer.from(request.buffer);
    } catch {
      return { buffer: request.buffer, compressed: false };
    }

    const format = mimeTypeToFormat(request.mimeType);

    const originalSize = inputBuffer.length;

    try {
      let pipeline = sharp(inputBuffer).resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true });

      // 根据原始格式选择输出参数
      if (format === 'jpeg') {
        pipeline = pipeline.jpeg({ quality: JPEG_QUALITY });
      } else if (format === 'png') {
        pipeline = pipeline.png({ compressionLevel: PNG_COMPRESSION_LEVEL });
      } else if (format === 'webp') {
        pipeline = pipeline.webp({ quality: WEBP_QUALITY });
      } else if (format === 'avif') {
        pipeline = pipeline.avif({ quality: JPEG_QUALITY });
      } else if (format) {
        // tiff 等其他较少见格式仅 resize，不改变格式
        pipeline = pipeline.toFormat(format);
      }
      // 未知格式：不调用 toFormat()，依赖 sharp 从输入自动推断输出格式
      // 若 sharp 无法推断则 toBuffer() 抛异常，外层 catch 降级返回 inputBuffer

      const outputBuffer = await pipeline.toBuffer();

      return { buffer: outputBuffer, compressed: true };
    } catch {
      // sharp 压缩失败时降级返回原始数据
      return { buffer: inputBuffer, compressed: false };
    }
  });
}
