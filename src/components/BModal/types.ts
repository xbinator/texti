import type { CSSProperties } from 'vue';

export interface BModalProps {
  open?: boolean;
  title?: string;
  width?: string | number;
  closable?: boolean;
  mainClass?: string;
  mainStyle?: CSSProperties | string;
  centered?: boolean;
  maskClosable?: boolean;
  close?: () => void;
  afterClose?: () => void;
  keyboard?: boolean;
}
