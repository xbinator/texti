/**
 * @file headerTabDrag.ts
 * @description 提供顶部标签拖拽排序的几何计算工具。
 */

import type { TabMovePosition } from '@/stores/tabs';

/**
 * 标签页拖拽排序所需的矩形信息。
 */
export interface HeaderTabRect {
  /** 标签页唯一标识 */
  id?: string;
  /** 元素左侧相对视口的位置 */
  left: number;
  /** 元素宽度 */
  width: number;
}

/**
 * 标签栏边缘自动滚动所需的矩形信息。
 */
export interface HeaderTabScrollRect {
  /** 容器左侧相对视口的位置 */
  left: number;
  /** 容器右侧相对视口的位置 */
  right: number;
}

/**
 * 计算后的稳定放置槽位。
 */
export interface HeaderTabDropSlot {
  /** 作为插入锚点的目标标签页 ID */
  targetId: string;
  /** 插入到目标标签页前方或后方 */
  position: TabMovePosition;
}

const EDGE_SCROLL_ZONE_SIZE = 48;
const MAX_EDGE_SCROLL_DELTA = 18;

/**
 * 根据指针横向位置计算拖拽标签应插入到目标前方或后方。
 * @param clientX - 当前指针相对视口的横向坐标
 * @param rect - 目标标签页矩形信息
 * @returns 插入位置
 */
export function getHeaderTabMovePosition(clientX: number, rect: HeaderTabRect): TabMovePosition {
  const midpoint = rect.left + rect.width / 2;

  return clientX < midpoint ? 'before' : 'after';
}

/**
 * 根据整条标签栏的中心点计算稳定插入槽位。
 * @param clientX - 当前指针相对视口的横向坐标
 * @param tabRects - 当前可见标签页矩形列表
 * @param draggingTabId - 正在拖拽的标签页 ID
 * @returns 稳定的插入槽位，没有可用目标时返回 null
 */
export function getHeaderTabDropSlot(clientX: number, tabRects: HeaderTabRect[], draggingTabId: string): HeaderTabDropSlot | null {
  const candidateRects = tabRects.filter((rect): rect is HeaderTabRect & { id: string } => Boolean(rect.id) && rect.id !== draggingTabId);
  if (candidateRects.length === 0) {
    return null;
  }

  const sortedRects = [...candidateRects].sort((leftRect, rightRect) => leftRect.left - rightRect.left);
  const nextRect = sortedRects.find((rect) => clientX < rect.left + rect.width / 2);

  if (nextRect) {
    return {
      targetId: nextRect.id,
      position: 'before'
    };
  }

  const lastRect = sortedRects[sortedRects.length - 1];
  return {
    targetId: lastRect.id,
    position: 'after'
  };
}

/**
 * 根据指针靠近标签栏边缘的程度计算自动横向滚动距离。
 * @param clientX - 当前指针相对视口的横向坐标
 * @param rect - 标签栏容器矩形信息
 * @returns 本次需要叠加到 scrollLeft 的滚动距离
 */
export function getHeaderTabAutoScrollDelta(clientX: number, rect: HeaderTabScrollRect): number {
  const leftDistance = clientX - rect.left;
  const rightDistance = rect.right - clientX;

  if (leftDistance >= 0 && leftDistance < EDGE_SCROLL_ZONE_SIZE) {
    const intensity = (EDGE_SCROLL_ZONE_SIZE - leftDistance) / EDGE_SCROLL_ZONE_SIZE;
    return -Math.ceil(intensity * MAX_EDGE_SCROLL_DELTA);
  }

  if (rightDistance >= 0 && rightDistance < EDGE_SCROLL_ZONE_SIZE) {
    const intensity = (EDGE_SCROLL_ZONE_SIZE - rightDistance) / EDGE_SCROLL_ZONE_SIZE;
    return Math.ceil(intensity * MAX_EDGE_SCROLL_DELTA);
  }

  return 0;
}
