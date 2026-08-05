/**
 * @file registry.ts
 * @description 页面工具上下文资源的注册、激活和精确 binding 查询。
 */
import type { ChatBridgeDispatchResult, ToolContextHandle, ToolContextRegistration, ToolContextRegistry } from './types';
import type { AIToolContext, AIToolExecutionError, AIToolExecutionResult, AIToolExecutor } from 'types/ai';
import type { ChatRuntimeBridgeRequestEvent, ChatToolBinding } from 'types/chat-runtime';
import { uniq } from 'lodash-es';
import { createToolFailureResult } from '@/ai/tools/results';

/** Registry 内部资源记录。 */
interface RegistryEntry extends ToolContextRegistration {
  /** 当前注册实例 owner。 */
  readonly owner: symbol;
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
 * 校验工具名称唯一性并复制工具数组。
 * @param tools - 候选工具
 * @returns 已校验工具
 */
function validateTools(tools: AIToolExecutor[]): AIToolExecutor[] {
  const names = tools.map((tool: AIToolExecutor): string => tool.definition.name);
  const uniqueNames = uniq(names);
  if (uniqueNames.length !== names.length) {
    const duplicateName = names.find((name: string, index: number): boolean => names.indexOf(name) !== index) ?? 'unknown';
    throw new Error(`Duplicate Tool context tool name: ${duplicateName}`);
  }
  return [...tools];
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
   * 将页面 executor 绑定到资源身份，执行时重新确认资源仍存在且仍提供同名工具。
   * @param entry - 当前资源记录
   * @param tools - 当前页面工具
   * @returns fail-closed 的绑定工具
   */
  function bindTools(entry: RegistryEntry, tools: AIToolExecutor[]): AIToolExecutor[] {
    return tools.map(
      (tool: AIToolExecutor): AIToolExecutor => ({
        ...tool,
        async execute(input: unknown, context?: AIToolContext): Promise<AIToolExecutionResult> {
          const current = findEntry(entry.binding);
          if (!current) {
            return createToolFailureResult(tool.definition.name, 'EDITOR_UNAVAILABLE', 'Runtime 绑定的页面上下文已不可用');
          }
          const currentTool = validateTools(current.getTools()).find(
            (candidate: AIToolExecutor): boolean => candidate.definition.name === tool.definition.name
          );
          if (!currentTool) {
            return createToolFailureResult(tool.definition.name, 'ACTION_NOT_SUPPORTED', `绑定页面不再支持工具：${tool.definition.name}`);
          }
          return currentTool.execute(input, context);
        }
      })
    );
  }

  return {
    register(registration: ToolContextRegistration): ToolContextHandle {
      const binding = freezeBinding(registration.binding);
      // 注册时先验证静态结果；读取时仍会再次验证动态结果。
      validateTools(registration.getTools());
      const owner = Symbol(`${binding.providerId}:${binding.resourceId}`);
      const provider = providers.get(binding.providerId) ?? new Map<string, RegistryEntry>();
      const entry: RegistryEntry = {
        ...registration,
        binding,
        owner,
        hiddenToolNames: Object.freeze(uniq([...registration.hiddenToolNames]))
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
    getBoundTools(binding: ChatToolBinding): AIToolExecutor[] {
      const entry = findEntry(binding);
      if (!entry) return [];
      return bindTools(entry, validateTools(entry.getTools()));
    },
    getHiddenToolNames(binding: ChatToolBinding): readonly string[] {
      return findEntry(binding)?.hiddenToolNames ?? EMPTY_HIDDEN_NAMES;
    },
    async dispatchBridge(binding: ChatToolBinding, event: ChatRuntimeBridgeRequestEvent): Promise<ChatBridgeDispatchResult> {
      const entry = findEntry(binding);
      if (!entry) throw createRegistryError('EDITOR_UNAVAILABLE', 'Runtime 绑定的页面上下文已不可用');
      const handler = entry.bridgeHandlers[event.kind];
      return handler ? handler(event) : { handled: false };
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
