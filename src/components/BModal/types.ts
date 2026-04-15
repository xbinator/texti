import type { CSSProperties } from 'vue';

export interface BModalProps {
  // 弹窗是否打开
  open?: boolean;
  // 弹窗标题
  title?: string;
  // 弹窗宽度，支持字符串或数字
  width?: string | number;
  // 是否可关闭
  closable?: boolean;
  // 弹窗主体额外类名
  mainClass?: string;
  // 弹窗主体额外样式，支持对象或字符串
  mainStyle?: CSSProperties | string;
  // 弹窗是否垂直居中
  centered?: boolean;
  // 点击遮罩是否可关闭
  maskClosable?: boolean;
  // 关闭弹窗的回调函数
  close?: () => void;
  // 弹窗关闭后的回调函数
  afterClose?: () => void;
  // 是否支持键盘操作（如按 ESC 关闭）
  keyboard?: boolean;
}
