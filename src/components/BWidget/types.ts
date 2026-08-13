/**
 * @file types.ts
 * @description BWidget 独立Widget工具的类型定义。
 */
import type { BSmartValue } from '@/components/BSmart/types';

/**
 * Widget坐标点。
 */
export interface WidgetPoint {
  /** 横坐标 */
  x: number;
  /** 纵坐标 */
  y: number;
}

/**
 * 节点尺寸。
 */
export interface WidgetSize {
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
}

/**
 * Widget Vue 渲染模式。
 */
export type WidgetRenderMode = 'design' | 'runtime';

/**
 * Widget Vue 渲染上下文选项。
 */
export interface WidgetRenderContextOptions {
  /** Widget Vue 渲染模式 */
  mode?: WidgetRenderMode;
}

/**
 * 盒模型四边数值。
 */
export interface WidgetBoxSides {
  /** 上边数值 */
  top: number;
  /** 右边数值 */
  right: number;
  /** 下边数值 */
  bottom: number;
  /** 左边数值 */
  left: number;
}

/**
 * 盒模型四角圆角数值。
 */
export interface WidgetCornerRadius {
  /** 左上圆角 */
  topLeft: number;
  /** 右上圆角 */
  topRight: number;
  /** 右下圆角 */
  bottomRight: number;
  /** 左下圆角 */
  bottomLeft: number;
}

/**
 * 可统一或四边独立设置的盒模型数值。
 */
export type WidgetBoxSideValue = number | WidgetBoxSides;

/**
 * 可统一或四角独立设置的圆角数值。
 */
export type WidgetCornerRadiusValue = number | WidgetCornerRadius;

/**
 * Widget元素边框线型。
 */
export type WidgetBorderStyle = 'none' | 'solid' | 'dashed' | 'dotted';

/**
 * Widget元素文字修饰线。
 */
export type WidgetTextDecoration = 'none' | 'underline' | 'line-through';

/**
 * Widget元素文字斜体。
 */
export type WidgetFontStyle = 'normal' | 'italic';

/**
 * Widget元素样式。
 */
export interface WidgetElementStyle {
  /** CSS 源码样式，支持保存完整 CSS 声明文本 */
  css?: string;
  /** 填充色 */
  backgroundColor?: string;
  /** 描边色 */
  borderColor?: string;
  /** 描边线型 */
  borderStyle?: WidgetBorderStyle;
  /** 描边宽度，支持统一或四边独立设置 */
  borderWidth?: WidgetBoxSideValue;
  /** 圆角，支持统一或四角独立设置 */
  borderRadius?: WidgetCornerRadiusValue;
  /** 内边距，支持统一或四边独立设置 */
  padding?: WidgetBoxSideValue;
  /** 文字颜色 */
  color?: string;
  /** 文字字号 */
  fontSize?: number;
  /** 文字字重 */
  fontWeight?: number;
  /** 文字斜体 */
  fontStyle?: WidgetFontStyle;
  /** 文字行高，单位为字号倍数（如 1.5），未设置时使用默认比例 */
  lineHeight?: number;
  /** 文字修饰线 */
  textDecoration?: WidgetTextDecoration;
  /** 文字对齐方式 */
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  /** 文字垂直对齐方式 */
  textVerticalAlign?: 'top' | 'middle' | 'bottom';
  /** 透明度 */
  opacity?: number;
}

/**
 * Widget元素样式变更。
 */
export type WidgetElementStyleChange = Partial<WidgetElementStyle>;

/**
 * Widget元素循环渲染配置。
 */
export interface WidgetElementLoopConfig {
  /** 是否启用循环渲染 */
  enabled: boolean;
  /** 数组数据源静态值或变量路径 */
  source: BSmartValue<string>;
  /** 是否根据可用宽度自适应每行列数 */
  autoColumns: boolean;
  /** 每行渲染数量 */
  columns: number;
  /** 横向间距 */
  columnGap: number;
  /** 纵向间距 */
  rowGap: number;
  /** 迭代项变量名 */
  itemName: string;
  /** 索引变量名 */
  indexName: string;
}

/**
 * 元素层级操作类型。
 */
export type WidgetLayerAction = 'bringToFront' | 'bringForward' | 'sendBackward' | 'sendToBack';

/**
 * 元素创建锚点。
 */
export type WidgetElementCreateAnchor = 'center' | 'top-left';

/**
 * 根据元素 ID 选中元素的配置。
 */
export interface WidgetSelectElementByIdOptions {
  /** 组合选区内是否将该元素作为当前编辑子元素 */
  activateElement?: boolean;
}

/**
 * Widget元信息。
 */
export interface WidgetMetadata {
  /** 预留扩展字段 */
  [key: string]: unknown;
}

/**
 * WidgetJS 脚本配置。
 */
export interface WidgetExecuteMethod {
  /** 方法是否启用 */
  enabled?: boolean;
  /** 方法说明，用于编辑器提示和后续权限确认 */
  description?: string;
  /** JS 脚本代码，要求默认导出继承 Widget 的类 */
  code: string;
}

/**
 * WidgetData 支持的 schema 字段类型。
 */
export type WidgetSchemaPropertyType = 'string' | 'number' | 'boolean' | 'object' | 'array';

/**
 * WidgetData 输入与数据 schema 属性。
 */
export interface WidgetSchemaProperty {
  /** 字段类型 */
  type: WidgetSchemaPropertyType;
  /** 字段说明 */
  description?: string;
  /** 对象字段定义 */
  properties?: Record<string, WidgetSchemaProperty>;
  /** 对象字段的必填子字段 */
  required?: string[];
  /** 数组元素结构 */
  items?: WidgetSchemaProperty;
}

/**
 * WidgetData 输入与状态对象 schema。
 */
export interface WidgetSchemaObject {
  /** 顶层 schema 固定为对象 */
  type: 'object';
  /** schema 说明 */
  description?: string;
  /** 对象字段定义 */
  properties: Record<string, WidgetSchemaProperty>;
  /** 必填字段 */
  required?: string[];
}

/**
 * Widget元素。
 * @template TMetadata - 元素自定义元数据类型，必须扩展 WidgetMetadata
 */
export interface WidgetShapeElement<TMetadata extends WidgetMetadata = WidgetMetadata> {
  /** 真实元素 ID */
  id: string;
  /** 元素注册名称，组合容器固定为 group */
  name: string;
  /** 元素显示名称，来自注册配置，不支持编辑 */
  label: string;
  /** 元素图标，来自注册配置 */
  icon: string;
  /** 用户自定义中文名称 */
  title: string;
  /** 元素位置 */
  position: WidgetPoint;
  /** 元素尺寸 */
  size: WidgetSize;
  /** 旋转角度，单位为度 */
  rotation: number;
  /** 元素样式 */
  style: WidgetElementStyle;
  /** 是否锁定位置和尺寸 */
  locked?: boolean;
  /** 循环渲染配置 */
  loop: WidgetElementLoopConfig;
  /** 组件自定义元数据 */
  metadata: TMetadata;
  /** 子元素，仅 name 为 group 的组合容器使用 */
  children?: WidgetShapeElement[];
}

/**
 * Widget元素。
 * @template TMetadata - 元素自定义元数据类型，必须扩展 WidgetMetadata
 */
export type WidgetElement<TMetadata extends WidgetMetadata = WidgetMetadata> = WidgetShapeElement<TMetadata>;

/**
 * 新增形状参数。
 * @template TMetadata - 元素自定义元数据类型，必须扩展 WidgetMetadata
 */
export interface WidgetAddShapeOptions<TMetadata extends WidgetMetadata = WidgetMetadata> {
  /** 元素 ID */
  id: string;
  /** 元素注册名称 */
  name: string;
  /** 元素显示名称 */
  label: string;
  /** 用户自定义中文名称 */
  title?: string;
  /** 元素图标 */
  icon: string;
  /** 拖拽起点 */
  start: WidgetPoint;
  /** 拖拽终点 */
  end: WidgetPoint;
  /** 点击创建时的锚点 */
  createAnchor?: WidgetElementCreateAnchor;
  /** 元素初始样式 */
  style?: WidgetElementStyle;
  /** 元素默认循环渲染配置 */
  loop?: WidgetElementLoopConfig;
  /** 元素默认自定义元数据 */
  metadata?: TMetadata;
}

/**
 * 元素几何变更。
 */
export interface WidgetGeometryChange {
  /** 元素 ID */
  id: string;
  /** 新位置 */
  position?: WidgetPoint;
  /** 新尺寸 */
  size?: WidgetSize;
}

/**
 * Widget右键菜单事件载荷。
 */
export interface WidgetContextMenuPayload {
  /** 右键命中的元素 ID，空白Widget为 null */
  elementId: string | null;
  /** 浏览器坐标 */
  clientPoint: WidgetPoint;
  /** Widget坐标 */
  boardPoint: WidgetPoint;
}

/**
 * Widget视口状态。
 */
export interface WidgetViewport {
  /** 视口中心点 */
  center: WidgetPoint;
  /** 缩放比例 */
  zoom: number;
}

/**
 * Widget视口可视区域内边距。
 */
export interface WidgetViewportInset {
  /** 顶部被遮挡区域 */
  top: number;
  /** 右侧被遮挡区域 */
  right: number;
  /** 底部被遮挡区域 */
  bottom: number;
  /** 左侧被遮挡区域 */
  left: number;
}

/**
 * Widget外部双向绑定数据。
 * @template TMetadata - Widget 顶层自定义元数据类型
 */
export interface WidgetData<TMetadata extends WidgetMetadata = WidgetMetadata> {
  /** Widget能力标识符 */
  name: string;
  /** Widget能力描述 */
  description: string;
  /** Widget能力入参 schema */
  inputSchema: WidgetSchemaObject;
  /** Widget能力出参 schema */
  outputSchema: WidgetSchemaObject;
  /** Widget运行数据 schema */
  dataSchema: WidgetSchemaObject;
  /** WidgetJS 脚本配置 */
  execute: WidgetExecuteMethod;
  /** Widget元信息 */
  metadata: TMetadata;
  /** 元素数据 */
  elements: WidgetElement[];
}

/**
 * 当前设置面板可编辑目标。
 */
export type WidgetSelectTarget = WidgetElement | WidgetMetadata | null;

/**
 * BWidget组件向父级暴露的控制方法。
 */
export interface BWidgetExpose {
  /**
   * 根据注册元素和浏览器坐标创建Widget元素。
   * @param name - 元素注册名称
   * @param clientPoint - 浏览器坐标
   */
  createElementFromClientPoint: (name: string, clientPoint: WidgetPoint) => Promise<void>;
  /**
   * 根据元素 ID 选中Widget元素。
   * @param id - 元素 ID
   * @param options - 选中配置
   */
  selectElementById: (id: string, options?: WidgetSelectElementByIdOptions) => void;
  /**
   * 根据元素 ID 列表选中Widget元素。
   * @param ids - 元素 ID 列表
   */
  selectElementsByIds: (ids: string[]) => void;
  /** 复制当前Widget选区 */
  copySelection: () => void;
  /** 合并当前Widget选区 */
  groupSelection: () => void;
  /** 取消当前Widget选区中的组合 */
  ungroupSelection: () => void;
  /** 删除当前Widget选区 */
  deleteSelection: () => void;
  /**
   * 调整当前Widget选区层级。
   * @param action - 层级操作
   */
  reorderSelection: (action: WidgetLayerAction) => void;
}

/**
 * Widget历史快照。
 */
export interface WidgetBoardSnapshot {
  /** 元素快照 */
  elements: WidgetElement[];
  /** 选区快照 */
  selection: string[];
  /** 视口快照 */
  viewport: WidgetViewport;
  /** 当前交互草稿 */
  draft?: {
    /** 草稿类型 */
    kind: 'creating-shape';
    /** 元素注册名称 */
    name: string;
    /** 拖拽起点 */
    start: WidgetPoint;
    /** 当前指针点 */
    current: WidgetPoint;
  };
}

/**
 * BWidget Widget状态。
 */
export interface WidgetBoardState extends WidgetBoardSnapshot {
  /** 历史记录 */
  history: {
    /** 可撤销快照 */
    past: WidgetBoardSnapshot[];
    /** 可重做快照 */
    future: WidgetBoardSnapshot[];
  };
  /** 最近一次错误 */
  lastError?: Error;
}
