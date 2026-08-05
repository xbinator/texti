/**
 * @file capabilities.mts
 * @description 校验并冻结 Renderer 传入的通用 Runtime 能力描述符。
 */
import type { ChatRendererToolHistoryPolicy, ChatRuntimeCapabilityDescriptor } from 'types/chat-runtime';

/** 历史占位符最大长度。 */
const MAX_PLACEHOLDER_LENGTH = 500;

/** 历史脱敏路径最大数量。 */
const MAX_REDACT_PATH_COUNT = 32;

/** 单条历史脱敏路径最大长度。 */
const MAX_REDACT_PATH_LENGTH = 256;

/** 禁止进入属性遍历的路径片段。 */
const FORBIDDEN_PATH_SEGMENTS = new Set<string>(['__proto__', 'prototype', 'constructor']);

/**
 * 校验 Renderer 历史脱敏路径。
 * @param path - 待校验路径
 * @param toolName - 所属工具名称
 */
function validateRedactPath(path: string, toolName: string): void {
  const segments = path.split('.');
  if (
    !path ||
    path.length > MAX_REDACT_PATH_LENGTH ||
    segments.some((segment: string): boolean => !segment || FORBIDDEN_PATH_SEGMENTS.has(segment) || !/^[A-Za-z0-9_$-]+$/.test(segment))
  ) {
    throw new Error(`Invalid renderer history redact path for tool: ${toolName}`);
  }
}

/**
 * 校验并冻结单个 Renderer 历史策略。
 * @param history - 待校验策略
 * @param toolName - 所属工具名称
 * @returns 不可变策略
 */
function freezeHistory(history: ChatRendererToolHistoryPolicy, toolName: string): ChatRendererToolHistoryPolicy {
  if (history.mode !== 'keep' && history.mode !== 'latest-only') throw new Error(`Invalid renderer history mode for tool: ${toolName}`);
  if (history.placeholder !== undefined && history.placeholder.length > MAX_PLACEHOLDER_LENGTH) {
    throw new Error(`Renderer history placeholder is too long for tool: ${toolName}`);
  }
  const paths = history.redactInputPaths ?? [];
  if (paths.length > MAX_REDACT_PATH_COUNT) throw new Error(`Too many renderer history redact paths for tool: ${toolName}`);
  paths.forEach((path: string): void => validateRedactPath(path, toolName));
  return Object.freeze({
    mode: history.mode,
    ...(history.placeholder !== undefined ? { placeholder: history.placeholder } : {}),
    ...(history.redactInputPaths ? { redactInputPaths: Object.freeze([...history.redactInputPaths]) } : {})
  });
}

/**
 * 校验并冻结主进程接收的 Runtime 能力。
 * @param descriptor - Renderer 提供的能力描述符
 * @returns 主进程内部不可变能力
 */
export function normalizeRuntimeCapabilities(descriptor: ChatRuntimeCapabilityDescriptor | undefined): ChatRuntimeCapabilityDescriptor | undefined {
  if (!descriptor) return undefined;
  const names = new Set<string>();
  const rendererTools = Object.freeze(
    (descriptor.rendererTools ?? []).map((tool) => {
      const name = tool.name.trim();
      if (!name || name !== tool.name) throw new Error('Renderer tool descriptor name must be a non-empty trimmed string');
      if (names.has(name)) throw new Error(`Duplicate renderer tool descriptor: ${name}`);
      names.add(name);
      return Object.freeze({ name, ...(tool.history ? { history: freezeHistory(tool.history, name) } : {}) });
    })
  );
  const toolContext = descriptor.toolContext
    ? Object.freeze({ providerId: descriptor.toolContext.providerId.trim(), resourceId: descriptor.toolContext.resourceId.trim() })
    : undefined;
  if (toolContext && (!toolContext.providerId || !toolContext.resourceId)) throw new Error('Runtime tool context requires providerId and resourceId');

  return Object.freeze({
    rendererTools,
    ...(descriptor.workspaceRoot !== undefined ? { workspaceRoot: descriptor.workspaceRoot } : {}),
    ...(toolContext ? { toolContext } : {})
  });
}
