/**
 * @file webview-tool-output.mts
 * @description WebView 工具结果的模型上下文历史语义投影。
 */
import type { ChatMessagePart, ChatMessageRecord, ChatMessageToolPart } from 'types/chat';
import { isPlainObject, omit } from 'lodash-es';
import { OPERATE_WEBPAGE_TOOL_NAME, READ_CURRENT_WEBPAGE_TOOL_NAME, WEBPAGE_STEP_LIMITS } from '../tools/constants.mjs';
import { isRuntimeWebpageSnapshot } from '../tools/guards.mjs';
import { sanitizeWebpageAction } from '../tools/WebviewTool/input.mjs';
import { sanitizeWebpageError, sanitizeWebpageResult } from '../tools/WebviewTool/result.mjs';

/** 历史网页快照固定摘要。 */
const HISTORICAL_WEBVIEW_SUMMARY =
  'Historical webpage snapshot omitted. Its snapshotId and [N] handles are invalid. Call read_current_webpage to observe the current page.';

/** 简化 DOM 行。 */
const WEBVIEW_DOM_LINE_PATTERN = /^[^\n]*\*?\[\d+\]\s*(?:<[^>\n]+>|&lt;[^&\n]+&gt;)[^\n]*$/gimu;

/** WebView snapshot 令牌。 */
const WEBVIEW_SNAPSHOT_PATTERN = /webview-snapshot-[A-Za-z0-9_-]+/gu;

/** 显式 WebView snapshotId 赋值行。 */
const WEBVIEW_SNAPSHOT_LINE_PATTERN = /^\s*(?:[-+>]\s*)?snapshotId\s*[:=][^\n]*$/gimu;

/** WebView 元素句柄。 */
const WEBVIEW_HANDLE_PATTERN = /\*?\[\d+\]/gu;

/** 显式 CSS selector 记录行。 */
const WEBVIEW_SELECTOR_LINE_PATTERN = /^\s*(?:[-+>]\s*)?(?:css\s+)?selector\s*[:=][^\n]*$/gimu;

/** 普通 HTML 标签。 */
const WEBVIEW_HTML_TAG_PATTERN = /<\/?[A-Za-z][^>\n]*>/gu;

/** HTML 编码标签。 */
const WEBVIEW_ENCODED_TAG_PATTERN = /&lt;\/?[A-Za-z][^&\n]*&gt;/giu;

/** 当前网页读取在消息投影中的位置。 */
interface WebviewPartLocation {
  /** 消息索引。 */
  messageIndex: number;
  /** Part 索引。 */
  partIndex: number;
}

/**
 * 判断值是否为普通对象记录。
 * @param value - 待判断值
 * @returns 是否为普通对象记录
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value);
}

/**
 * 清理历史步骤记忆中的瞬时网页引用。
 * @param value - 原始记忆文本
 * @param maxLength - 最大保留字符数
 * @returns 可安全进入历史上下文的文本
 */
function sanitizeMemoryText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';

  return value
    .replace(WEBVIEW_DOM_LINE_PATTERN, '')
    .replace(WEBVIEW_SNAPSHOT_LINE_PATTERN, '')
    .replace(WEBVIEW_SELECTOR_LINE_PATTERN, '')
    .replace(WEBVIEW_SNAPSHOT_PATTERN, '')
    .replace(WEBVIEW_HANDLE_PATTERN, '')
    .replace(WEBVIEW_HTML_TAG_PATTERN, '')
    .replace(WEBVIEW_ENCODED_TAG_PATTERN, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
    .slice(0, maxLength);
}

/**
 * 归一化历史网页操作的步骤记忆。
 * @param value - 原始步骤记忆
 * @returns 字段完整且受长度约束的步骤记忆
 */
function sanitizeStepMemory(value: unknown): Record<string, string> {
  const source = isRecord(value) ? value : {};

  return {
    evaluation: sanitizeMemoryText(source.evaluation, WEBPAGE_STEP_LIMITS.evaluation),
    memory: sanitizeMemoryText(source.memory, WEBPAGE_STEP_LIMITS.memory),
    nextGoal: sanitizeMemoryText(source.nextGoal, WEBPAGE_STEP_LIMITS.nextGoal)
  };
}

/**
 * 创建不含原始网页观察的历史存根。
 * @param data - 原始读取结果数据
 * @returns 只保留稳定元数据的历史存根
 */
function createSnapshotStub(data: unknown): Record<string, unknown> {
  const source = isRecord(data) ? data : {};

  return {
    ...(typeof source.url === 'string' ? { url: source.url.slice(0, 2_048) } : {}),
    ...(typeof source.title === 'string' ? { title: source.title.slice(0, 300) } : {}),
    ...(typeof source.capturedAt === 'number' && Number.isFinite(source.capturedAt) ? { capturedAt: source.capturedAt } : {}),
    pruned: true,
    pruneReason: 'historical_webview_snapshot',
    summary: HISTORICAL_WEBVIEW_SUMMARY
  };
}

/**
 * 判断 Part 是否为已进入 done 状态的工具调用。
 * @param part - 消息 Part
 * @returns 是否为终态工具调用
 */
function isDoneTool(part: ChatMessagePart): part is ChatMessageToolPart {
  return part.type === 'tool' && part.status === 'done';
}

/**
 * 判断成功读取是否包含可用于后续操作的快照 ID。
 * @param part - 已产生结果的网页读取 Part
 * @returns 是否为可用当前观察
 */
function hasUsableSnapshot(part: ChatMessageToolPart): boolean {
  return part.result?.status === 'success' && isRuntimeWebpageSnapshot(part.result.data);
}

/**
 * 移除只用于流式续接或 UI 的工具瞬时字段。
 * @param part - WebView 工具 Part
 * @returns 不含原始流式参数和 Provider 元数据的 clone
 */
function stripTransientFields(part: ChatMessageToolPart): ChatMessageToolPart {
  return omit(structuredClone(part), ['inputText', 'providerMetadata', 'shellOutput', 'shellRunState']);
}

/**
 * 清理当前读取的瞬时外壳但保留完整有效快照。
 * @param part - 当前网页读取 Part
 * @returns 保留 BrowserState 且固定结果工具名的 clone
 */
function projectCurrentRead(part: ChatMessageToolPart): ChatMessageToolPart {
  const safeToolPart = stripTransientFields(part);
  if (safeToolPart.result?.status !== 'success') return safeToolPart;

  return {
    ...safeToolPart,
    result: { ...safeToolPart.result, toolName: READ_CURRENT_WEBPAGE_TOOL_NAME }
  };
}

/**
 * 清理网页操作的任意已知结果形态。
 * @param result - 原始网页操作结果
 * @returns 发送侧安全结果或 undefined
 */
function sanitizeOperateResult(result: ChatMessageToolPart['result']): ChatMessageToolPart['result'] {
  if (result?.status === 'success') {
    return { ...result, toolName: OPERATE_WEBPAGE_TOOL_NAME, data: sanitizeWebpageResult(result.data) };
  }
  if (result?.status === 'failure' || result?.status === 'cancelled') {
    return { ...result, toolName: OPERATE_WEBPAGE_TOOL_NAME, error: sanitizeWebpageError(result.error) };
  }

  return result ? { ...result, toolName: OPERATE_WEBPAGE_TOOL_NAME } : undefined;
}

/**
 * 将单个 WebView Part 投影为历史步骤。
 * @param part - 原始消息 Part
 * @returns 不含历史 DOM 和快照句柄的 Part clone
 */
export function projectHistoricalWebviewPart(part: ChatMessagePart): ChatMessagePart {
  const cloned = structuredClone(part);
  if (cloned.type !== 'tool' || (cloned.toolName !== READ_CURRENT_WEBPAGE_TOOL_NAME && cloned.toolName !== OPERATE_WEBPAGE_TOOL_NAME)) {
    return cloned;
  }
  const safeToolPart = stripTransientFields(cloned);

  if (safeToolPart.toolName === READ_CURRENT_WEBPAGE_TOOL_NAME && safeToolPart.result?.status === 'success') {
    return {
      ...safeToolPart,
      result: { ...safeToolPart.result, toolName: READ_CURRENT_WEBPAGE_TOOL_NAME, data: createSnapshotStub(safeToolPart.result.data) }
    };
  }

  if (safeToolPart.toolName === READ_CURRENT_WEBPAGE_TOOL_NAME) {
    let result = safeToolPart.result ? { ...safeToolPart.result, toolName: READ_CURRENT_WEBPAGE_TOOL_NAME } : undefined;
    if (result?.status === 'failure' || result?.status === 'cancelled') {
      result = { ...result, error: sanitizeWebpageError(result.error) };
    }

    return { ...safeToolPart, ...(result ? { result } : {}) };
  }

  const input = isRecord(safeToolPart.input) ? safeToolPart.input : {};
  const action = sanitizeWebpageAction(input.action);
  const result = sanitizeOperateResult(safeToolPart.result);

  return {
    ...safeToolPart,
    ...(result ? { result } : {}),
    input: {
      step: sanitizeStepMemory(input.step),
      ...(action ? { action } : {})
    }
  };
}

/**
 * 查找最新用户轮次中仍有效的完整读取 Part。
 * @param messages - 模型投影消息
 * @returns 当前读取位置，不存在时返回 undefined
 */
function findCurrentReadLocation(messages: ChatMessageRecord[]): WebviewPartLocation | undefined {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== 'user') continue;
    latestUserIndex = index;
    break;
  }
  if (latestUserIndex < 0) return undefined;

  let currentReadLocation: WebviewPartLocation | undefined;
  for (let messageIndex = latestUserIndex + 1; messageIndex < messages.length; messageIndex += 1) {
    const { parts } = messages[messageIndex];
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const part = parts[partIndex];
      if (!isDoneTool(part)) continue;

      if (part.toolName === READ_CURRENT_WEBPAGE_TOOL_NAME && part.result?.status !== 'awaiting_user_input') {
        currentReadLocation = hasUsableSnapshot(part) ? { messageIndex, partIndex } : undefined;
      } else if (part.toolName === OPERATE_WEBPAGE_TOOL_NAME && part.result?.status !== 'awaiting_user_input') {
        currentReadLocation = undefined;
      }
    }
  }

  return currentReadLocation;
}

/**
 * 投影 WebView 工具历史并最多保留一个当前观察。
 * @param messages - 原始模型投影消息
 * @returns 不修改输入的 WebView 安全投影
 */
export function projectWebviewToolOutputs(messages: ChatMessageRecord[]): ChatMessageRecord[] {
  const currentReadLocation = findCurrentReadLocation(messages);

  return messages.map((message, messageIndex): ChatMessageRecord => {
    const clonedMessage = structuredClone(message);

    return {
      ...clonedMessage,
      parts: clonedMessage.parts.map((part, partIndex): ChatMessagePart => {
        const isCurrentRead = currentReadLocation?.messageIndex === messageIndex && currentReadLocation.partIndex === partIndex;
        if (part.type === 'tool' && part.toolName === READ_CURRENT_WEBPAGE_TOOL_NAME) {
          return isCurrentRead ? projectCurrentRead(part) : projectHistoricalWebviewPart(part);
        }
        if (part.type === 'tool' && part.toolName === OPERATE_WEBPAGE_TOOL_NAME) {
          return projectHistoricalWebviewPart(part);
        }

        return part;
      })
    };
  });
}
