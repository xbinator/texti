/**
 * @file useChatContext.ts
 * @description 将 WebView 页面完整工具契约注册为 ChatRuntime 页面上下文。
 */
import type { WebviewOperateInput, WebviewToolContext } from '../types';
import type { AIToolContext, AIToolExecutionError, AIToolExecutionMetadata, AIToolExecutionResult } from 'types/ai';
import { ref } from 'vue';
import { OPEN_RESOURCE_TOOL_NAME } from '@/ai/tools/catalog/runtimeTools';
import { createToolFailureResult, createToolSuccessResult } from '@/ai/tools/results';
import { useChatContextProvider, type ToolContextConfirmation, type ToolContextTool } from '@/hooks/useChat/useChatContextRegistry';
import { asyncTo } from '@/utils/asyncTo';
import {
  SUPPORTED_WEBPAGE_PRESS_KEYS,
  SUPPORTED_WEBPAGE_SCROLL_DIRECTIONS,
  WEBPAGE_OPERATION_LIMITS,
  WEBPAGE_STEP_LIMITS,
  normalizeWebpageInput
} from './chatToolInput';
import { isWebpageResult, isWebpageSnapshot, sanitizeWebpageError, sanitizeWebpageResult } from './chatToolResult';

/** WebView Chat Context 选项。 */
interface UseChatContextOptions {
  /** 当前 WebView 资源 ID。 */
  readonly resourceId: Readonly<import('vue').Ref<string>>;
  /** 当前 WebView 能力是否可用。 */
  readonly available: Readonly<import('vue').Ref<boolean>>;
  /** 当前 WebView 强类型工具上下文。 */
  readonly context: WebviewToolContext;
}

/** 读取当前网页工具名称。 */
const READ_CURRENT_WEBPAGE_TOOL_NAME = 'read_current_webpage';

/** 操作当前网页工具名称。 */
const OPERATE_WEBPAGE_TOOL_NAME = 'operate_webpage';

/** 网页操作确认文本预览最大长度。 */
const WEBVIEW_CONFIRMATION_PREVIEW_LIMIT = 300;

/** 网页操作动作参数 Schema。 */
const WEBPAGE_OPERATION_ACTION_SCHEMA: Record<string, unknown> = {
  oneOf: [
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['click'] },
        index: {
          type: 'integer',
          minimum: 0,
          maximum: WEBPAGE_OPERATION_LIMITS.elementIndex,
          description: '来自 read_current_webpage 最新 snapshot 的元素索引。'
        }
      },
      required: ['type', 'index'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['input'] },
        index: {
          type: 'integer',
          minimum: 0,
          maximum: WEBPAGE_OPERATION_LIMITS.elementIndex,
          description: '来自 read_current_webpage 最新 snapshot 的输入元素索引。'
        },
        text: { type: 'string', maxLength: WEBPAGE_OPERATION_LIMITS.inputText, description: '要输入的文本。' },
        clear: { type: 'boolean', description: '是否先清空原内容，默认 true。' }
      },
      required: ['type', 'index', 'text'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['select'] },
        index: {
          type: 'integer',
          minimum: 0,
          maximum: WEBPAGE_OPERATION_LIMITS.elementIndex,
          description: '来自 read_current_webpage 最新 snapshot 的 select 元素索引。'
        },
        optionText: {
          type: 'string',
          maxLength: WEBPAGE_OPERATION_LIMITS.optionText,
          description: '要选择的 option 可见文本。存在多个同名 option 时工具会返回歧义错误。'
        }
      },
      required: ['type', 'index', 'optionText'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['press'] },
        index: {
          type: 'integer',
          minimum: 0,
          maximum: WEBPAGE_OPERATION_LIMITS.elementIndex,
          description: '来自 read_current_webpage 最新 snapshot 的可聚焦元素索引。'
        },
        key: { type: 'string', enum: SUPPORTED_WEBPAGE_PRESS_KEYS, description: '要模拟的按键。搜索框回车提交请使用 Enter。' }
      },
      required: ['type', 'index', 'key'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['scroll'] },
        index: {
          type: 'integer',
          minimum: 0,
          maximum: WEBPAGE_OPERATION_LIMITS.elementIndex,
          description: '可选，来自 read_current_webpage 最新 snapshot 的元素索引；提供时滚动其可滚动祖先。'
        },
        direction: { type: 'string', enum: SUPPORTED_WEBPAGE_SCROLL_DIRECTIONS },
        pixels: { type: 'number', minimum: 1, maximum: 5_000 }
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
          minLength: 1,
          maxLength: WEBPAGE_OPERATION_LIMITS.url,
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

/** 网页操作步骤记忆 Schema。 */
const WEBPAGE_STEP_MEMORY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    evaluation: {
      type: 'string',
      maxLength: WEBPAGE_STEP_LIMITS.evaluation,
      description: '根据最新网页观察判断上一步是否达到目标；没有上一步时使用空字符串。'
    },
    memory: {
      type: 'string',
      maxLength: WEBPAGE_STEP_LIMITS.memory,
      description: '后续步骤仍需保留的业务事实；不得包含 [N]、snapshotId、CSS selector、HTML、简化 DOM 行或大段页面原文。'
    },
    nextGoal: {
      type: 'string',
      maxLength: WEBPAGE_STEP_LIMITS.nextGoal,
      description: '本次 action 希望达到的单一目标，不要编排多个后续动作。'
    }
  },
  required: ['evaluation', 'memory', 'nextGoal'],
  additionalProperties: false
};

/**
 * 创建稳定工具错误。
 * @param code - 工具错误码
 * @param message - 错误消息
 * @returns 带稳定错误码的错误
 */
function createToolError(code: AIToolExecutionError['code'], message: string): Error & { code: AIToolExecutionError['code'] } {
  const error = new Error(message) as Error & { code: AIToolExecutionError['code'] };
  error.code = code;
  return error;
}

/**
 * 创建 WebView 操作确认描述。
 * @param input - 已归一化工具输入
 * @returns 确认描述
 */
function createConfirmationText(input: WebviewOperateInput): string {
  const { action } = input;
  if (action.type === 'click') return `点击当前网页元素 #${String(action.index)}`;
  if (action.type === 'input') return `向当前网页元素 #${String(action.index)} 输入文本：${action.text.slice(0, WEBVIEW_CONFIRMATION_PREVIEW_LIMIT)}`;
  if (action.type === 'select') return `在当前网页元素 #${String(action.index)} 选择：${action.optionText.slice(0, WEBVIEW_CONFIRMATION_PREVIEW_LIMIT)}`;
  if (action.type === 'press') return `在当前网页元素 #${String(action.index)} 按下：${action.key}`;
  if (action.type === 'scroll') return `滚动当前网页：${action.direction}`;
  if (action.type === 'navigate') return `在当前 WebView 中打开：${action.url.slice(0, WEBVIEW_CONFIRMATION_PREVIEW_LIMIT)}`;
  return '等待当前网页状态更新。';
}

/**
 * 注册 WebView Chat 工具上下文。
 * @param options - WebView 工具注册选项
 */
export function useChatContext(options: UseChatContextOptions): void {
  const active = ref<boolean>(true);

  /**
   * 直接读取当前网页快照。
   * @param metadata - Runtime 执行元数据
   * @returns 标准网页读取结果
   */
  async function readSnapshot(metadata?: AIToolExecutionMetadata): Promise<AIToolExecutionResult> {
    const [error, snapshot] = await asyncTo(options.context.readPageSnapshot(metadata?.abortSignal));
    if (error) throw error.cause ?? error;
    if (!isWebpageSnapshot(snapshot)) {
      return createToolFailureResult(READ_CURRENT_WEBPAGE_TOOL_NAME, 'INVALID_INPUT', '当前网页快照格式无效');
    }
    return createToolSuccessResult(READ_CURRENT_WEBPAGE_TOOL_NAME, snapshot);
  }

  /**
   * 直接执行已确认的网页操作。
   * @param input - 原始模型工具输入
   * @param metadata - Runtime 执行元数据
   * @returns 标准网页操作结果
   */
  async function operatePage(input: unknown, metadata?: AIToolExecutionMetadata): Promise<AIToolExecutionResult> {
    const normalized = normalizeWebpageInput(input);
    if (!normalized) return createToolFailureResult(OPERATE_WEBPAGE_TOOL_NAME, 'INVALID_INPUT', '网页操作参数无效');
    const [error, result] = await asyncTo(options.context.operatePage(normalized, metadata?.abortSignal));
    if (error) {
      const safeError = sanitizeWebpageError(error.cause ?? error);
      return createToolFailureResult(OPERATE_WEBPAGE_TOOL_NAME, safeError.code, safeError.message);
    }
    if (!isWebpageResult(result)) {
      return createToolFailureResult(OPERATE_WEBPAGE_TOOL_NAME, 'INVALID_INPUT', '网页操作结果格式无效');
    }
    return createToolSuccessResult(OPERATE_WEBPAGE_TOOL_NAME, sanitizeWebpageResult(result));
  }

  /**
   * 创建网页写操作确认内容并在弹窗前校验输入。
   * @param input - 原始模型工具输入
   * @returns 页面操作确认内容
   */
  function createConfirmation(input: unknown): ToolContextConfirmation {
    const normalized = normalizeWebpageInput(input);
    if (!normalized) throw createToolError('INVALID_INPUT', '网页操作参数无效');
    return {
      title: '操作当前网页',
      description: createConfirmationText(normalized),
      allowRemember: true
    };
  }

  /**
   * 创建读取当前网页工具。
   * @returns 完整只读页面工具
   */
  function createReadTool(): ToolContextTool {
    return {
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
      },
      execute: (_input: unknown, _context?: AIToolContext, metadata?: AIToolExecutionMetadata): Promise<AIToolExecutionResult> => readSnapshot(metadata),
      presentation: {
        label: '读取当前网页',
        summarize: (): string => '已读取当前网页'
      },
      history: { mode: 'latest-only', placeholder: '历史网页快照已裁剪，请重新读取当前网页。' }
    };
  }

  /**
   * 创建操作当前网页工具。
   * @returns 完整可写页面工具
   */
  function createOperateTool(): ToolContextTool {
    return {
      definition: {
        name: OPERATE_WEBPAGE_TOOL_NAME,
        description:
          '操作当前激活 WebView 页面。页面内可操作项必须使用 read_current_webpage 返回的 [N]，再执行 click、input、select、press 或 scroll；不要用 navigate 替代页面文字、链接、按钮或卡片。' +
          'navigate 仅用于用户明确提供 URL、要求地址栏导航或切换到某网址，无需 snapshotId。文本框输入后需要按键时使用 press Enter；不接受 CSS selector 或任意 JavaScript。' +
          '每次操作都要用 step 记录对上一步的简短评估、跨步骤业务事实和本次目标；操作后必须重新调用 read_current_webpage，禁止在 step 中保存快照句柄、选择器、DOM 或大段页面原文。',
        source: 'builtin',
        riskLevel: 'write',
        requiresActiveDocument: false,
        permissionCategory: 'system',
        safeAutoApprove: false,
        allowPermissionRemember: true,
        parameters: {
          type: 'object',
          properties: {
            snapshotId: {
              type: 'string',
              minLength: 1,
              maxLength: WEBPAGE_OPERATION_LIMITS.snapshotId,
              description: 'read_current_webpage 返回的 snapshotId；非 navigate 动作必须提供。页面内可操作项不得改用 navigate。'
            },
            step: WEBPAGE_STEP_MEMORY_SCHEMA,
            action: WEBPAGE_OPERATION_ACTION_SCHEMA
          },
          required: ['step', 'action'],
          additionalProperties: false
        }
      },
      execute: (input: unknown, _context?: AIToolContext, metadata?: AIToolExecutionMetadata): Promise<AIToolExecutionResult> => operatePage(input, metadata),
      createConfirmation,
      presentation: {
        label: '操作当前网页',
        summarize: (result: AIToolExecutionResult): string =>
          result.status === 'success' && typeof result.data === 'object' && result.data !== null && 'message' in result.data
            ? String(result.data.message)
            : '网页操作已完成'
      },
      history: {
        mode: 'keep',
        redactInputPaths: ['snapshotId', 'step', 'action.text', 'action.url', 'action.optionText']
      }
    };
  }

  useChatContextProvider({
    providerId: 'webview',
    resourceId: options.resourceId,
    available: options.available,
    active,
    getTools: () => [createReadTool(), createOperateTool()],
    hiddenToolNames: [OPEN_RESOURCE_TOOL_NAME],
    appBridgeHandlers: {}
  });
}
