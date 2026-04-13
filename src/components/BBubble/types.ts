export interface BBubbleAvatarProps {
  src?: string;
  title?: string;
}

export interface BBubbleCollapseOptions {
  defaultValue?: boolean;
  maxHeight?: number;
}

export type BBubblePlacement = 'left' | 'right';

export type BBubbleState = 'wait' | 'output' | 'complete';

export type BBubbleSize = 'auto' | 'fill';

export interface BBubbleProps {
  placement?: BBubblePlacement;
  avatar?: BBubbleAvatarProps | boolean;
  loading?: boolean;
  isCollapse?: boolean;
  collapseOptions?: BBubbleCollapseOptions;
  size?: BBubbleSize;
  state?: BBubbleState;
}
