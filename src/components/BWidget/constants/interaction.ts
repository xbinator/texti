/**
 * @file interaction.ts
 * @description BWidget 工具模式、拖拽和选择交互常量。
 */
import type { SnapDirections } from 'moveable';

/**
 * Moveable 控制框与节点边界之间的视觉留白。
 */
export const WIDGET_MOVEABLE_SELECTION_PADDING = {
  bottom: 0,
  left: 0,
  right: 0,
  top: 0
} as const;

/**
 * Moveable 缩放控制点方向，仅保留四个角以避免边中点误触。
 */
export const WIDGET_MOVEABLE_RENDER_DIRECTIONS: readonly string[] = ['nw', 'ne', 'sw', 'se'];

/**
 * Moveable 元素吸附方向，显式包含中心线和中线。
 */
export const WIDGET_MOVEABLE_SNAP_DIRECTIONS: SnapDirections = {
  bottom: true,
  center: true,
  left: true,
  middle: true,
  right: true,
  top: true
};

/**
 * Moveable 吸附距离阈值。
 */
export const WIDGET_MOVEABLE_SNAP_THRESHOLD = 5;

/**
 * Moveable 拖拽和缩放节流值。
 */
export const WIDGET_MOVEABLE_THROTTLE = 0;

/**
 * Selecto 不应该从这些交互目标启动，避免抢占 Moveable 拖拽和缩放。
 */
export const WIDGET_SELECTO_BLOCKED_DRAG_SELECTOR = [
  '.b-widget-context-menu',
  '.b-widget-moveable-layer',
  '.b-widget-element',
  '.moveable-control',
  '.moveable-line',
  '.moveable-area',
  '.moveable-control-box',
  '.moveable-direction'
].join(', ');
