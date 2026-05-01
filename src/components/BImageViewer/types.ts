/**
 * @file types.ts
 * @description BImageViewer 组件类型定义
 */

/** 图片查看器 Props */
export interface BImageViewerProps {
  /** 图片列表 */
  images?: string[];
  /** 初始显示的图片索引 */
  startPosition?: number;
  /** 是否展示底部缩略图轮播 */
  showCarousel?: boolean;
}
