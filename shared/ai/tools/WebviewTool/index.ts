/**
 * @file index.ts
 * @description WebView 相关 ChatRuntime 工具定义。
 */
import type { ToolJsonSchema, ToolRegistryEntry } from '../types.js';

/** WebView 支持模拟的按键。 */
const SUPPORTED_WEBPAGE_PRESS_KEYS = ['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;

/** 网页操作动作参数 Schema。 */
const WEBPAGE_OPERATION_ACTION_SCHEMA: ToolJsonSchema = {
  oneOf: [
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['click'] },
        index: { type: 'number', description: '来自 read_current_webpage 最新 snapshot 的元素索引。' }
      },
      required: ['type', 'index'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['input'] },
        index: { type: 'number', description: '来自 read_current_webpage 最新 snapshot 的输入元素索引。' },
        text: { type: 'string', description: '要输入的文本。' },
        clear: { type: 'boolean', description: '是否先清空原内容，默认 true。' }
      },
      required: ['type', 'index', 'text'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['select'] },
        index: { type: 'number', description: '来自 read_current_webpage 最新 snapshot 的 select 元素索引。' },
        optionText: { type: 'string', description: '要选择的 option 可见文本。存在多个同名 option 时工具会返回歧义错误。' }
      },
      required: ['type', 'index', 'optionText'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['press'] },
        index: { type: 'number', description: '来自 read_current_webpage 最新 snapshot 的可聚焦元素索引。' },
        key: { type: 'string', enum: SUPPORTED_WEBPAGE_PRESS_KEYS, description: '要模拟的按键。搜索框回车提交请使用 Enter。' }
      },
      required: ['type', 'index', 'key'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['scroll'] },
        index: { type: 'number', description: '可选，来自 read_current_webpage 最新 snapshot 的元素索引；提供时滚动其可滚动祖先。' },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
        pixels: { type: 'number', minimum: 1, maximum: 5000 }
      },
      required: ['type', 'direction'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['navigate'] },
        url: {
          type: 'string',
          description: '用户明确给出的 http/https 地址或地址栏目标，可省略协议；不要替代页面内可操作项的 [N]。'
        }
      },
      required: ['type', 'url'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['wait'] },
        seconds: { type: 'number', minimum: 0.1, maximum: 5 }
      },
      required: ['type'],
      additionalProperties: false
    }
  ]
};

/** 读取当前网页工具名称。 */
export const READ_CURRENT_WEBPAGE_TOOL_NAME = 'read_current_webpage';

/** 操作当前网页工具名称。 */
export const OPERATE_WEBPAGE_TOOL_NAME = 'operate_webpage';

/** 读取当前网页工具 registry 条目。 */
export const readCurrentWebpageToolRegistryEntry = {
  runtime: 'main',
  group: 'webview',
  exposure: 'conditional-readonly',
  executionClass: 'direct',
  effect: {
    effect: 'external_read',
    resourceScopeResolver: 'active-webview',
    reversible: true
  },
  definition: {
    name: READ_CURRENT_WEBPAGE_TOOL_NAME,
    description:
      '读取当前内置 WebView 页面的 BrowserState。模型应优先阅读 summary：其中包含 Current Page、Page info、简化 DOM 树、[N] 元素句柄和滚动提示。' +
      '需要操作网页前必须先调用此工具获取 snapshotId，并从 summary/content 中选择 [N] 作为 operate_webpage 的 index；elements、viewport 和 selectedElement 仅作为辅助元数据。',
    source: 'builtin',
    riskLevel: 'read',
    requiresActiveDocument: false,
    permissionCategory: 'system',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  }
} satisfies ToolRegistryEntry;

/** 操作当前网页工具 registry 条目。 */
export const operateWebpageToolRegistryEntry = {
  runtime: 'main',
  group: 'webview',
  exposure: 'conditional-writable',
  executionClass: 'direct',
  effect: {
    effect: 'immediate_side_effect',
    resourceScopeResolver: 'active-webview',
    reversible: false
  },
  definition: {
    name: OPERATE_WEBPAGE_TOOL_NAME,
    description:
      '操作当前激活 WebView 页面。页面内可操作项必须使用 read_current_webpage 返回的 [N]，再执行 click、input、select、press 或 scroll；不要用 navigate 替代页面文字、链接、按钮或卡片。' +
      'navigate 仅用于用户明确提供 URL、要求地址栏导航或切换到某网址，无需 snapshotId。文本框输入后需要按键时使用 press Enter；不接受 CSS selector 或任意 JavaScript。',
    source: 'builtin',
    riskLevel: 'write',
    requiresActiveDocument: false,
    permissionCategory: 'system',
    safeAutoApprove: false,
    parameters: {
      type: 'object',
      properties: {
        snapshotId: { type: 'string', description: 'read_current_webpage 返回的 snapshotId；非 navigate 动作必须提供。页面内可操作项不得改用 navigate。' },
        action: WEBPAGE_OPERATION_ACTION_SCHEMA
      },
      required: ['action'],
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;
