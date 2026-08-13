/**
 * @file boardTransforms.ts
 * @description BWidget Widget状态变换、历史记录与元素数据模型。
 */
import type {
  WidgetAddShapeOptions,
  WidgetBoardSnapshot,
  WidgetBoardState,
  WidgetData,
  WidgetElementCreateAnchor,
  WidgetElementLoopConfig,
  WidgetElementStyle,
  WidgetElementStyleChange,
  WidgetGeometryChange,
  WidgetLayerAction,
  WidgetPoint,
  WidgetSize,
  WidgetShapeElement
} from '../types';
import { cloneDeep, escapeRegExp, isEqual } from 'lodash-es';
import { isLiteralValue, isVariableValue } from '@/components/BSmart/utils/value';
import { WIDGET_DEFAULT_NODE_SIZE, WIDGET_MIN_CREATE_SIZE, WIDGET_MIN_ELEMENT_SIZE } from '../constants/board';
import { getWidgetElementSchema } from '../elements';
import { createDefaultWidgetViewport, normalizeWidgetDataContract, type WidgetDataContractCandidate } from './widgetData';
import { getWidgetShapeRenderSize } from './widgetGeometry';
import { normalizeWidgetElementLoopConfig } from './widgetLoop';
import {
  findElementTreeNode,
  flattenWidgetElementTree,
  getLocalPosition,
  isSameParent,
  isWidgetGroupElement,
  normalizeWidgetElementSelection,
  readWidgetElementChildren,
  removeEmptyWidgetGroups,
  removeElementFromTree,
  replaceSiblingList,
  updateElementInTree,
  type WidgetElementTreeNode,
  type WidgetRenderTreeNode
} from './widgetTree';

/** 粘贴元素未指定落点时使用的默认偏移量。 */
const WIDGET_PASTE_DEFAULT_OFFSET: WidgetPoint = { x: 16, y: 16 };
/** 组合元素注册名称。 */
const WIDGET_GROUP_ELEMENT_NAME = 'group';
/** 组合元素默认展示名称。 */
const WIDGET_GROUP_ELEMENT_LABEL = '组合';

/**
 * 归一化几何数值，减少 DOM 坐标换算带来的浮点噪声。
 * @param value - 原始数值
 * @returns 归一化数值
 */
function normalizeGeometryValue(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * 判断元素自身是否锁定几何。
 * @param element - Widget元素
 * @returns 当前元素是否锁定位置和尺寸
 */
function isWidgetElementGeometryLocked(element: WidgetShapeElement): boolean {
  return element.locked === true;
}

/**
 * Widget元素快照候选。
 */
type WidgetElementSnapshotCandidate = Partial<Omit<WidgetShapeElement, 'metadata' | 'style' | 'loop'>> & {
  /** 样式 */
  style?: Partial<WidgetElementStyle>;
  /** 循环渲染配置 */
  loop: WidgetShapeElement['loop'];
  /** 元信息 */
  metadata?: Record<string, unknown>;
  /** 子元素 */
  children?: WidgetElementSnapshotCandidate[];
};

/**
 * 粘贴元素参数。
 */
export interface WidgetPasteElementsOptions {
  /** 目标落点，按复制内容外接框左上角对齐 */
  anchorPoint?: WidgetPoint;
  /** 未指定目标落点时使用的整体偏移 */
  offset?: WidgetPoint;
  /** 粘贴目标父级元素 ID，顶层为 null 或 undefined */
  parentId?: string | null;
  /** 创建粘贴元素新 ID */
  createElementId: (element: WidgetShapeElement, index: number) => string;
}

/**
 * 元素快照克隆选项。
 */
interface WidgetElementSnapshotOptions {
  /** 是否按元素 schema 重新归一化模型尺寸 */
  normalizeSize?: boolean;
}

/**
 * Widget数据快照选项。
 */
export interface WidgetDataSnapshotOptions {
  /** 是否按元素 schema 重新归一化模型尺寸 */
  normalizeSize?: boolean;
}

/**
 * 几何变更应用选项。
 */
interface WidgetApplyGeometryChangesOptions {
  /** 是否按元素 schema 重新归一化模型尺寸 */
  normalizeSize?: boolean;
}

/**
 * Widget元素缩放选项。
 */
export interface WidgetResizeElementsOptions {
  /** 是否按元素 schema 重新归一化模型尺寸 */
  normalizeSize?: boolean;
}

/**
 * 判断坐标点是否可用于Widget元素。
 * @param point - 待检查坐标
 * @returns 是否为有效坐标
 */
function isWidgetPointLike(point: WidgetPoint | undefined): point is WidgetPoint {
  return typeof point?.x === 'number' && typeof point.y === 'number';
}

/**
 * 判断尺寸是否可用于Widget元素。
 * @param size - 待检查尺寸
 * @returns 是否为有效尺寸
 */
function isWidgetSizeLike(size: WidgetSize | undefined): size is WidgetSize {
  return typeof size?.width === 'number' && typeof size.height === 'number';
}

/**
 * 判断循环配置是否符合当前Widget元素模型。
 * @param loop - 待检查循环配置
 * @returns 是否为有效循环配置
 */
function isWidgetElementLoopConfig(loop: unknown): loop is WidgetElementLoopConfig {
  if (typeof loop !== 'object' || loop === null) {
    return false;
  }

  const candidate = loop as Partial<Record<keyof WidgetElementLoopConfig, unknown>>;

  return (
    typeof candidate.enabled === 'boolean' &&
    (isVariableValue(candidate.source) || (isLiteralValue(candidate.source) && typeof candidate.source.value === 'string')) &&
    (typeof candidate.autoColumns === 'boolean' || candidate.autoColumns === undefined) &&
    ((typeof candidate.columns === 'number' && Number.isInteger(candidate.columns) && candidate.columns > 0) || candidate.columns === 'auto') &&
    typeof candidate.columnGap === 'number' &&
    Number.isFinite(candidate.columnGap) &&
    candidate.columnGap >= 0 &&
    typeof candidate.rowGap === 'number' &&
    Number.isFinite(candidate.rowGap) &&
    candidate.rowGap >= 0 &&
    typeof candidate.itemName === 'string' &&
    typeof candidate.indexName === 'string'
  );
}

/**
 * 读取元素注册展示信息。
 * @param name - 元素注册名称
 * @returns 注册展示信息
 */
function getElementRegistryDisplay(name: string): { label: string; icon: string } {
  const schema = getWidgetElementSchema(name);

  return {
    label: schema?.label ?? name,
    icon: schema?.icon ?? 'lucide:box'
  };
}

/**
 * 归一化组件自定义元数据。
 * @param metadata - 原始元数据
 * @returns 自定义元数据
 */
function normalizeElementMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  return cloneDeep(metadata ?? {});
}

/**
 * 读取元素快照候选的子元素列表。
 * @param element - 元素快照候选
 * @returns 子元素候选列表
 */
function readElementSnapshotChildren(element: WidgetElementSnapshotCandidate): WidgetElementSnapshotCandidate[] {
  return Array.isArray(element.children) ? element.children : [];
}

/**
 * 计算元素集合外接框左上角。
 * @param elements - 元素集合
 * @returns 外接框左上角，空集合返回原点
 */
function getElementsTopLeft(elements: WidgetShapeElement[]): WidgetPoint {
  if (!elements.length) {
    return { x: 0, y: 0 };
  }

  return elements.reduce<WidgetPoint>(
    (point: WidgetPoint, element: WidgetShapeElement): WidgetPoint => ({
      x: Math.min(point.x, element.position.x),
      y: Math.min(point.y, element.position.y)
    }),
    { x: elements[0].position.x, y: elements[0].position.y }
  );
}

/**
 * 读取粘贴元素整体偏移。
 * @param elements - 待粘贴元素
 * @param options - 粘贴参数
 * @returns 位置偏移
 */
function getPasteDelta(elements: WidgetShapeElement[], options: WidgetPasteElementsOptions): WidgetPoint {
  if (options.anchorPoint) {
    const topLeft = getElementsTopLeft(elements);

    return {
      x: options.anchorPoint.x - topLeft.x,
      y: options.anchorPoint.y - topLeft.y
    };
  }

  return cloneDeep(options.offset ?? WIDGET_PASTE_DEFAULT_OFFSET);
}

/**
 * 判断元素 ID 是否发生重复。
 * @param currentIds - 当前已有 ID 集合
 * @param incomingIds - 新增 ID 列表
 * @returns 是否存在重复 ID
 */
function hasDuplicateElementIds(currentIds: Set<string>, incomingIds: string[]): boolean {
  const nextIds = new Set(currentIds);

  return incomingIds.some((id: string): boolean => {
    if (nextIds.has(id)) {
      return true;
    }

    nextIds.add(id);
    return false;
  });
}

/**
 * 递归读取元素树中的所有元素 ID。
 * @param elements - 元素树
 * @returns 元素 ID 列表
 */
function getWidgetElementTreeIds(elements: WidgetShapeElement[]): string[] {
  return flattenWidgetElementTree(elements).map((item: WidgetRenderTreeNode): string => item.element.id);
}

/**
 * 读取元素标题中的类型序号。
 * @param element - Widget元素
 * @param name - 元素注册名称
 * @param label - 元素类型展示名
 * @returns 标题序号，不匹配时返回 null
 */
function getWidgetElementTitleIndex(element: WidgetShapeElement, name: string, label: string): number | null {
  if (element.name !== name) {
    return null;
  }

  const match = element.title.match(new RegExp(`^${escapeRegExp(label)}(\\d+)$`));
  if (!match) {
    return null;
  }

  const index = Number(match[1]);

  return Number.isSafeInteger(index) && index > 0 ? index : null;
}

/**
 * 读取现有标题中指定元素类型的最大序号。
 * @param elements - Widget元素树
 * @param name - 元素注册名称
 * @param label - 元素类型展示名
 * @returns 最大标题序号
 */
function getMaxExistingWidgetElementTitleIndex(elements: WidgetShapeElement[], name: string, label: string): number {
  return flattenWidgetElementTree(elements).reduce<number>((maxIndex: number, item: WidgetRenderTreeNode): number => {
    const index = getWidgetElementTitleIndex(item.element, name, label);

    return index === null ? maxIndex : Math.max(maxIndex, index);
  }, 0);
}

/**
 * 创建组合元素标题。
 * @param elements - 当前Widget元素树
 * @returns 组合标题
 */
function createWidgetGroupTitle(elements: WidgetShapeElement[]): string {
  const existingMaxIndex = getMaxExistingWidgetElementTitleIndex(elements, WIDGET_GROUP_ELEMENT_NAME, WIDGET_GROUP_ELEMENT_LABEL);

  return `${WIDGET_GROUP_ELEMENT_LABEL}${existingMaxIndex + 1}`;
}

/**
 * 创建组合元素。
 * @param groupElementId - 组合元素 ID
 * @param title - 组合标题
 * @param position - 组合位置
 * @param size - 组合尺寸
 * @param children - 子元素列表
 * @returns 组合元素
 */
function createWidgetGroupElement(
  groupElementId: string,
  title: string,
  position: WidgetPoint,
  size: WidgetSize,
  children: WidgetShapeElement[]
): WidgetShapeElement {
  return {
    id: groupElementId,
    name: WIDGET_GROUP_ELEMENT_NAME,
    label: WIDGET_GROUP_ELEMENT_LABEL,
    icon: 'lucide:group',
    title,
    position,
    size,
    rotation: 0,
    style: { borderStyle: 'none', borderWidth: 1 },
    loop: normalizeWidgetElementLoopConfig(undefined),
    metadata: {},
    children
  };
}

/**
 * 创建同父级元素外接框。
 * @param elements - 同父级元素列表
 * @returns 外接框，空列表返回 null
 */
function createSiblingBounds(elements: WidgetShapeElement[]): { position: WidgetPoint; size: WidgetSize } | null {
  if (elements.length === 0) {
    return null;
  }

  const left = Math.min(...elements.map((element: WidgetShapeElement): number => element.position.x));
  const top = Math.min(...elements.map((element: WidgetShapeElement): number => element.position.y));
  const right = Math.max(...elements.map((element: WidgetShapeElement): number => element.position.x + element.size.width));
  const bottom = Math.max(...elements.map((element: WidgetShapeElement): number => element.position.y + element.size.height));

  return {
    position: { x: left, y: top },
    size: { width: right - left, height: bottom - top }
  };
}

/**
 * 将元素位置转换为相对组合左上角的局部坐标。
 * @param element - 原元素
 * @param groupPosition - 组合位置
 * @returns 转换后的元素
 */
function createGroupChildElement(element: WidgetShapeElement, groupPosition: WidgetPoint): WidgetShapeElement {
  return {
    ...cloneDeep(element),
    position: {
      x: normalizeGeometryValue(element.position.x - groupPosition.x),
      y: normalizeGeometryValue(element.position.y - groupPosition.y)
    }
  };
}

/**
 * 将组合内子元素提升到组合父级坐标系。
 * @param child - 组合内子元素
 * @param groupPosition - 组合位置
 * @returns 提升后的元素
 */
function createUngroupedChildElement(child: WidgetShapeElement, groupPosition: WidgetPoint): WidgetShapeElement {
  return {
    ...cloneDeep(child),
    position: {
      x: normalizeGeometryValue(groupPosition.x + child.position.x),
      y: normalizeGeometryValue(groupPosition.y + child.position.y)
    }
  };
}

/**
 * 按父级缩放比例缩放子元素几何。
 * @param element - 子元素
 * @param scaleX - 横向缩放比例
 * @param scaleY - 纵向缩放比例
 * @returns 缩放后的子元素
 */
function scaleChildElementGeometry(element: WidgetShapeElement, scaleX: number, scaleY: number): WidgetShapeElement {
  const nextElement: WidgetShapeElement = {
    ...element,
    position: {
      x: normalizeGeometryValue(element.position.x * scaleX),
      y: normalizeGeometryValue(element.position.y * scaleY)
    },
    size: {
      width: Math.max(WIDGET_MIN_ELEMENT_SIZE.width, normalizeGeometryValue(element.size.width * scaleX)),
      height: Math.max(WIDGET_MIN_ELEMENT_SIZE.height, normalizeGeometryValue(element.size.height * scaleY))
    }
  };
  const children = readWidgetElementChildren(element);
  if (children.length > 0) {
    nextElement.children = children.map((child: WidgetShapeElement): WidgetShapeElement => scaleChildElementGeometry(child, scaleX, scaleY));
  }

  return nextElement;
}

/**
 * 递归生成复制元素 ID。
 * @param element - 原元素
 * @param createElementId - ID 生成器
 * @param nextIndexRef - 当前 ID 序号
 * @returns 复制后的元素
 */
function createPastedElementWithFreshIds(
  element: WidgetShapeElement,
  createElementId: WidgetPasteElementsOptions['createElementId'],
  nextIndexRef: { value: number }
): WidgetShapeElement {
  const nextElement = cloneDeep(element);
  nextElement.id = createElementId(element, nextIndexRef.value);
  nextIndexRef.value += 1;

  const children = readWidgetElementChildren(element);
  if (children.length > 0) {
    nextElement.children = children.map(
      (child: WidgetShapeElement): WidgetShapeElement => createPastedElementWithFreshIds(child, createElementId, nextIndexRef)
    );
  }

  return nextElement;
}

/**
 * 交换元素数组中的两个位置。
 * @param elements - 元素数组
 * @param fromIndex - 第一个位置
 * @param toIndex - 第二个位置
 */
function swapElements(elements: WidgetShapeElement[], fromIndex: number, toIndex: number): void {
  const current = elements[fromIndex];
  elements[fromIndex] = elements[toIndex];
  elements[toIndex] = current;
}

/**
 * 将选中元素向上一层移动。
 * @param elements - 元素列表
 * @param selectedIds - 选中 ID 集合
 * @returns 调整后的元素列表
 */
function bringSelectionForward(elements: WidgetShapeElement[], selectedIds: Set<string>): WidgetShapeElement[] {
  const nextElements = cloneDeep(elements);

  for (let index = nextElements.length - 2; index >= 0; index -= 1) {
    const current = nextElements[index];
    const above = nextElements[index + 1];
    if (selectedIds.has(current.id) && !selectedIds.has(above.id)) {
      swapElements(nextElements, index, index + 1);
    }
  }

  return nextElements;
}

/**
 * 将选中元素向下一层移动。
 * @param elements - 元素列表
 * @param selectedIds - 选中 ID 集合
 * @returns 调整后的元素列表
 */
function sendSelectionBackward(elements: WidgetShapeElement[], selectedIds: Set<string>): WidgetShapeElement[] {
  const nextElements = cloneDeep(elements);

  for (let index = 1; index < nextElements.length; index += 1) {
    const current = nextElements[index];
    const below = nextElements[index - 1];
    if (selectedIds.has(current.id) && !selectedIds.has(below.id)) {
      swapElements(nextElements, index, index - 1);
    }
  }

  return nextElements;
}

/**
 * 按元素 schema 的尺寸来源同步模型尺寸。
 * @param element - 原始元素
 * @returns 已同步模型尺寸的元素
 */
function normalizeElementModelSize(element: WidgetShapeElement): WidgetShapeElement {
  return {
    ...element,
    size: getWidgetShapeRenderSize(element)
  };
}

/**
 * 创建当前元素模型快照。
 * @param element - 元素快照候选
 * @param options - 元素快照克隆选项
 * @returns 元素快照，无法识别时返回 null
 */
function createSupportedElementSnapshot(element: WidgetElementSnapshotCandidate, options: WidgetElementSnapshotOptions = {}): WidgetShapeElement | null {
  if (
    typeof element.name !== 'string' ||
    typeof element.id !== 'string' ||
    !isWidgetPointLike(element.position) ||
    !isWidgetSizeLike(element.size) ||
    !isWidgetElementLoopConfig(element.loop)
  ) {
    return null;
  }

  const registryDisplay = getElementRegistryDisplay(element.name);
  const label = typeof element.label === 'string' ? element.label : registryDisplay.label;
  const icon = typeof element.icon === 'string' ? element.icon : registryDisplay.icon;

  const supportedElement: WidgetShapeElement = {
    id: element.id,
    name: element.name,
    label,
    icon,
    title: typeof element.title === 'string' ? element.title : label,
    position: cloneDeep(element.position),
    size: cloneDeep(element.size),
    rotation: typeof element.rotation === 'number' ? element.rotation : 0,
    style: cloneDeep(element.style ?? {}),
    loop: normalizeWidgetElementLoopConfig(element.loop),
    metadata: normalizeElementMetadata(element.metadata)
  };
  if (element.locked === true) {
    supportedElement.locked = true;
  }

  const children = isWidgetGroupElement(supportedElement)
    ? readElementSnapshotChildren(element)
        .map((child: WidgetElementSnapshotCandidate): WidgetShapeElement | null => createSupportedElementSnapshot(child, options))
        .filter((child: WidgetShapeElement | null): child is WidgetShapeElement => child !== null)
    : [];
  if (children.length > 0) {
    supportedElement.children = children;
  }

  return options.normalizeSize ?? true ? normalizeElementModelSize(supportedElement) : supportedElement;
}

/**
 * 仅保留当前支持的形状元素。
 * @param elements - 输入元素列表
 * @param options - 元素快照克隆选项
 * @returns 形状元素列表
 */
function cloneSupportedElements(elements: WidgetElementSnapshotCandidate[] | undefined, options: WidgetElementSnapshotOptions = {}): WidgetShapeElement[] {
  return (elements ?? [])
    .map((element: WidgetElementSnapshotCandidate): WidgetShapeElement | null => createSupportedElementSnapshot(element, options))
    .filter((element: WidgetShapeElement | null): element is WidgetShapeElement => element !== null);
}

/**
 * 创建Widget快照。
 * @param state - Widget状态
 * @returns 快照
 */
function createSnapshot(state: WidgetBoardSnapshot): WidgetBoardSnapshot {
  return {
    elements: cloneSupportedElements(state.elements),
    selection: [...state.selection],
    viewport: cloneDeep(state.viewport)
  };
}

/**
 * 创建形状初始样式。
 * @param style - 外部传入样式
 * @returns 初始样式
 */
function createShapeInitialStyle(style?: WidgetElementStyle): WidgetElementStyle {
  return cloneDeep(style ?? {});
}

/**
 * 根据拖拽起止点计算形状几何。
 * @param start - 拖拽起点
 * @param end - 拖拽终点
 * @returns 归一化后的元素位置和尺寸
 */
function createShapeGeometry(
  start: WidgetPoint,
  end: WidgetPoint,
  createAnchor: WidgetElementCreateAnchor = 'center'
): { position: WidgetPoint; size: WidgetSize } {
  const width = normalizeGeometryValue(Math.abs(end.x - start.x));
  const height = normalizeGeometryValue(Math.abs(end.y - start.y));
  const center = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2
  };
  const shouldUseDefaultSize = width < WIDGET_MIN_CREATE_SIZE || height < WIDGET_MIN_CREATE_SIZE;
  const size = shouldUseDefaultSize
    ? WIDGET_DEFAULT_NODE_SIZE
    : {
        width,
        height
      };

  if (createAnchor === 'top-left') {
    return {
      position: {
        x: normalizeGeometryValue(start.x),
        y: normalizeGeometryValue(start.y)
      },
      size
    };
  }

  if (shouldUseDefaultSize) {
    return {
      position: {
        x: normalizeGeometryValue(center.x - WIDGET_DEFAULT_NODE_SIZE.width / 2),
        y: normalizeGeometryValue(center.y - WIDGET_DEFAULT_NODE_SIZE.height / 2)
      },
      size
    };
  }

  return {
    position: {
      x: normalizeGeometryValue(Math.min(start.x, end.x)),
      y: normalizeGeometryValue(Math.min(start.y, end.y))
    },
    size
  };
}

/**
 * 创建带历史记录的新状态。
 * @param previous - 之前状态
 * @param next - 新快照
 * @returns 新状态
 */
function withHistory(previous: WidgetBoardState, next: WidgetBoardSnapshot): WidgetBoardState {
  return {
    ...next,
    history: {
      past: [...previous.history.past, createSnapshot(previous)],
      future: []
    },
    lastError: undefined
  };
}

/**
 * 创建错误状态。
 * @param state - 原状态
 * @param error - 错误
 * @returns 带错误的新状态
 */
function withError(state: WidgetBoardState, error: Error): WidgetBoardState {
  return {
    ...state,
    history: {
      past: [...state.history.past],
      future: [...state.history.future]
    },
    lastError: error
  };
}

/**
 * 查找并应用元素几何变更。
 * @param state - 当前Widget状态
 * @param changes - 几何变更列表
 * @param applyChange - 单个元素应用逻辑
 * @returns 新Widget状态
 */
function applyGeometryChanges(
  state: WidgetBoardState,
  changes: WidgetGeometryChange[],
  applyChange: (element: WidgetShapeElement, change: WidgetGeometryChange) => void,
  options: WidgetApplyGeometryChangesOptions = {}
): WidgetBoardState {
  const nextElements = cloneDeep(state.elements);

  for (const change of changes) {
    const node = findElementTreeNode(nextElements, change.id);
    if (!node) {
      return withError(state, new Error(`找不到元素: ${change.id}`));
    }

    if (isWidgetElementGeometryLocked(node.element)) {
      continue;
    }

    applyChange(node.element, change);
    if (options.normalizeSize ?? true) {
      node.element.size = normalizeElementModelSize(node.element).size;
    }
  }

  if (isEqual(nextElements, state.elements)) {
    return state;
  }

  return withHistory(state, {
    elements: nextElements,
    selection: [...state.selection],
    viewport: cloneDeep(state.viewport)
  });
}

/**
 * 创建初始Widget状态。
 * @param snapshot - 初始快照
 * @returns Widget状态
 */
export function createWidgetBoardState(snapshot?: Partial<WidgetBoardSnapshot>): WidgetBoardState {
  return {
    elements: cloneSupportedElements(snapshot?.elements),
    selection: [...(snapshot?.selection ?? [])],
    viewport: cloneDeep(snapshot?.viewport ?? createDefaultWidgetViewport()),
    draft: cloneDeep(snapshot?.draft),
    history: {
      past: [],
      future: []
    }
  };
}

/**
 * 替换Widget元素树并记录历史。
 * @param state - 当前Widget状态
 * @param elements - 最新元素树
 * @returns 更新后的Widget状态
 */
export function replaceWidgetElements(state: WidgetBoardState, elements: WidgetShapeElement[]): WidgetBoardState {
  const nextElements = cloneSupportedElements(elements);
  if (isEqual(nextElements, state.elements)) {
    return state;
  }

  return withHistory(state, {
    elements: nextElements,
    selection: normalizeWidgetElementSelection(nextElements, state.selection),
    viewport: cloneDeep(state.viewport)
  });
}

/**
 * 创建供外部双向绑定和持久化使用的轻量Widget数据。
 * @param snapshot - Widget快照或状态
 * @param options - Widget数据快照选项
 * @returns Widget绑定数据
 */
export function createWidgetDataSnapshot(
  snapshot: Pick<WidgetBoardSnapshot, 'elements'> & WidgetDataContractCandidate,
  options: WidgetDataSnapshotOptions = {}
): WidgetData {
  return {
    ...normalizeWidgetDataContract(snapshot),
    elements: cloneSupportedElements(snapshot.elements, options)
  };
}

/**
 * 新增一个自由形状元素。
 * @param state - 当前Widget状态
 * @param options - 新形状参数
 * @returns 新Widget状态
 */
export function addWidgetShape(state: WidgetBoardState, options: WidgetAddShapeOptions): WidgetBoardState {
  if (state.elements.some((element) => element.id === options.id)) {
    return withError(state, new Error(`元素已存在: ${options.id}`));
  }

  const style = createShapeInitialStyle(options.style);
  const geometry = createShapeGeometry(options.start, options.end, options.createAnchor);
  const element: WidgetShapeElement = normalizeElementModelSize({
    id: options.id,
    name: options.name,
    label: options.label,
    icon: options.icon,
    title: options.title ?? options.label,
    position: cloneDeep(geometry.position),
    size: cloneDeep(geometry.size),
    rotation: 0,
    style,
    loop: normalizeWidgetElementLoopConfig(options.loop),
    metadata: normalizeElementMetadata(options.metadata)
  });

  return withHistory(state, {
    elements: [...cloneDeep(state.elements), element],
    selection: [element.id],
    viewport: cloneDeep(state.viewport)
  });
}

/**
 * 撤销Widget操作。
 * @param state - 当前Widget状态
 * @returns 新Widget状态
 */
export function undoWidgetBoard(state: WidgetBoardState): WidgetBoardState {
  const previous = state.history.past.at(-1);
  if (!previous) {
    return state;
  }

  return {
    ...createSnapshot(previous),
    history: {
      past: state.history.past.slice(0, -1),
      future: [createSnapshot(state), ...state.history.future]
    },
    lastError: undefined
  };
}

/**
 * 重做Widget操作。
 * @param state - 当前Widget状态
 * @returns 新Widget状态
 */
export function redoWidgetBoard(state: WidgetBoardState): WidgetBoardState {
  const next = state.history.future[0];
  if (!next) {
    return state;
  }

  return {
    ...createSnapshot(next),
    history: {
      past: [...state.history.past, createSnapshot(state)],
      future: state.history.future.slice(1)
    },
    lastError: undefined
  };
}

/**
 * 移动Widget元素。
 * @param state - 当前Widget状态
 * @param changes - 位置变更
 * @returns 新Widget状态
 */
export function moveWidgetElements(state: WidgetBoardState, changes: WidgetGeometryChange[]): WidgetBoardState {
  return applyGeometryChanges(state, changes, (element: WidgetShapeElement, change: WidgetGeometryChange): void => {
    if (!change.position) {
      return;
    }

    element.position = {
      x: normalizeGeometryValue(change.position.x),
      y: normalizeGeometryValue(change.position.y)
    };
  });
}

/**
 * 缩放Widget元素。
 * @param state - 当前Widget状态
 * @param changes - 尺寸变更
 * @param options - 缩放选项
 * @returns 新Widget状态
 */
export function resizeWidgetElements(state: WidgetBoardState, changes: WidgetGeometryChange[], options: WidgetResizeElementsOptions = {}): WidgetBoardState {
  return applyGeometryChanges(
    state,
    changes,
    (element: WidgetShapeElement, change: WidgetGeometryChange): void => {
      const previousSize = cloneDeep(element.size);
      if (change.position) {
        element.position = {
          x: normalizeGeometryValue(change.position.x),
          y: normalizeGeometryValue(change.position.y)
        };
      }

      if (change.size) {
        element.size = {
          width: Math.max(WIDGET_MIN_ELEMENT_SIZE.width, normalizeGeometryValue(change.size.width)),
          height: Math.max(WIDGET_MIN_ELEMENT_SIZE.height, normalizeGeometryValue(change.size.height))
        };
      }

      if (change.size && isWidgetGroupElement(element)) {
        const scaleX = previousSize.width === 0 ? 1 : element.size.width / previousSize.width;
        const scaleY = previousSize.height === 0 ? 1 : element.size.height / previousSize.height;
        element.children = readWidgetElementChildren(element).map(
          (child: WidgetShapeElement): WidgetShapeElement => scaleChildElementGeometry(child, scaleX, scaleY)
        );
      }
    },
    options
  );
}

/**
 * 更新Widget元素样式。
 * @param state - 当前Widget状态
 * @param elementId - 元素 ID
 * @param style - 样式变更
 * @returns 新Widget状态
 */
export function updateWidgetElementStyle(state: WidgetBoardState, elementId: string, style: WidgetElementStyleChange): WidgetBoardState {
  const elementNode = findElementTreeNode(state.elements, elementId);
  if (!elementNode) {
    return withError(state, new Error(`找不到元素: ${elementId}`));
  }

  const nextElements = updateElementInTree(
    state.elements,
    elementId,
    (element: WidgetShapeElement): WidgetShapeElement =>
      normalizeElementModelSize({
        ...element,
        style: {
          ...element.style,
          ...style
        }
      })
  );

  return withHistory(state, {
    elements: nextElements,
    selection: [...state.selection],
    viewport: cloneDeep(state.viewport)
  });
}

/**
 * 设置当前选区元素的位置尺寸锁定状态。
 * @param state - 当前Widget状态
 * @param locked - 是否锁定位置和尺寸
 * @returns 新Widget状态
 */
export function setWidgetSelectionLocked(state: WidgetBoardState, locked: boolean): WidgetBoardState {
  const selection = normalizeWidgetElementSelection(state.elements, state.selection);
  if (!selection.length) {
    return state;
  }

  const nextElements = selection.reduce<WidgetShapeElement[]>((elements: WidgetShapeElement[], elementId: string): WidgetShapeElement[] => {
    return updateElementInTree(elements, elementId, (element: WidgetShapeElement): WidgetShapeElement => {
      const nextElement = cloneDeep(element);
      if (locked) {
        nextElement.locked = true;
        return nextElement;
      }

      delete nextElement.locked;
      return nextElement;
    });
  }, state.elements);

  if (isEqual(nextElements, state.elements)) {
    return state;
  }

  return withHistory(state, {
    elements: nextElements,
    selection,
    viewport: cloneDeep(state.viewport)
  });
}

/**
 * 删除当前选中元素。
 * @param state - 当前Widget状态
 * @returns 新Widget状态
 */
export function deleteWidgetSelection(state: WidgetBoardState): WidgetBoardState {
  if (!state.selection.length) {
    return state;
  }

  const nextElements = state.selection.reduce<WidgetShapeElement[]>((elements: WidgetShapeElement[], elementId: string): WidgetShapeElement[] => {
    return removeElementFromTree(elements, elementId).elements;
  }, state.elements);

  return withHistory(state, {
    elements: removeEmptyWidgetGroups(nextElements),
    selection: [],
    viewport: cloneDeep(state.viewport)
  });
}

/**
 * 复制当前选区元素。
 * @param state - 当前Widget状态
 * @returns 已复制元素快照
 */
export function copyWidgetSelection(state: WidgetBoardState): WidgetShapeElement[] {
  const selected = new Set(normalizeWidgetElementSelection(state.elements, state.selection));

  return cloneDeep(
    flattenWidgetElementTree(state.elements)
      .filter((item: WidgetRenderTreeNode): boolean => selected.has(item.element.id))
      .map((item: WidgetRenderTreeNode): WidgetShapeElement => item.element)
  );
}

/**
 * 粘贴元素快照。
 * @param state - 当前Widget状态
 * @param elements - 待粘贴元素
 * @param options - 粘贴参数
 * @returns 新Widget状态
 */
export function pasteWidgetElements(state: WidgetBoardState, elements: WidgetShapeElement[], options: WidgetPasteElementsOptions): WidgetBoardState {
  if (!elements.length) {
    return state;
  }

  const parentId = options.parentId ?? null;
  const parentNode = parentId === null ? null : findElementTreeNode(state.elements, parentId);
  if (parentId !== null && !parentNode) {
    return withError(state, new Error(`找不到父级元素: ${parentId}`));
  }
  if (parentNode && !isWidgetGroupElement(parentNode.element)) {
    return withError(state, new Error(`粘贴目标不是组合: ${parentId}`));
  }

  const localAnchorPoint = options.anchorPoint ? getLocalPosition(state.elements, parentId, options.anchorPoint) : undefined;
  const delta = getPasteDelta(elements, {
    ...options,
    anchorPoint: localAnchorPoint
  });
  const nextIndexRef = { value: 0 };
  const pastedElements = elements.map((element: WidgetShapeElement): WidgetShapeElement => {
    const pastedElement = createPastedElementWithFreshIds(element, options.createElementId, nextIndexRef);

    return normalizeElementModelSize({
      ...pastedElement,
      position: {
        x: normalizeGeometryValue(element.position.x + delta.x),
        y: normalizeGeometryValue(element.position.y + delta.y)
      }
    });
  });
  const pastedIds = pastedElements.map((element: WidgetShapeElement): string => element.id);

  if (hasDuplicateElementIds(new Set(getWidgetElementTreeIds(state.elements)), getWidgetElementTreeIds(pastedElements))) {
    return withError(state, new Error('粘贴元素 ID 重复'));
  }

  const targetSiblings = parentNode ? readWidgetElementChildren(parentNode.element) : state.elements;
  const nextElements = replaceSiblingList(state.elements, parentId, [...cloneDeep(targetSiblings), ...pastedElements]);

  return withHistory(state, {
    elements: nextElements,
    selection: pastedIds,
    viewport: cloneDeep(state.viewport)
  });
}

/**
 * 将当前选区合并为组合。
 * @param state - 当前Widget状态
 * @param groupElementId - 新组合元素 ID
 * @returns 新Widget状态
 */
export function groupWidgetSelection(state: WidgetBoardState, groupElementId: string): WidgetBoardState {
  const selection = [...state.selection];
  if (selection.length < 2) {
    return state;
  }

  if (!isSameParent(state.elements, selection)) {
    return withError(state, new Error('只能组合相同父级下的元素'));
  }

  const firstNode = findElementTreeNode(state.elements, selection[0]);
  if (!firstNode) {
    return withError(state, new Error(`找不到元素: ${selection[0]}`));
  }

  const selectedIds = new Set(selection);
  const selectedElements = firstNode.siblings.filter((element: WidgetShapeElement): boolean => selectedIds.has(element.id));
  const bounds = createSiblingBounds(selectedElements);
  if (!bounds) {
    return state;
  }

  const groupElement = createWidgetGroupElement(
    groupElementId,
    createWidgetGroupTitle(state.elements),
    cloneDeep(bounds.position),
    cloneDeep(bounds.size),
    selectedElements.map((element: WidgetShapeElement): WidgetShapeElement => createGroupChildElement(element, bounds.position))
  );
  let insertedGroup = false;
  const nextSiblings = firstNode.siblings.reduce<WidgetShapeElement[]>((siblings: WidgetShapeElement[], element: WidgetShapeElement): WidgetShapeElement[] => {
    if (!selectedIds.has(element.id)) {
      siblings.push(cloneDeep(element));
      return siblings;
    }

    if (!insertedGroup) {
      siblings.push(groupElement);
      insertedGroup = true;
    }

    return siblings;
  }, []);
  const nextElements = replaceSiblingList(state.elements, firstNode.parentId, nextSiblings);

  return withHistory(state, {
    elements: nextElements,
    selection: [groupElementId],
    viewport: cloneDeep(state.viewport)
  });
}

/**
 * 取消当前选区命中的组合。
 * @param state - 当前Widget状态
 * @returns 新Widget状态
 */
export function ungroupWidgetSelection(state: WidgetBoardState): WidgetBoardState {
  const groupNodes = state.selection
    .map((elementId: string): WidgetElementTreeNode | null => findElementTreeNode(state.elements, elementId))
    .filter((node: WidgetElementTreeNode | null): node is WidgetElementTreeNode => node !== null && isWidgetGroupElement(node.element));

  if (groupNodes.length === 0) {
    return state;
  }

  const nextSelection: string[] = [];
  let nextElements = cloneDeep(state.elements);
  groupNodes.forEach((groupNode: WidgetElementTreeNode): void => {
    const currentGroupNode = findElementTreeNode(nextElements, groupNode.element.id);
    if (!currentGroupNode) {
      return;
    }

    const promotedChildren = readWidgetElementChildren(currentGroupNode.element).map((child: WidgetShapeElement): WidgetShapeElement => {
      const promotedChild = createUngroupedChildElement(child, currentGroupNode.element.position);
      nextSelection.push(promotedChild.id);
      return promotedChild;
    });
    const nextSiblings = currentGroupNode.siblings.flatMap((element: WidgetShapeElement): WidgetShapeElement[] =>
      element.id === currentGroupNode.element.id ? promotedChildren : [cloneDeep(element)]
    );
    nextElements = replaceSiblingList(nextElements, currentGroupNode.parentId, nextSiblings);
  });

  return withHistory(state, {
    elements: nextElements,
    selection: nextSelection,
    viewport: cloneDeep(state.viewport)
  });
}

/**
 * 更新元素自定义名称。
 * @param state - 当前Widget状态
 * @param elementId - 元素 ID
 * @param title - 新名称
 * @returns 新Widget状态
 */
export function updateWidgetElementTitle(state: WidgetBoardState, elementId: string, title: string): WidgetBoardState {
  const elementNode = findElementTreeNode(state.elements, elementId);
  if (!elementNode) {
    return withError(state, new Error(`找不到元素: ${elementId}`));
  }

  const nextElements = updateElementInTree(
    state.elements,
    elementId,
    (element: WidgetShapeElement): WidgetShapeElement =>
      normalizeElementModelSize({
        ...element,
        title
      })
  );

  return withHistory(state, {
    elements: nextElements,
    selection: [...state.selection],
    viewport: cloneDeep(state.viewport)
  });
}

/**
 * 调整元素层级顺序。
 * 元素数组中索引越大，渲染层级越高（显示在上层）。
 * @param state - 当前Widget状态
 * @param elementId - 目标元素 ID
 * @param action - 层级操作类型
 * @returns 新Widget状态
 */
export function reorderWidgetElement(state: WidgetBoardState, elementId: string, action: WidgetLayerAction): WidgetBoardState {
  const elementNode = findElementTreeNode(state.elements, elementId);
  if (!elementNode) {
    return withError(state, new Error(`找不到元素: ${elementId}`));
  }

  const nextSiblings = cloneDeep(elementNode.siblings);
  const [element] = nextSiblings.splice(elementNode.index, 1);
  if (!element) {
    return withError(state, new Error(`找不到元素: ${elementId}`));
  }

  switch (action) {
    case 'bringToFront': {
      // 移到数组末尾（最顶层）
      nextSiblings.push(element);
      break;
    }
    case 'bringForward': {
      // 上移一层（索引 +1）
      const targetIndex = Math.min(elementNode.index + 1, nextSiblings.length);
      nextSiblings.splice(targetIndex, 0, element);
      break;
    }
    case 'sendBackward': {
      // 下移一层（索引 -1）
      const targetIndex = Math.max(elementNode.index - 1, 0);
      nextSiblings.splice(targetIndex, 0, element);
      break;
    }
    case 'sendToBack': {
      // 移到数组开头（最底层）
      nextSiblings.unshift(element);
      break;
    }
    default: {
      // 未知操作，放回原位
      nextSiblings.splice(elementNode.index, 0, element);
      break;
    }
  }
  const nextElements = replaceSiblingList(state.elements, elementNode.parentId, nextSiblings);

  return withHistory(state, {
    elements: nextElements,
    selection: [...state.selection],
    viewport: cloneDeep(state.viewport)
  });
}

/**
 * 调整当前选区层级顺序。
 * @param state - 当前Widget状态
 * @param action - 层级操作类型
 * @returns 新Widget状态
 */
export function reorderWidgetSelection(state: WidgetBoardState, action: WidgetLayerAction): WidgetBoardState {
  const selection = state.selection.filter((elementId: string): boolean => findElementTreeNode(state.elements, elementId) !== null);
  if (!selection.length) {
    return state;
  }
  if (!isSameParent(state.elements, selection)) {
    return withError(state, new Error('只能调整相同父级下的元素层级'));
  }

  const firstNode = findElementTreeNode(state.elements, selection[0]);
  if (!firstNode) {
    return state;
  }

  const selectedIds = new Set(selection);
  const selectedElements = firstNode.siblings.filter((element: WidgetShapeElement): boolean => selectedIds.has(element.id));
  const unselectedElements = firstNode.siblings.filter((element: WidgetShapeElement): boolean => !selectedIds.has(element.id));
  let nextSiblings: WidgetShapeElement[];

  switch (action) {
    case 'bringToFront': {
      nextSiblings = [...cloneDeep(unselectedElements), ...cloneDeep(selectedElements)];
      break;
    }
    case 'sendToBack': {
      nextSiblings = [...cloneDeep(selectedElements), ...cloneDeep(unselectedElements)];
      break;
    }
    case 'bringForward': {
      nextSiblings = bringSelectionForward(firstNode.siblings, selectedIds);
      break;
    }
    case 'sendBackward': {
      nextSiblings = sendSelectionBackward(firstNode.siblings, selectedIds);
      break;
    }
    default: {
      nextSiblings = cloneDeep(firstNode.siblings);
      break;
    }
  }
  const nextElements = replaceSiblingList(state.elements, firstNode.parentId, nextSiblings);

  return withHistory(state, {
    elements: nextElements,
    selection,
    viewport: cloneDeep(state.viewport)
  });
}
