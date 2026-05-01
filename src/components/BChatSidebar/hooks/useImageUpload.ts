/**
 * @file useImageUpload.ts
 * @description 图片上传状态管理 hook，管理图片校验、草稿操作和纯图片摘要生成
 */
import type { ChatMessageFile } from 'types/chat';
import type { Ref } from 'vue';
import { computed } from 'vue';
import { message } from 'ant-design-vue';
import { createChatImageFile, isImageFile } from '@/components/BChatSidebar/utils/imageUtils';
import type { PasteImageContext } from '@/components/BPromptEditor/types';

/** 单张图片大小限制 */
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
/** 图片数量限制 */
const MAX_IMAGE_COUNT = 6;
/** 图片总大小限制 */
const MAX_TOTAL_IMAGE_SIZE = 15 * 1024 * 1024;

/**
 * 图片上传 Hook 依赖的草稿输入接口
 */
interface ChatInputForImage {
  /** 草稿图片附件列表 */
  inputImages: Ref<ChatMessageFile[]>;
  /** 追加草稿图片附件 */
  addImages: (files: ChatMessageFile[]) => void;
  /** 删除指定草稿图片 */
  removeImage: (imageId: string) => void;
  /** 检查输入内容是否为空 */
  isEmpty: () => boolean;
  /** 检查是否存在草稿图片 */
  hasImages: () => boolean;
}

/**
 * 图片上传 Hook 的依赖项
 */
interface UseImageUploadOptions {
  /** 当前模型是否支持视觉识别 */
  supportsVision: Ref<boolean>;
  /** 草稿输入 hook 的图片相关接口 */
  inputEvents: ChatInputForImage;
}

/**
 * 图片上传状态管理 hook
 * @param options - 依赖项配置
 * @returns 图片上传状态和操作方法
 */
export function useImageUpload(options: UseImageUploadOptions) {
  const { supportsVision, inputEvents } = options;

  /** 当前是否因模型能力限制而阻止发送图片 */
  const imagesBlockedByModel = computed<boolean>(() => inputEvents.hasImages() && !supportsVision.value);

  /**
   * 判断当前是否允许接收图片。
   * @returns 是否允许接收图片
   */
  function canAcceptImages(): boolean {
    return supportsVision.value;
  }

  /**
   * 校验待追加图片列表。
   * @param incomingFiles - 待追加文件列表
   */
  function validateIncomingImages(incomingFiles: File[]): void {
    const { inputImages } = inputEvents;

    const nextCount = inputImages.value.length + incomingFiles.length;
    if (nextCount > MAX_IMAGE_COUNT) {
      throw new Error(`最多只能上传 ${MAX_IMAGE_COUNT} 张图片`);
    }

    const nextTotalSize = inputImages.value.reduce((sum, item) => sum + (item.size ?? 0), 0) + incomingFiles.reduce((sum, file) => sum + file.size, 0);
    if (nextTotalSize > MAX_TOTAL_IMAGE_SIZE) {
      throw new Error('图片总大小不能超过 15MB');
    }

    for (const file of incomingFiles) {
      if (!isImageFile(file)) {
        throw new Error('只能上传图片文件');
      }
      if (file.size > MAX_IMAGE_SIZE) {
        throw new Error('单张图片不能超过 5MB');
      }
    }
  }

  /**
   * 将图片追加到草稿区（统一入口）。
   * @param files - 待处理文件列表
   */
  async function appendImages(files: File[]): Promise<void> {
    if (!supportsVision.value) {
      message.error('当前模型不支持图片，请切换到支持视觉识别的模型后发送');
      return;
    }

    const imageFiles = files.filter((file) => isImageFile(file));
    if (imageFiles.length === 0) return;

    try {
      validateIncomingImages(imageFiles);
      const nextImages: ChatMessageFile[] = await Promise.all(imageFiles.map((file) => createChatImageFile(file)));
      inputEvents.addImages(nextImages);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '图片处理失败');
    }
  }

  /**
   * 处理图片粘贴/拖拽接管。
   * @param context - 图片接管上下文
   */
  async function onPasteImages(context: PasteImageContext): Promise<void> {
    await appendImages(context.imageFiles);
  }

  /**
   * 为纯图片消息创建文本摘要。
   * @param count - 图片数量
   * @returns 纯图片摘要文本
   */
  function createImageOnlySummary(count: number): string {
    return count === 1 ? '用户上传了一张图片，请结合图片内容回答。' : `用户上传了 ${count} 张图片，请结合这些图片内容回答。`;
  }

  return {
    imagesBlockedByModel,
    canAcceptImages,
    validateIncomingImages,
    appendImages,
    onPasteImages,
    createImageOnlySummary
  };
}
