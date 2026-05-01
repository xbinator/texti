/**
 * @file imageUtils.test.ts
 * @description createChatImageFile 图片压缩行为测试
 */
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { isImageFile, getFileExtension, sha256 } from '@/components/BChatSidebar/utils/imageUtils';

/**
 * 安装测试用 electronAPI 能力。
 */
function installElectronAPI(overrides?: Record<string, unknown>): void {
  vi.stubGlobal('window', {
    electronAPI: {
      compressImage: vi.fn(),
      logger: {
        info: vi.fn()
      },
      ...overrides
    }
  });
}

describe('imageUtils', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('isImageFile', () => {
    it('returns true for image MIME types', () => {
      expect(isImageFile(new File([], 'test.png', { type: 'image/png' }))).toBe(true);
      expect(isImageFile(new File([], 'test.jpg', { type: 'image/jpeg' }))).toBe(true);
      expect(isImageFile(new File([], 'test.webp', { type: 'image/webp' }))).toBe(true);
    });

    it('returns false for non-image MIME types', () => {
      expect(isImageFile(new File([], 'test.txt', { type: 'text/plain' }))).toBe(false);
      expect(isImageFile(new File([], 'test.pdf', { type: 'application/pdf' }))).toBe(false);
    });
  });

  describe('getFileExtension', () => {
    it('extracts lowercase extension from filename', () => {
      expect(getFileExtension('photo.PNG')).toBe('png');
      expect(getFileExtension('image.jpeg')).toBe('jpeg');
      expect(getFileExtension('noext')).toBe('');
    });
  });

  describe('sha256', () => {
    it('produces consistent hashes', async () => {
      const hash1 = await sha256('hello');
      const hash2 = await sha256('hello');
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different input', async () => {
      const hash1 = await sha256('hello');
      const hash2 = await sha256('world');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('createChatImageFile', () => {
    beforeEach(() => {
      vi.resetModules();
      // Stub FileReader 用于 base64 转换
      vi.stubGlobal('FileReader', class MockFileReader {
        private result: string | null = null;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;

        readAsDataURL(blob: Blob): void {
          // 异步调用 onload，模拟真实 FileReader 行为
          Promise.resolve().then(async () => {
            const buffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);
            this.result = `data:${blob.type};base64,${base64}`;
            this.onload?.();
          });
        }
      });
    });

    /**
     * 创建一个指定大小的测试图片（带最小 JPEG header）。
     * @param sizeKB - 图片大小（KB）
     * @param type - MIME 类型
     * @returns 测试用 File 对象
     */
    function createTestImageFile(sizeKB: number, type = 'image/jpeg'): File {
      const bytes = sizeKB * 1024;
      const buffer = new Uint8Array(bytes);
      // 写入最小 JPEG header 使其可识别
      buffer[0] = 0xff;
      buffer[1] = 0xd8;
      buffer[2] = 0xff;
      return new File([buffer], 'test.jpg', { type });
    }

    it('returns ChatMessageFile with correct structure', async () => {
      installElectronAPI();
      const { createChatImageFile } = await import('@/components/BChatSidebar/utils/imageUtils');
      const file = createTestImageFile(1); // 1KB，低于阈值

      const result = await createChatImageFile(file);

      expect(result.type).toBe('image');
      expect(result.name).toBe('test.jpg');
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.url).toMatch(/^data:image\/jpeg;base64,/);
      expect(result.contentHash).toBeTruthy();
    });

    it('skips compression for files below threshold (500KB)', async () => {
      installElectronAPI();
      const { createChatImageFile } = await import('@/components/BChatSidebar/utils/imageUtils');
      // 获取注入的 mock 引用
      const api = (window as unknown as Record<string, unknown>).electronAPI as { compressImage: ReturnType<typeof vi.fn> };

      const file = createTestImageFile(100); // 100KB
      await createChatImageFile(file);

      expect(api.compressImage).not.toHaveBeenCalled();
    });

    it('skips compression when electronAPI is unavailable', async () => {
      // 安装 window 但不带 electronAPI，模拟 Web 环境
      vi.stubGlobal('window', {});
      const { createChatImageFile } = await import('@/components/BChatSidebar/utils/imageUtils');
      const file = createTestImageFile(600); // 600KB，超过阈值

      const result = await createChatImageFile(file);

      expect(result.size).toBe(file.size);
      expect(result.url).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('calls compressImage for files above threshold', async () => {
      const compressedBuffer = new ArrayBuffer(100);
      const mockCompress = vi.fn().mockResolvedValue({
        buffer: compressedBuffer,
        compressed: true
      });
      installElectronAPI({ compressImage: mockCompress });

      const { createChatImageFile } = await import('@/components/BChatSidebar/utils/imageUtils');

      const file = createTestImageFile(600); // 600KB
      const result = await createChatImageFile(file);

      expect(mockCompress).toHaveBeenCalledTimes(1);
      expect(mockCompress).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'image/jpeg');
      expect(result.size).toBe(100); // 压缩后大小
    });

    it('falls back to original buffer on compression failure', async () => {
      const mockCompress = vi.fn().mockRejectedValue(new Error('sharp error'));
      installElectronAPI({ compressImage: mockCompress });

      const { createChatImageFile } = await import('@/components/BChatSidebar/utils/imageUtils');

      const file = createTestImageFile(600);
      const result = await createChatImageFile(file);

      expect(result.size).toBe(file.size); // 回退到原始大小
      expect(result.url).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('uses compressed size in output when compression succeeds', async () => {
      const compressedBuffer = new ArrayBuffer(50 * 1024); // 50KB
      const mockCompress = vi.fn().mockResolvedValue({
        buffer: compressedBuffer,
        compressed: true
      });
      installElectronAPI({ compressImage: mockCompress });

      const { createChatImageFile } = await import('@/components/BChatSidebar/utils/imageUtils');

      const file = createTestImageFile(600); // 600KB original
      const result = await createChatImageFile(file);

      expect(result.size).toBe(50 * 1024);
    });

    it('correctly uses file.type not file.mimeType for MIME', async () => {
      const mockCompress = vi.fn().mockResolvedValue({
        buffer: new ArrayBuffer(100),
        compressed: false
      });
      installElectronAPI({ compressImage: mockCompress });

      const { createChatImageFile } = await import('@/components/BChatSidebar/utils/imageUtils');

      const file = createTestImageFile(600, 'image/png');
      await createChatImageFile(file);

      expect(mockCompress).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'image/png');
    });
  });
});
