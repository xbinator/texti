export interface BBubbleAvatarProps {
  src?: string;
  title?: string;
}

export interface BBubbleCollapseOptions {
  defaultValue?: boolean;
  maxHeight?: number;
}
// 方向
export type BBubblePlacement = 'left' | 'right';

export type BBubbleState = 'wait' | 'output' | 'complete';

export type BBubbleSize = 'auto' | 'fill';

export interface BBubbleProps {
  // 气泡的方向，默认为 'left'
  placement?: BBubblePlacement;
  // 头像配置项，可以是一个对象或者一个布尔值，默认为 false
  avatar?: BBubbleAvatarProps | boolean;
  // 是否显示加载状态，默认为 false
  loading?: boolean;
  // 是否可折叠，默认为 false
  isCollapse?: boolean;
  // 折叠配置项，当 isCollapse 为 true 时有效，可以是一个对象或者一个布尔值，默认为 false
  collapseOptions?: BBubbleCollapseOptions;
  // 气泡的大小，默认为 'auto'
  size?: BBubbleSize;
  // 气泡的状态，可以是 'wait'、'output' 或 'complete'，默认为 'wait'
  state?: BBubbleState;
  // 是否显示气泡，默认为 true
  showContainer?: boolean;
}
