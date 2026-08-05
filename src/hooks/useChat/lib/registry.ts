/**
 * @file registry.ts
 * @description 页面工具上下文资源的注册、激活和精确 binding 查询。
 */
import type {
  ChatBridgeDispatchResult,
  ToolContextHandle,
  ToolContextDefinition,
  ToolContextRegistration,
  ToolContextRegistry,
  ToolContextRuntimeServices,
  ToolContextTool
} from './types';
import type { AIToolContext, AIToolExecutionError, AIToolExecutionMetadata, AIToolExecutionResult, AIToolExecutor } from 'types/ai';
import type { ChatRendererToolDescriptor, ChatRendererToolHistoryPolicy, ChatRuntimeBridgeRequestEvent, ChatToolBinding } from 'types/chat-runtime';
import { isEqual, uniq } from 'lodash-es';
import type { AIToolConfirmationRequest } from '@/ai/tools/confirmation';
import { executeResultWithPermission } from '@/ai/tools/permission';
import { createToolFailureResult } from '@/ai/tools/results';
import { asyncTo } from '@/utils/asyncTo';
import { readToolExecutionErrorCode } from '../../../../shared/ai/toolExecutionErrors';

/** 注册时冻结的页面工具元数据。 */
interface ToolMetadataSnapshot {
  /** 可进入 Runtime IPC 的工具定义。 */
  readonly definition: ToolContextDefinition;
  /** Renderer 展示能力的可比较部分。 */
  readonly presentation?: { readonly label: string; readonly hasSummarizer: boolean };
  /** 可进入 Runtime descriptor 的历史策略。 */
  readonly history?: ChatRendererToolHistoryPolicy;
}

/** Registry 内部资源记录。 */
interface RegistryEntry extends ToolContextRegistration {
  /** 当前注册实例 owner。 */
  readonly owner: symbol;
  /** 本 owner 注册时的工具元数据快照。 */
  readonly toolMetadata: readonly ToolMetadataSnapshot[];
}

/** 当前激活记录。 */
interface ActiveEntry {
  /** 当前资源 binding。 */
  readonly binding: ChatToolBinding;
  /** 当前注册实例 owner。 */
  readonly owner: symbol;
}

/** 不存在资源时复用的不可变隐藏工具列表。 */
const EMPTY_HIDDEN_NAMES: readonly string[] = Object.freeze([] as string[]);

/** 历史占位符最大长度。 */
const MAX_HISTORY_PLACEHOLDER_LENGTH = 500;

/** 历史脱敏路径最大数量。 */
const MAX_REDACT_PATH_COUNT = 32;

/** 单条历史脱敏路径最大长度。 */
const MAX_REDACT_PATH_LENGTH = 256;

/** 不允许作为自有属性路径片段的原型字段。 */
const FORBIDDEN_PATH_SEGMENTS = new Set<string>(['__proto__', 'prototype', 'constructor']);

/**
 * 创建带稳定错误码的 Registry 错误。
 * @param code - 工具错误码
 * @param message - 错误消息
 * @returns 带稳定错误码的错误
 */
function createRegistryError(code: AIToolExecutionError['code'], message: string): Error & { code: AIToolExecutionError['code'] } {
  const error = new Error(message) as Error & { code: AIToolExecutionError['code'] };
  error.code = code;
  return error;
}

/**
 * 创建不可变 binding。
 * @param binding - 原始 binding
 * @returns 不可变 binding
 */
function freezeBinding(binding: ChatToolBinding): ChatToolBinding {
  const providerId = binding.providerId.trim();
  const resourceId = binding.resourceId.trim();
  if (!providerId || !resourceId) throw new Error('Tool context binding requires providerId and resourceId');
  return Object.freeze({ providerId, resourceId });
}

/**
 * 校验历史脱敏路径。
 * @param path - 待校验路径
 * @param toolName - 所属工具名称
 */
function validateRedactPath(path: string, toolName: string): void {
  if (!path || path.length > MAX_REDACT_PATH_LENGTH) throw new Error(`Invalid renderer history redact path for tool: ${toolName}`);
  const segments = path.split('.');
  if (segments.some((segment: string): boolean => !segment || FORBIDDEN_PATH_SEGMENTS.has(segment) || !/^[A-Za-z0-9_$-]+$/.test(segment))) {
    throw new Error(`Invalid renderer history redact path for tool: ${toolName}`);
  }
}

/**
 * 校验 Renderer 工具历史策略。
 * @param history - 待校验历史策略
 * @param toolName - 所属工具名称
 */
function validateHistory(history: ChatRendererToolHistoryPolicy, toolName: string): void {
  if (history.mode !== 'keep' && history.mode !== 'latest-only') throw new Error(`Invalid renderer history mode for tool: ${toolName}`);
  if (history.placeholder !== undefined && history.placeholder.length > MAX_HISTORY_PLACEHOLDER_LENGTH) {
    throw new Error(`Renderer history placeholder is too long for tool: ${toolName}`);
  }
  const paths = history.redactInputPaths ?? [];
  if (paths.length > MAX_REDACT_PATH_COUNT) throw new Error(`Too many renderer history redact paths for tool: ${toolName}`);
  paths.forEach((path: string): void => validateRedactPath(path, toolName));
}

/**
 * 结构化复制页面工具定义，确保可进入 Runtime IPC。
 * @param definition - 页面工具定义
 * @param toolName - 工具名称
 * @returns 与页面原对象解耦的定义快照
 */
function cloneDefinition(definition: ToolContextDefinition, toolName: string): ToolContextDefinition {
  try {
    return structuredClone(definition);
  } catch {
    throw new Error(`Tool context definition must be cloneable: ${toolName}`);
  }
}

/**
 * 校验工具名称唯一性并复制工具数组。
 * @param tools - 候选工具
 * @returns 已校验工具
 */
function validateTools(tools: ToolContextTool[]): ToolContextTool[] {
  const names = tools.map((tool: ToolContextTool): string => tool.definition.name);
  const uniqueNames = uniq(names);
  if (uniqueNames.length !== names.length) {
    const duplicateName = names.find((name: string, index: number): boolean => names.indexOf(name) !== index) ?? 'unknown';
    throw new Error(`Duplicate Tool context tool name: ${duplicateName}`);
  }
  tools.forEach((tool: ToolContextTool): void => {
    const name = tool.definition.name.trim();
    if (!name || name !== tool.definition.name) throw new Error('Tool context tool name must be a non-empty trimmed string');
    if (typeof tool.definition.description !== 'string') throw new Error(`Tool context tool description must be cloneable: ${name}`);
    cloneDefinition(tool.definition, name);
    if (tool.presentation && !tool.presentation.label.trim()) throw new Error(`Tool context presentation label is required: ${name}`);
    if (tool.history) validateHistory(tool.history, name);
  });
  return [...tools];
}

/**
 * 复制并冻结历史策略。
 * @param history - 页面声明的历史策略
 * @param toolName - 所属工具名称
 * @returns 可安全进入 Runtime 描述符的策略
 */
function freezeHistory(history: ChatRendererToolHistoryPolicy | undefined, toolName: string): ChatRendererToolHistoryPolicy | undefined {
  if (!history) return undefined;
  validateHistory(history, toolName);
  const redactInputPaths = history.redactInputPaths ? Object.freeze([...history.redactInputPaths]) : undefined;
  return Object.freeze({
    mode: history.mode,
    ...(history.placeholder !== undefined ? { placeholder: history.placeholder } : {}),
    ...(redactInputPaths ? { redactInputPaths } : {})
  });
}

/**
 * 捕获不包含 Renderer 函数的工具元数据。
 * @param tools - 已校验的页面工具
 * @returns 可用于变更检测的元数据快照
 */
function captureToolMetadata(tools: ToolContextTool[]): readonly ToolMetadataSnapshot[] {
  return Object.freeze(
    tools.map(
      (tool: ToolContextTool): ToolMetadataSnapshot =>
        Object.freeze({
          definition: cloneDefinition(tool.definition, tool.definition.name),
          ...(tool.presentation
            ? { presentation: Object.freeze({ label: tool.presentation.label, hasSummarizer: Boolean(tool.presentation.summarize) }) }
            : {}),
          ...(tool.history ? { history: freezeHistory(tool.history, tool.definition.name) } : {})
        })
    )
  );
}

/**
 * 创建页面工具的统一确认请求。
 * @param tool - 当前页面工具
 * @param input - 工具输入
 * @returns 风险等级不可被页面降低的确认请求
 */
function createConfirmationRequest(tool: ToolContextTool, input: unknown): AIToolConfirmationRequest {
  const confirmation = tool.createConfirmation?.(input);
  return {
    toolName: tool.definition.name,
    title: confirmation?.title ?? `AI 想要执行 ${tool.definition.name}`,
    description: confirmation?.description ?? tool.definition.description,
    riskLevel: tool.definition.riskLevel,
    ...(confirmation?.beforeText !== undefined ? { beforeText: confirmation.beforeText } : {}),
    ...(confirmation?.afterText !== undefined ? { afterText: confirmation.afterText } : {}),
    allowRemember: confirmation?.allowRemember ?? (tool.definition.allowPermissionRemember === true || tool.definition.safeAutoApprove === true)
  };
}

/**
 * 创建页面工具上下文 Registry。
 * @returns 独立 Registry
 */
export function createToolContextRegistry(): ToolContextRegistry {
  const providers = new Map<string, Map<string, RegistryEntry>>();
  const listeners = new Set<() => void>();
  let activeEntry: ActiveEntry | undefined;

  /** 发布 Registry 有效状态变化。 */
  function emitChange(): void {
    listeners.forEach((listener: () => void): void => listener());
  }

  /** 按 binding 查找精确记录。 */
  function findEntry(binding: ChatToolBinding): RegistryEntry | undefined {
    return providers.get(binding.providerId)?.get(binding.resourceId);
  }

  /** 判断 entry 是否仍由目标 owner 持有。 */
  function ownsEntry(binding: ChatToolBinding, owner: symbol): boolean {
    return findEntry(binding)?.owner === owner;
  }

  /**
   * 读取页面工具并禁止绕过重新注册的元数据漂移。
   * @param entry - Registry 资源记录
   * @returns 当前执行函数对应的工具列表
   */
  function readEntryTools(entry: RegistryEntry): ToolContextTool[] {
    const tools = validateTools(entry.getTools());
    if (!isEqual(captureToolMetadata(tools), entry.toolMetadata)) {
      throw new Error(`Tool context metadata changed without re-registration: ${entry.binding.providerId}:${entry.binding.resourceId}`);
    }
    return tools;
  }

  /**
   * 将应用级 Bridge 精确分发给绑定资源。
   * @param binding - 冻结的页面资源身份
   * @param event - Runtime Bridge 请求
   * @returns 页面处理结果
   */
  async function dispatchAppBridge(binding: ChatToolBinding, event: ChatRuntimeBridgeRequestEvent): Promise<ChatBridgeDispatchResult> {
    const entry = findEntry(binding);
    if (!entry) throw createRegistryError('EDITOR_UNAVAILABLE', 'Runtime 绑定的页面上下文已不可用');
    const handler = entry.appBridgeHandlers?.[event.kind];
    return handler ? handler(event) : { handled: false };
  }

  /**
   * 将页面 executor 绑定到资源身份，执行时重新确认资源仍存在且仍提供同名工具。
   * @param entry - 当前资源记录
   * @param tools - 当前页面工具
   * @returns fail-closed 的绑定工具
   */
  function bindTools(entry: RegistryEntry, tools: ToolContextTool[], services: ToolContextRuntimeServices): AIToolExecutor[] {
    return tools.map(
      (tool: ToolContextTool): AIToolExecutor => ({
        definition: cloneDefinition(tool.definition, tool.definition.name),
        async execute(input: unknown, context?: AIToolContext, metadata?: AIToolExecutionMetadata): Promise<AIToolExecutionResult> {
          if (metadata?.abortSignal?.aborted) {
            return createToolFailureResult(tool.definition.name, 'RUNTIME_INTERRUPTED', '页面工具执行已中断');
          }
          const current = findEntry(entry.binding);
          if (!current) {
            return createToolFailureResult(tool.definition.name, 'EDITOR_UNAVAILABLE', 'Runtime 绑定的页面上下文已不可用');
          }
          const currentTool = readEntryTools(current).find((candidate: ToolContextTool): boolean => candidate.definition.name === tool.definition.name);
          if (!currentTool) {
            return createToolFailureResult(tool.definition.name, 'ACTION_NOT_SUPPORTED', `绑定页面不再支持工具：${tool.definition.name}`);
          }
          const [confirmationError, request] = await asyncTo(
            Promise.resolve().then((): AIToolConfirmationRequest => createConfirmationRequest(currentTool, input))
          );
          if (confirmationError) {
            const cause = confirmationError.cause ?? confirmationError;
            const code = readToolExecutionErrorCode(cause) ?? 'INVALID_INPUT';
            const message = cause instanceof Error ? cause.message : '页面工具确认参数无效';
            return createToolFailureResult(tool.definition.name, code, message);
          }
          return executeResultWithPermission({
            definition: currentTool.definition,
            adapter: services.confirmation,
            request,
            operation: (): Promise<AIToolExecutionResult> =>
              metadata?.abortSignal?.aborted
                ? Promise.resolve(createToolFailureResult(tool.definition.name, 'RUNTIME_INTERRUPTED', '页面工具执行已中断'))
                : Promise.resolve(currentTool.execute(input, context, metadata))
          });
        }
      })
    );
  }

  return {
    register(registration: ToolContextRegistration): ToolContextHandle {
      const binding = freezeBinding(registration.binding);
      // 注册时先验证静态结果；读取时仍会再次验证动态结果。
      const initialTools = validateTools(registration.getTools());
      const owner = Symbol(`${binding.providerId}:${binding.resourceId}`);
      const provider = providers.get(binding.providerId) ?? new Map<string, RegistryEntry>();
      const entry: RegistryEntry = {
        ...registration,
        binding,
        owner,
        toolMetadata: captureToolMetadata(initialTools),
        hiddenToolNames: Object.freeze(uniq([...registration.hiddenToolNames])),
        appBridgeHandlers: registration.appBridgeHandlers ?? {}
      };
      provider.set(binding.resourceId, entry);
      providers.set(binding.providerId, provider);
      if (activeEntry?.binding.providerId === binding.providerId && activeEntry.binding.resourceId === binding.resourceId) {
        activeEntry = undefined;
      }
      emitChange();

      return {
        binding,
        activate(): void {
          if (!ownsEntry(binding, owner) || activeEntry?.owner === owner) return;
          activeEntry = { binding, owner };
          emitChange();
        },
        deactivate(): void {
          if (activeEntry?.owner !== owner) return;
          activeEntry = undefined;
          emitChange();
        },
        unregister(): void {
          if (!ownsEntry(binding, owner)) return;
          provider.delete(binding.resourceId);
          if (provider.size === 0) providers.delete(binding.providerId);
          if (activeEntry?.owner === owner) activeEntry = undefined;
          emitChange();
        }
      };
    },
    getActiveBinding(): ChatToolBinding | undefined {
      if (!activeEntry || !ownsEntry(activeEntry.binding, activeEntry.owner)) return undefined;
      return activeEntry.binding;
    },
    getBoundTools(binding: ChatToolBinding, services: ToolContextRuntimeServices): AIToolExecutor[] {
      const entry = findEntry(binding);
      if (!entry) return [];
      return bindTools(entry, readEntryTools(entry), services);
    },
    getHiddenToolNames(binding: ChatToolBinding): readonly string[] {
      return findEntry(binding)?.hiddenToolNames ?? EMPTY_HIDDEN_NAMES;
    },
    getPresentation(binding: ChatToolBinding, toolName: string) {
      const entry = findEntry(binding);
      return entry ? readEntryTools(entry).find((tool: ToolContextTool): boolean => tool.definition.name === toolName)?.presentation : undefined;
    },
    getPresentationByTool(toolName: string) {
      let resolved: ToolContextTool['presentation'];
      for (const provider of providers.values()) {
        for (const entry of provider.values()) {
          const tool = readEntryTools(entry).find((candidate: ToolContextTool): boolean => candidate.definition.name === toolName);
          if (!tool) continue;
          if (!tool.presentation) return undefined;
          if (!resolved) {
            resolved = tool.presentation;
            continue;
          }
          if (resolved.label !== tool.presentation.label || Boolean(resolved.summarize) !== Boolean(tool.presentation.summarize)) {
            return undefined;
          }
        }
      }
      return resolved;
    },
    getRendererTools(binding: ChatToolBinding): readonly ChatRendererToolDescriptor[] {
      const entry = findEntry(binding);
      if (!entry) return Object.freeze([] as ChatRendererToolDescriptor[]);
      return Object.freeze(
        readEntryTools(entry).map(
          (tool: ToolContextTool): ChatRendererToolDescriptor =>
            Object.freeze({
              name: tool.definition.name,
              ...(tool.history ? { history: freezeHistory(tool.history, tool.definition.name) } : {})
            })
        )
      );
    },
    async dispatchAppBridge(binding: ChatToolBinding, event: ChatRuntimeBridgeRequestEvent): Promise<ChatBridgeDispatchResult> {
      return dispatchAppBridge(binding, event);
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    clear(): void {
      const changed = providers.size > 0 || activeEntry !== undefined;
      providers.clear();
      activeEntry = undefined;
      if (changed) emitChange();
    }
  };
}

/** 应用级页面工具上下文 Registry 单例。 */
export const toolContextRegistry = createToolContextRegistry();
