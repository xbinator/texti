/**
 * @file toolResultSummary.ts
 * @description 工具执行结果摘要解析模块，将已知工具的结构化结果转换为人可读的摘要信息，
 * 用于在气泡中展示简明内容，避免直接暴露原始 JSON。
 */
import type { AIToolExecutionResult } from 'types/ai';

/**
 * 从完整路径中提取文件名。
 * @param filePath - 完整文件路径
 * @returns 文件名部分
 */
function toFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  return segments[segments.length - 1] || filePath;
}

/**
 * 工具结果摘要标签动作。
 */
export type ToolSummaryTagAction = 'openFile';

/**
 * 工具结果摘要标签项。
 */
export interface ToolSummaryTag {
  /** 标签名称 */
  label: string;
  /** 标签值 */
  value: string;
  /** 标签触发的 UI 动作 */
  action?: ToolSummaryTagAction;
  /** 动作关联的文件路径 */
  path?: string;
}

/**
 * 创建可打开文件的摘要标签。
 * @param filePath - 文件完整路径
 * @returns 可打开文件标签
 */
function createOpenFileTag(filePath: string): ToolSummaryTag {
  return {
    label: '文件',
    value: toFileName(filePath),
    action: 'openFile',
    path: filePath
  };
}

/**
 * 工具结果摘要样式变体。
 */
export type ToolSummaryVariant = 'success' | 'failure' | 'cancelled';

/**
 * 工具结果摘要。
 */
export interface ToolResultSummary {
  /** 摘要主文本 */
  text?: string;
  /** 可选的标签列表 */
  tags?: ToolSummaryTag[];
  /** 摘要样式变体，默认 success */
  variant?: ToolSummaryVariant;
}

/** 设置键的中文映射 */
const SETTINGS_KEY_LABEL_MAP: Record<string, string> = {
  theme: '主题',
  sourceMode: '源码模式',
  editorPageWidth: '页宽'
};

/** 主题值的中文映射 */
const THEME_VALUE_MAP: Record<string, string> = {
  dark: '深色',
  light: '浅色',
  system: '跟随系统'
};

/** 页宽值的中文映射 */
const PAGE_WIDTH_MAP: Record<string, string> = {
  default: '默认',
  wide: '宽',
  full: '全宽'
};

/** 任务状态的中文映射 */
const TODO_STATUS_MAP: Record<string, string> = {
  pending: '待办',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消'
};

/**
 * 格式化 get_current_time 工具的结果。
 * @param data - 工具结果数据
 * @returns 时间摘要
 */
function summarizeGetCurrentTime(data: Record<string, unknown>): ToolResultSummary {
  const locale = typeof data.locale === 'string' ? data.locale : String(data.iso ?? '');
  const iso = typeof data.iso === 'string' ? data.iso : '';
  const timestamp = typeof data.timestamp === 'number' ? String(data.timestamp) : '';

  return {
    text: locale,
    tags: [
      { label: 'ISO', value: iso },
      { label: '时间戳', value: timestamp }
    ].filter((tag) => tag.value)
  };
}

/**
 * 格式化 get_settings 工具的结果。
 * @param data - 工具结果数据
 * @returns 设置摘要
 */
function summarizeGetSettings(data: Record<string, unknown>): ToolResultSummary {
  const settings = (data.settings ?? data) as Record<string, unknown>;
  const tags: ToolSummaryTag[] = [];

  for (const [key, rawValue] of Object.entries(settings)) {
    const label = SETTINGS_KEY_LABEL_MAP[key] ?? key;
    let value: string;

    if (key === 'theme') {
      value = THEME_VALUE_MAP[String(rawValue)] ?? String(rawValue);
    } else if (key === 'editorPageWidth') {
      value = PAGE_WIDTH_MAP[String(rawValue)] ?? String(rawValue);
    } else if (key === 'sourceMode') {
      value = rawValue ? '开' : '关';
    } else {
      value = String(rawValue);
    }

    tags.push({ label, value });
  }

  return {
    text: tags.length > 0 ? '当前设置' : '无设置项',
    tags
  };
}

/**
 * 格式化 update_settings 工具的结果。
 * @param data - 工具结果数据
 * @returns 更新设置摘要
 */
function summarizeUpdateSettings(data: Record<string, unknown>): ToolResultSummary {
  const key = String(data.key ?? '');
  const label = SETTINGS_KEY_LABEL_MAP[key] ?? key;

  const formatValue = (k: string, v: unknown): string => {
    if (k === 'theme') return THEME_VALUE_MAP[String(v)] ?? String(v);
    if (k === 'editorPageWidth') return PAGE_WIDTH_MAP[String(v)] ?? String(v);
    if (k === 'sourceMode') return v ? '开' : '关';
    return String(v);
  };

  const previous = formatValue(key, data.previousValue);
  const current = formatValue(key, data.currentValue);

  return {
    text: `${label}: ${previous} → ${current}`
  };
}

/**
 * 格式化 todowrite 工具的结果。
 * @param data - 工具结果数据
 * @returns 任务列表摘要
 */
function summarizeTodoWrite(data: Record<string, unknown>): ToolResultSummary {
  const count = typeof data.count === 'number' ? data.count : 0;
  const stats = (data.stats ?? {}) as Record<string, number>;
  const tags: ToolSummaryTag[] = [];

  for (const [status, num] of Object.entries(stats)) {
    if (num > 0) {
      tags.push({ label: TODO_STATUS_MAP[status] ?? status, value: String(num) });
    }
  }

  return {
    text: count > 0 ? `已更新 ${count} 项任务` : '已清空任务列表',
    tags
  };
}

/**
 * 格式化 query_logs 工具的结果。
 * @param data - 工具结果数据
 * @returns 日志查询摘要
 */
function summarizeQueryLogs(data: Record<string, unknown>): ToolResultSummary {
  const returnedCount = typeof data.returnedCount === 'number' ? data.returnedCount : 0;
  const appliedFilters = (data.appliedFilters ?? {}) as Record<string, unknown>;
  const tags: ToolSummaryTag[] = [];

  if (appliedFilters.level) {
    tags.push({ label: '级别', value: String(appliedFilters.level) });
  }
  if (appliedFilters.scope) {
    tags.push({ label: '来源', value: String(appliedFilters.scope) });
  }
  if (appliedFilters.keyword) {
    tags.push({ label: '关键字', value: String(appliedFilters.keyword) });
  }
  if (appliedFilters.date) {
    tags.push({ label: '日期', value: String(appliedFilters.date) });
  }

  return {
    text: returnedCount > 0 ? `查询到 ${returnedCount} 条日志` : '未查询到日志',
    tags
  };
}

/**
 * 格式化 run_shell_command 工具的结果。
 * @param data - 工具结果数据
 * @returns Shell 命令执行摘要
 */
function summarizeShellCommand(data: Record<string, unknown>): ToolResultSummary {
  const { command: rawCommand, exitCode, durationMs: rawDurationMs, timedOut } = data;
  const command = typeof rawCommand === 'string' ? rawCommand : '';
  const durationMs = typeof rawDurationMs === 'number' ? rawDurationMs : 0;

  const tags: ToolSummaryTag[] = [];

  if (exitCode !== undefined && exitCode !== null) {
    tags.push({ label: '退出码', value: String(exitCode) });
  }
  if (durationMs > 0) {
    tags.push({ label: '耗时', value: `${durationMs}ms` });
  }

  return {
    text: timedOut ? `命令超时: ${command}` : command,
    tags
  };
}

/**
 * 从 skill 工具结果字符串中提取技能名称。
 * 结果格式为 <skill_content name="xxx">...</skill_content>，提取 name 属性值。
 * @param content - skill 工具返回的内容字符串
 * @returns 技能名称，未匹配时返回 null
 */
function extractSkillName(content: string): string | null {
  const match = content.match(/<skill_content\s+name="([^"]+)"/);
  return match?.[1] ?? null;
}

/**
 * 从 skill 工具结果字符串中提取技能文件路径。
 * 结果格式为 <file_path>...</file_path>，提取路径值。
 * @param content - skill 工具返回的内容字符串
 * @returns 技能文件路径，未匹配时返回 null
 */
function extractSkillFilePath(content: string): string | null {
  const match = content.match(/<file_path>([^<]+)<\/file_path>/);
  return match?.[1]?.trim() ?? null;
}

/**
 * 格式化 skill 工具的结果。
 * @param data - 工具结果数据（skill 内容为纯文本字符串）
 * @returns Skill 加载摘要
 */
function summarizeSkill(data: unknown): ToolResultSummary {
  if (typeof data === 'string') {
    const skillName = extractSkillName(data);
    const filePath = extractSkillFilePath(data);

    if (skillName) {
      return {
        tags: filePath ? [{ label: '', value: filePath }] : undefined
      };
    }

    const firstLine = data.split('\n').find((line) => line.trim().length > 0) ?? '';
    const preview = firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;

    return {
      text: '已加载技能',
      tags: [{ label: '内容预览', value: preview }]
    };
  }

  return { text: '已加载技能' };
}

/**
 * 格式化 create_document 工具的结果。
 * @param data - 工具结果数据
 * @returns 创建文档摘要
 */
function summarizeCreateDocument(data: Record<string, unknown>): ToolResultSummary {
  const title = typeof data.title === 'string' ? data.title : '未命名文档';
  const path = typeof data.path === 'string' ? data.path : '';

  return {
    text: `已创建: ${title}`,
    tags: path ? [{ label: '文件', value: toFileName(path) }] : undefined
  };
}

/**
 * 格式化 write_file 工具的结果。
 * @param data - 工具结果数据
 * @returns 写入文件摘要
 */
function summarizeWriteFile(data: Record<string, unknown>): ToolResultSummary {
  const { path, created } = data;
  const filePath = typeof path === 'string' ? path : '';

  return {
    text: created ? '已创建文件' : '已写入文件',
    tags: filePath ? [createOpenFileTag(filePath)] : undefined
  };
}

/**
 * 格式化 read_file / read_current_document 工具的结果。
 * @param data - 工具结果数据
 * @returns 读取文件摘要
 */
function summarizeReadFile(data: Record<string, unknown>): ToolResultSummary {
  const { path, totalLines, readLines } = data;
  const filePath = typeof path === 'string' ? path : '';
  const tags: ToolSummaryTag[] = [];

  if (filePath) {
    tags.push({ label: '文件', value: toFileName(filePath) });
  }
  if (typeof totalLines === 'number' && typeof readLines === 'number') {
    tags.push({ label: '行数', value: readLines === totalLines ? `${totalLines}` : `${readLines} / ${totalLines}` });
  }

  return {
    text: '已读取文件',
    tags
  };
}

/**
 * 格式化 read_current_widget 工具的结果。
 * @param data - 工具结果数据
 * @returns 当前 Widget 摘要
 */
function summarizeReadCurrentWidget(data: Record<string, unknown>): ToolResultSummary {
  const title = typeof data.title === 'string' ? data.title : '';
  const filePath = typeof data.path === 'string' ? data.path : '';
  const tags: ToolSummaryTag[] = [];

  if (title) {
    tags.push({ label: '标题', value: title });
  }
  if (filePath) {
    tags.push(createOpenFileTag(filePath));
  }

  return {
    text: title ? `已读取当前 Widget: ${title}` : '已读取当前 Widget',
    tags
  };
}

/**
 * 判断网页快照中是否存在截断字段。
 * @param value - 网页快照截断信息
 * @returns 任一字段被截断时返回 true
 */
function hasTruncatedWebpageField(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return Object.values(value as Record<string, unknown>).some((item) => item === true);
}

/**
 * 格式化 read_current_webpage 工具的结果。
 * @param data - 工具结果数据
 * @returns 当前网页摘要
 */
function summarizeReadCurrentWebpage(data: Record<string, unknown>): ToolResultSummary {
  const url = typeof data.url === 'string' ? data.url : '';
  const title = typeof data.title === 'string' ? data.title : '';
  const content = typeof data.content === 'string' ? data.content : '';
  const selectedText = typeof data.selectedText === 'string' ? data.selectedText : '';
  const headings = Array.isArray(data.headings) ? data.headings : [];
  const links = Array.isArray(data.links) ? data.links : [];
  const tags: ToolSummaryTag[] = [];

  if (url) {
    tags.push({ label: '网址', value: url });
  }

  tags.push({ label: '页面标题数', value: String(headings.length) });
  tags.push({ label: '页面链接数', value: String(links.length) });

  if (content.trim()) {
    tags.push({ label: '结构内容', value: '有' });
  }

  const viewport = typeof data.viewport === 'object' && data.viewport !== null ? (data.viewport as Record<string, unknown>) : null;
  const topLayer = viewport && typeof viewport.topLayer === 'object' && viewport.topLayer !== null ? (viewport.topLayer as Record<string, unknown>) : null;
  if (topLayer) {
    const topLayerLabel = typeof topLayer.label === 'string' ? topLayer.label : '';
    tags.push({ label: '顶层浮层', value: topLayerLabel || '有' });
  }

  const selectedElement = typeof data.selectedElement === 'object' && data.selectedElement !== null ? (data.selectedElement as Record<string, unknown>) : null;
  if (selectedElement) {
    const selectedElementText = typeof selectedElement.text === 'string' ? selectedElement.text.trim() : '';
    const selector = typeof selectedElement.selector === 'string' ? selectedElement.selector.trim() : '';
    const matchedIndex = typeof selectedElement.matchedIndex === 'number' ? selectedElement.matchedIndex : null;
    const value = matchedIndex !== null ? `#${matchedIndex} ${selectedElementText || selector || '已选中'}` : selectedElementText || selector || '有';
    tags.push({ label: '选中元素', value });
  }

  if (selectedText.trim()) {
    tags.push({ label: '选中文本', value: '有' });
  }

  if (hasTruncatedWebpageField(data.truncated)) {
    tags.push({ label: '内容已截断', value: '是' });
  }

  return {
    text: `已读取网页: ${title || url || '未命名网页'}`,
    tags
  };
}

/** WebView 操作动作的中文映射。 */
const WEBPAGE_ACTION_LABEL_MAP: Record<string, string> = {
  click: '点击',
  input: '输入',
  select: '选择',
  press: '按键',
  scroll: '滚动',
  navigate: '导航',
  wait: '等待'
};

/** WebView 操作结果文本映射。 */
const WEBPAGE_ACTION_TEXT_MAP: Record<string, string> = {
  click: '已点击网页元素',
  input: '已输入网页内容',
  select: '已选择网页选项',
  press: '已按下网页按键',
  scroll: '已滚动网页',
  navigate: '已打开网页',
  wait: '已等待网页更新'
};

/**
 * 判断值是否为对象记录。
 * @param value - 待判断值
 * @returns 是否为对象记录
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 统计目录读取结果中的指定类型条目数量。
 * @param entries - 目录条目列表
 * @param type - 条目类型
 * @returns 匹配类型的条目数量
 */
function countDirectoryEntries(entries: unknown[], type: 'file' | 'directory'): number {
  return entries.filter((entry) => isRecord(entry) && entry.type === type).length;
}

/**
 * 格式化 read_directory 工具的结果。
 * @param data - 工具结果数据
 * @returns 目录读取摘要
 */
function summarizeReadDirectory(data: Record<string, unknown>): ToolResultSummary {
  const directoryPath = typeof data.path === 'string' ? data.path : '';
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const tags: ToolSummaryTag[] = [];

  if (directoryPath) {
    tags.push({ label: '目录', value: toFileName(directoryPath) });
  }

  tags.push({ label: '条目', value: String(entries.length) });
  tags.push({ label: '文件', value: String(countDirectoryEntries(entries, 'file')) });
  tags.push({ label: '子目录', value: String(countDirectoryEntries(entries, 'directory')) });

  if (data.truncated === true) {
    tags.push({ label: '结果', value: '已截断' });
  }

  return {
    text: '已读取目录',
    tags
  };
}

/**
 * 格式化 grep 工具的结果。
 * @param data - 工具结果数据
 * @returns 内容搜索摘要
 */
function summarizeGrep(data: Record<string, unknown>): ToolResultSummary {
  const searchPath = typeof data.path === 'string' ? data.path : '';
  const pattern = typeof data.pattern === 'string' ? data.pattern : '';
  const include = typeof data.include === 'string' ? data.include : '';
  const matches = Array.isArray(data.matches) ? data.matches : [];
  const count = typeof data.count === 'number' ? data.count : matches.length;
  const warnings = Array.isArray(data.warnings) ? data.warnings.length : 0;
  const skippedWarningCount = typeof data.skippedWarningCount === 'number' ? data.skippedWarningCount : 0;
  const warningCount = warnings + skippedWarningCount;
  const tags: ToolSummaryTag[] = [];

  if (searchPath) {
    tags.push({ label: '路径', value: toFileName(searchPath) });
  }
  if (pattern) {
    tags.push({ label: '模式', value: pattern });
  }
  if (include) {
    tags.push({ label: 'Include', value: include });
  }
  if (data.truncated === true) {
    tags.push({ label: '结果', value: '已截断' });
  }
  if (data.incomplete === true) {
    tags.push({ label: '状态', value: '部分结果' });
  }
  if (warningCount > 0) {
    tags.push({ label: '警告', value: String(warningCount) });
  }

  return {
    text: count > 0 ? `搜索到 ${count} 处匹配` : '未找到匹配',
    tags
  };
}

/**
 * 格式化 widget 工具的结果。
 * @param data - Widget 契约数据
 * @returns 小组件契约摘要
 */
function summarizeWidget(data: Record<string, unknown>): ToolResultSummary {
  const widgetName = typeof data.name === 'string' ? data.name : '';
  const description = typeof data.description === 'string' ? data.description : '';
  const title = widgetName || '未命名小组件';
  const descriptionText = description ? `\n${description}` : '';

  return {
    text: `已读取小组件: ${title}${descriptionText}`
  };
}

/**
 * 读取 WebView 操作目标摘要。
 * @param value - 工具结果中的目标对象
 * @returns 目标摘要
 */
function readWebpageTargetLabel(value: unknown): string {
  if (!isRecord(value)) {
    return '';
  }

  const index = typeof value.index === 'number' ? `#${value.index}` : '';
  const label = typeof value.label === 'string' ? value.label : '';
  return [index, label].filter(Boolean).join(' ');
}

/**
 * 读取 WebView 滚动坐标。
 * @param value - 滚动坐标对象
 * @returns 坐标字符串
 */
function readWebpageScrollPosition(value: unknown): string {
  if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') {
    return '';
  }

  return `${value.x},${value.y}`;
}

/**
 * 读取 WebView 滚动目标类型标签。
 * @param value - 滚动目标类型
 * @returns 中文滚动目标
 */
function readWebpageScrollTargetType(value: unknown): string {
  if (value === 'element') {
    return '元素';
  }

  if (value === 'window') {
    return '页面';
  }

  return '';
}

/**
 * 格式化 operate_webpage 工具的结果。
 * @param data - 工具结果数据
 * @returns 网页操作摘要
 */
function summarizeOperateWebpage(data: Record<string, unknown>): ToolResultSummary {
  const action = typeof data.action === 'string' ? data.action : '';
  const tags: ToolSummaryTag[] = [];
  const actionLabel = WEBPAGE_ACTION_LABEL_MAP[action] ?? action;

  if (actionLabel) {
    tags.push({ label: '动作', value: actionLabel });
  }

  const targetLabel = readWebpageTargetLabel(data.target);
  if (targetLabel) {
    tags.push({ label: '目标', value: targetLabel });
  }

  if (isRecord(data.scroll)) {
    const targetType = readWebpageScrollTargetType(data.scroll.targetType);
    const before = readWebpageScrollPosition(data.scroll.before);
    const after = readWebpageScrollPosition(data.scroll.after);
    if (targetType) {
      tags.push({ label: '滚动目标', value: targetType });
    }
    if (before && after) {
      tags.push({ label: '位置', value: `${before} → ${after}` });
    }
  }

  return {
    text: data.message === 'no scroll movement' ? '网页未滚动' : WEBPAGE_ACTION_TEXT_MAP[action] ?? '已操作网页',
    tags
  };
}

/**
 * 格式化 edit_file 工具的结果。
 * @param data - 工具结果数据
 * @returns 编辑文件摘要
 */
function summarizeEditFile(data: Record<string, unknown>): ToolResultSummary {
  const { path, replacedCount } = data;
  const filePath = typeof path === 'string' ? path : '';
  const count = typeof replacedCount === 'number' ? replacedCount : 0;
  const tags: ToolSummaryTag[] = [];

  if (filePath) {
    tags.push(createOpenFileTag(filePath));
  }
  tags.push({ label: '替换次数', value: String(count) });

  return {
    text: '已修改文件',
    tags
  };
}

/**
 * 格式化 edit_memory 工具的结果。
 * summary 字段已包含完整的中文操作描述，直接展示即可。
 * @param data - 工具结果数据
 * @returns 记忆管理摘要
 */
function summarizeEditMemory(data: Record<string, unknown>): ToolResultSummary {
  const summaryText = typeof data.summary === 'string' ? data.summary : '已管理记忆';

  return { text: summaryText };
}

/**
 * 格式化 open_resource 工具的结果。
 * @param data - 工具结果数据
 * @returns 打开资源摘要
 */
function summarizeOpenResource(data: Record<string, unknown>): ToolResultSummary {
  const resourceType = typeof data.resourceType === 'string' ? data.resourceType : '';
  const path = typeof data.path === 'string' ? data.path : '';

  if (resourceType === 'file') {
    return {
      text: '已打开文件',
      tags: path ? [createOpenFileTag(path)] : undefined
    };
  }

  if (resourceType === 'webview') {
    return {
      text: '已打开网页',
      tags: path ? [{ label: '网址', value: path }] : undefined
    };
  }

  if (resourceType === 'external') {
    return {
      text: '已打开外部链接',
      tags: path ? [{ label: '链接', value: path }] : undefined
    };
  }

  return { text: '已打开资源' };
}

/** 工具名称到摘要解析函数的映射 */
const TOOL_SUMMARIZERS: Record<string, (data: unknown) => ToolResultSummary> = {
  get_current_time: (data) => summarizeGetCurrentTime(data as Record<string, unknown>),
  get_settings: (data) => summarizeGetSettings(data as Record<string, unknown>),
  update_settings: (data) => summarizeUpdateSettings(data as Record<string, unknown>),
  todowrite: (data) => summarizeTodoWrite(data as Record<string, unknown>),
  query_logs: (data) => summarizeQueryLogs(data as Record<string, unknown>),
  run_shell_command: (data) => summarizeShellCommand(data as Record<string, unknown>),
  skill: summarizeSkill,
  create_document: (data) => summarizeCreateDocument(data as Record<string, unknown>),
  widget: (data) => summarizeWidget(data as Record<string, unknown>),
  write_file: (data) => summarizeWriteFile(data as Record<string, unknown>),
  read_file: (data) => summarizeReadFile(data as Record<string, unknown>),
  read_directory: (data) => summarizeReadDirectory(data as Record<string, unknown>),
  grep: (data) => summarizeGrep(data as Record<string, unknown>),
  read_current_document: (data) => summarizeReadFile(data as Record<string, unknown>),
  read_current_widget: (data) => summarizeReadCurrentWidget(data as Record<string, unknown>),
  read_current_webpage: (data) => summarizeReadCurrentWebpage(data as Record<string, unknown>),
  operate_webpage: (data) => summarizeOperateWebpage(data as Record<string, unknown>),
  edit_file: (data) => summarizeEditFile(data as Record<string, unknown>),
  edit_memory: (data) => summarizeEditMemory(data as Record<string, unknown>),
  open_resource: (data) => summarizeOpenResource(data as Record<string, unknown>)
};

/** 错误码到中文的映射 */
const ERROR_CODE_MAP: Record<string, string> = {
  TOOL_NOT_FOUND: '工具未找到',
  INVALID_INPUT: '输入参数无效',
  NO_ACTIVE_DOCUMENT: '无活动文档',
  NO_SELECTION: '无选区',
  NO_CURSOR: '无光标',
  PERMISSION_DENIED: '权限被拒绝',
  USER_CANCELLED: '用户取消',
  EDITOR_UNAVAILABLE: '编辑器不可用',
  STALE_CONTEXT: '上下文已过期',
  TOOL_TIMEOUT: '工具超时',
  UNSUPPORTED_PROVIDER: '不支持的服务商',
  CONFIRMATION_DISMISSED: '确认已关闭',
  EXECUTION_FAILED: '执行失败'
};

/**
 * 根据工具名称和执行结果生成人可读的摘要。
 * 支持成功、失败、取消三种状态；未知工具在成功时返回 null 降级到代码视图，
 * 失败/取消时仍生成错误摘要。
 * @param toolName - 工具名称
 * @param result - 工具执行结果
 * @returns 摘要信息，无匹配时返回 null
 */
export function getToolResultSummary(toolName: string, result: AIToolExecutionResult): ToolResultSummary | null {
  if (result.status === 'failure') {
    const errorCode = result.error?.code ?? '';
    const errorMessage = result.error?.message ?? '';
    const label = ERROR_CODE_MAP[errorCode] ?? errorCode;

    return {
      text: errorMessage || '执行失败',
      tags: errorCode ? [{ label: '错误码', value: label }] : undefined,
      variant: 'failure'
    };
  }

  if (result.status === 'cancelled') {
    return {
      text: '用户已取消',
      variant: 'cancelled'
    };
  }

  if (result.status !== 'success') {
    return null;
  }

  const summarizer = TOOL_SUMMARIZERS[toolName];
  if (!summarizer) {
    return null;
  }

  try {
    return summarizer(result.data);
  } catch {
    return null;
  }
}
