/**
 * @file types.ts
 * @description BCommandPanel 的 scope、source、结果项与打开配置类型定义。
 */
import type { VNodeChild } from 'vue';
import type { SelectedModel } from '@/stores/ai/serviceModel';

/**
 * 命令面板打开入口的业务范围。
 */
export type CommandPanelScope = 'recent' | 'model';

/**
 * 命令面板 source 标识。
 */
export type CommandPanelSourceId = 'recent' | 'model' | 'jump' | 'chat' | 'hint';

/**
 * 输入路由解析结果。
 */
export interface CommandPanelQueryRoute {
  /** 当前输入应使用的 source。 */
  sourceId: CommandPanelSourceId;
  /** 传给 source 的搜索词。 */
  keyword: string;
}

/**
 * 图标渲染上下文。
 */
export interface CommandPanelIconContext {
  /** 图标元素应附加的类名。 */
  className: string;
  /** 图标尺寸。 */
  size: number;
}

/**
 * 命令面板结果项类型。
 */
export type CommandPanelItemKind = 'file' | 'widget' | 'webview' | 'chat' | 'absolute-path' | 'url' | 'jump' | 'model';

/**
 * 命令面板结果项公共字段。
 */
export interface CommandPanelItemBase {
  /** 列表项唯一键。 */
  key: string;
  /** 列表项类型。 */
  kind: CommandPanelItemKind;
  /** 主标题。 */
  title: string;
  /** 描述信息，通常展示路径、URL 或命令说明。 */
  description?: string;
  /** 描述信息状态类。 */
  descriptionClass?: string;
  /** 右侧辅助文案。 */
  meta?: string;
  /** 是否为当前激活项。 */
  active?: boolean;
  /** 是否隐藏左侧图标。 */
  hideIcon?: boolean;
  /** 自定义图标渲染函数。 */
  renderIcon?: (context: CommandPanelIconContext) => VNodeChild;
}

/**
 * 执行动作的命令面板结果项。
 */
export interface CommandPanelActionItem extends CommandPanelItemBase {
  /** 非 jump 类型都必须提供选择动作。 */
  kind: Exclude<CommandPanelItemKind, 'jump'>;
  /** 是否展示删除按钮。 */
  removable?: boolean;
  /** 选择后是否关闭面板，默认关闭。 */
  closeOnSelect?: boolean;
  /** 选择结果项时执行的动作。 */
  onSelect: () => Promise<void> | void;
  /** 删除结果项时执行的动作。 */
  onRemove?: () => Promise<void> | void;
}

/**
 * 跳转语法结果项，由面板内部处理输入切换。
 */
export interface CommandPanelJumpItem extends CommandPanelItemBase {
  /** 跳转项固定类型。 */
  kind: 'jump';
  /** 不含尾空格的目标输入前缀。 */
  routeInput: string;
}

/**
 * 命令面板结果项。
 */
export type CommandPanelItem = CommandPanelActionItem | CommandPanelJumpItem;

/**
 * 命令面板结果分组。
 */
export interface CommandPanelGroup {
  /** 分组唯一键。 */
  key: string;
  /** 分组标题；为空时不展示标题。 */
  title?: string;
  /** 分组内结果项。 */
  items: CommandPanelItem[];
}

/**
 * 命令面板数据源接口。
 */
export interface CommandPanelSource {
  /** 数据源标识。 */
  id: CommandPanelSourceId;
  /** 加载 source 所需数据，必须可重复调用。 */
  load: () => Promise<void> | void;
  /** 按关键字返回结果分组。 */
  search: (keyword: string) => Promise<CommandPanelGroup[]> | CommandPanelGroup[];
}

/**
 * 命令面板打开参数。
 */
export interface OpenCommandPanelOptions {
  /** 面板关闭后的运行时回调。 */
  onClose?: () => void;
}

/**
 * 模型 scope 的调用方运行时上下文。
 */
export interface CommandPanelModelContext {
  /** 读取调用方当前模型。 */
  getCurrentModel: () => SelectedModel | undefined;
  /** 使用调用方规则切换模型。 */
  onModelChange: (model: SelectedModel) => Promise<void>;
}

/**
 * 模型命令面板打开参数。
 */
export interface OpenModelCommandPanelOptions extends OpenCommandPanelOptions {
  /** 可选的调用方模型上下文；缺失时使用全局默认模型。 */
  modelContext?: CommandPanelModelContext;
}
