/**
 * @file useToolContext.ts
 * @description 将页面工具上下文绑定到 Vue 生命周期，并提供 BChat 消费入口。
 */
import type { ActiveToolContext, ToolContextHandle, UseToolContextOptions } from './lib/types';
import { onActivated, onDeactivated, onScopeDispose, readonly, ref, watch } from 'vue';
import { toolContextRegistry } from './lib/registry';

export type {
  ActiveToolContext,
  ChatBridgeDispatchResult,
  ChatBridgeHandler,
  ChatToolBinding,
  ToolContextHandle,
  ToolContextRegistration,
  ToolContextRegistry,
  UseToolContextOptions
} from './lib/types';

/** Registry 状态变化的 Vue 修订投影。 */
const registryRevision = ref<number>(0);
toolContextRegistry.subscribe((): void => {
  registryRevision.value += 1;
});

/**
 * 注册页面提供给 ChatRuntime 的上下文能力。
 * @param options - 页面工具上下文注册选项
 */
export function useToolContext(options: UseToolContextOptions): void {
  let handle: ToolContextHandle | undefined;
  /** KeepAlive 生命周期是否允许当前页面成为激活资源。 */
  let lifecycleActive = true;

  /** 注销当前 Hook 持有的资源。 */
  function disposeRegistration(): void {
    handle?.unregister();
    handle = undefined;
  }

  /** 同步当前激活状态。 */
  function syncActive(): void {
    if (!handle) return;
    if (options.active.value && lifecycleActive) handle.activate();
    else handle.deactivate();
  }

  /** 同步资源注册状态。 */
  function syncRegistration(): void {
    const resourceId = options.resourceId.value.trim();
    if (!options.available.value || !resourceId) {
      disposeRegistration();
      return;
    }
    if (handle?.binding.providerId === options.providerId && handle.binding.resourceId === resourceId) {
      syncActive();
      return;
    }
    disposeRegistration();
    handle = toolContextRegistry.register({
      binding: { providerId: options.providerId, resourceId },
      getTools: options.getTools,
      hiddenToolNames: options.hiddenToolNames ?? [],
      bridgeHandlers: options.bridgeHandlers
    });
    syncActive();
  }

  watch([options.resourceId, options.available], syncRegistration, { immediate: true });
  watch(options.active, syncActive, { immediate: true });
  onActivated((): void => {
    lifecycleActive = true;
    syncRegistration();
    syncActive();
  });
  onDeactivated((): void => {
    lifecycleActive = false;
    handle?.deactivate();
  });
  onScopeDispose(disposeRegistration);
}

/**
 * 获取 BChat 使用的通用页面工具能力。
 * @returns 页面工具查询和 Bridge 分发能力
 */
export function useActiveToolContext(): ActiveToolContext {
  return {
    revision: readonly(registryRevision),
    getActiveBinding: toolContextRegistry.getActiveBinding,
    getBoundTools: toolContextRegistry.getBoundTools,
    getHiddenToolNames: toolContextRegistry.getHiddenToolNames,
    dispatchBridge: toolContextRegistry.dispatchBridge
  };
}
