/**
 * @file BUpload 组件类型定义
 * @description 定义 BUpload 组件的 Props 接口
 */

/**
 * BUpload 组件 Props
 */
export interface BUploadProps {
  /** 接受的文件类型，如 '.pdf,image/*' */
  accept?: string;
  /** 是否支持多选 */
  multiple?: boolean;
}

/**
 * BUpload 组件实例方法
 */
export interface BUploadInstance {
  /** 打开文件选择器 */
  open: () => void;
  /** 清空已选文件 */
  clear: () => void;
}
