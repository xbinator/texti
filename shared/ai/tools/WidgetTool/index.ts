/**
 * @file index.ts
 * @description Widget 编辑页相关 ChatRuntime 工具定义。
 */
import type { ToolRegistryEntry } from '../types.js';

/** 读取当前 Widget 编辑页工具名称。 */
export const READ_CURRENT_WIDGET_TOOL_NAME = 'read_current_widget';

/** 读取当前 Widget 编辑页工具 registry 条目。 */
export const readCurrentWidgetToolRegistryEntry = {
  runtime: 'main',
  group: 'read',
  exposure: 'conditional-readonly',
  executionClass: 'direct',
  effect: {
    effect: 'pure_read',
    resourceScopeResolver: 'active-widget-editor',
    reversible: true
  },
  definition: {
    name: READ_CURRENT_WIDGET_TOOL_NAME,
    description: '读取当前打开的 Widget 编辑页快照，返回文件路径、标题和编辑器内存中的 WidgetData JSON；',
    source: 'builtin',
    riskLevel: 'read',
    requiresActiveDocument: false,
    permissionCategory: 'system',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  }
} satisfies ToolRegistryEntry;
